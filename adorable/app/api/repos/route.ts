import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createVmForRepo } from "@/lib/adorable-vm";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { getGitProvider } from "@/lib/git/provider-singleton";
import { seedTemplateRepo } from "@/lib/template-seeder";
import {
  ADORABLE_WRAPPER_REPO_PREFIX,
  type RepoMetadata,
  type RepoDeploymentSummary,
  createConversationInRepo,
  readRepoMetadata,
  writeRepoMetadata,
} from "@/lib/repo-storage";

const toDisplayRepoName = (name?: string | null) => {
  if (!name) return undefined;
  return name.startsWith(ADORABLE_WRAPPER_REPO_PREFIX)
    ? name.slice(ADORABLE_WRAPPER_REPO_PREFIX.length)
    : name;
};

type DeploymentEntry = {
  deploymentId: string;
  state: "building" | "deployed" | "failed";
  domains: string[];
};

const reconcileDeploymentState = (
  deployment: RepoDeploymentSummary,
  entries: DeploymentEntry[],
): RepoDeploymentSummary => {
  const matchById = deployment.deploymentId
    ? entries.find((entry) => entry.deploymentId === deployment.deploymentId)
    : undefined;

  const matchByDomain = entries.find((entry) =>
    entry.domains.includes(deployment.domain),
  );

  const match = matchById ?? matchByDomain;
  if (!match) {
    return {
      ...deployment,
      state: deployment.state === "deploying" ? "idle" : deployment.state,
    };
  }

  const state: RepoDeploymentSummary["state"] =
    match.state === "deployed"
      ? "live"
      : match.state === "failed"
        ? "failed"
        : "deploying";

  return {
    ...deployment,
    deploymentId: match.deploymentId ?? deployment.deploymentId,
    state,
  };
};

const toRepoResponse = async (
  repo: { id: string; name?: string | null },
  deploymentEntries: DeploymentEntry[],
) => {
  const metadata = await readRepoMetadata(repo.id);
  const repoDisplayName = toDisplayRepoName(repo.name);
  const metadataDisplayName = toDisplayRepoName(metadata?.name);
  const reconciledMetadata = metadata
    ? {
        ...metadata,
        deployments: metadata.deployments.map((deployment) =>
          reconcileDeploymentState(deployment, deploymentEntries),
        ),
      }
    : metadata;

  return {
    id: repo.id,
    name: repoDisplayName ?? metadataDisplayName ?? "Untitled Repo",
    metadata: reconciledMetadata,
  };
};

export async function GET() {
  const { identityId, identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  const wrapperRepositories = repositories.filter((repo) =>
    (repo.name ?? "").startsWith(ADORABLE_WRAPPER_REPO_PREFIX),
  );

  // TODO(phase-5): list deployments via DeployProvider. For now leave
  // empty — the reconciler treats missing matches as "idle"/"deploying"
  // as appropriate.
  const deploymentEntries: DeploymentEntry[] = [];

  const items = await Promise.all(
    wrapperRepositories.map((repo) => toRepoResponse(repo, deploymentEntries)),
  );

  return NextResponse.json({
    identityId,
    repositories: items,
  });
}

export async function POST(req: Request) {
  const { identity } = await getOrCreateIdentitySession();

  let requestedName: string | undefined;
  let requestedConversationTitle: string | undefined;
  let githubRepoName: string | undefined;
  try {
    const payload = (await req.json()) as {
      name?: string;
      conversationTitle?: string;
      githubRepoName?: string;
    };
    const nextName = payload?.name?.trim();
    const nextConversationTitle = payload?.conversationTitle?.trim();
    const nextGithubRepoName = payload?.githubRepoName?.trim();
    requestedName = nextName ? nextName : undefined;
    requestedConversationTitle = nextConversationTitle
      ? nextConversationTitle
      : undefined;
    githubRepoName = nextGithubRepoName ? nextGithubRepoName : undefined;
  } catch {
    requestedName = undefined;
    requestedConversationTitle = undefined;
    githubRepoName = undefined;
  }

  const gitProvider = await getGitProvider();

  // Create repo with GitHub Sync or from template
  let sourceRepoId: string;
  if (githubRepoName) {
    const { repo, repoId: createdRepoId } = await gitProvider.createRepo(
      requestedName ? { name: requestedName } : {},
    );
    sourceRepoId = createdRepoId;

    // Enable GitHub Sync (push-mirror in Gitea).
    await repo.githubSync.enable({ githubRepoName });
  } else {
    // Создаём пустой репо и заливаем в него bundled Vite + React template
    // через seedTemplateRepo. Раньше здесь был gitProvider.createRepo({
    // import: { url: TEMPLATE_REPO } }) который дёргал Gitea migrate-endpoint
    // против external GitHub. Теперь template лежит рядом с кодом, никаких
    // внешних зависимостей при создании проекта.
    const created = await gitProvider.createRepo(
      requestedName ? { name: requestedName } : {},
    );
    sourceRepoId = created.repoId;
    await seedTemplateRepo({
      provider: gitProvider,
      repo: created.repo,
    });
  }

  const inferredName =
    requestedName ?? githubRepoName?.split("/").pop()?.trim() ?? "Project";
  const wrapperRepoName = `${ADORABLE_WRAPPER_REPO_PREFIX}${inferredName}`;
  const wrapperCreated = await gitProvider.createRepo({
    name: wrapperRepoName,
  });
  const wrapperRepoId = wrapperCreated.repoId;

  await identity.permissions.git.grant({
    permission: "write",
    repoId: sourceRepoId,
  });

  await identity.permissions.git.grant({
    permission: "write",
    repoId: wrapperRepoId,
  });

  const vm = await createVmForRepo(sourceRepoId);

  // VM identity grants were a Freestyle concept. In the self-hosted
  // model the builder process is the sole controller of sandbox
  // containers, so per-identity ACLs on VMs don't exist. The Git repo
  // grant above remains (Phase 3 will migrate that to Gitea).

  const initialMetadata: RepoMetadata = {
    version: 2,
    sourceRepoId,
    ...(requestedName ? { name: requestedName } : {}),
    vm,
    conversations: [],
    deployments: [],
    productionDomain: null,
    productionDeploymentId: null,
  };

  await writeRepoMetadata(wrapperRepoId, initialMetadata);

  const conversationId = randomUUID();
  const metadata = await createConversationInRepo(
    wrapperRepoId,
    initialMetadata,
    conversationId,
    requestedConversationTitle,
  );

  return NextResponse.json({
    id: wrapperRepoId,
    metadata,
    conversationId,
  });
}
