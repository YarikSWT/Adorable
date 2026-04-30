import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createVmForRepo } from "@/lib/adorable-vm";
import {
  getOrCreateIdentitySession,
  migrateRepoIdInAcl,
} from "@/lib/identity-session";
import { getGitProvider } from "@/lib/git/provider-singleton";
import { seedTemplateRepo } from "@/lib/template-seeder";
import { readBoilerplateVersion } from "@/lib/preview/boilerplate-version";
import { getPreviewProvider } from "@/lib/preview/provider-singleton";
import { IdempotencyCache } from "@/lib/idempotency";
import {
  ADORABLE_WRAPPER_REPO_PREFIX,
  isWrapperRepoName,
  stripWrapperPrefix,
  type RepoMetadata,
  type RepoDeploymentSummary,
  type RepoPreviewMetadata,
  createConversationInRepo,
  readRepoMetadata,
  writeRepoMetadata,
} from "@/lib/repo-storage";

type CreateRepoResponse = {
  id: string;
  metadata: RepoMetadata;
  conversationId: string;
};

// 60s TTL: long enough that a slow round-trip from a duplicate POST still
// dedups, short enough that a stale id doesn't haunt later legitimate
// requests. Module-level so all requests share the cache within a process.
const createRepoIdempotency = new IdempotencyCache<CreateRepoResponse>(
  60_000,
);

// Exposed for tests so they can reset between cases.
export const __resetCreateRepoIdempotencyForTests = () => {
  createRepoIdempotency.clear();
};

const toDisplayRepoName = (name?: string | null) => stripWrapperPrefix(name);

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

/**
 * Чинит URL вида `http://abc.preview.localhost` который сохраняли в
 * metadata.json до фикса, добавляющего порт. В dev Caddy слушает на 8080
 * (или другом, заданном через CADDY_HTTP_PORT / PREVIEW_PUBLIC_PORT), а
 * iframe в UI без порта летит на дефолтный 80 → loader висит навсегда.
 *
 * На вылете из /api/repos переписываем URL'ы: если в host нет порта и
 * env намекает, что прокси не на 80/443 — дописываем `:<port>`. На prod
 * с Caddy на стандартных 80/443 ничего не меняется.
 */
const rewritePreviewPort = (url: string | undefined): string | undefined => {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.port) return url; // уже есть явный порт
  const envPort =
    process.env["PREVIEW_PUBLIC_PORT"] ?? process.env["CADDY_HTTP_PORT"];
  const port = envPort ? Number.parseInt(envPort, 10) : NaN;
  if (!Number.isFinite(port) || port <= 0) return url;
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  if (port === defaultPort) return url;
  parsed.port = String(port);
  return parsed.toString().replace(/\/$/, ""); // тривиальный trailing-slash trim
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
        vm: {
          ...metadata.vm,
          previewUrl: rewritePreviewPort(metadata.vm.previewUrl) ?? "",
          devCommandTerminalUrl:
            rewritePreviewPort(metadata.vm.devCommandTerminalUrl) ?? "",
          additionalTerminalsUrl:
            rewritePreviewPort(metadata.vm.additionalTerminalsUrl) ?? "",
        },
        deployments: metadata.deployments.map((deployment) =>
          reconcileDeploymentState(deployment, deploymentEntries),
        ),
      }
    : metadata;

  // Display priority:
  //   1. metadata.name (то, что пользователь увидел в интерфейсе при создании)
  //   2. stripped repo name (для старых wrapper'ов, у которых metadata.name мог
  //      не сохраниться; у новых wrapper'ов имя — UUID, не годится для UI)
  //   3. fallback "Untitled Repo"
  return {
    id: repo.id,
    name: metadataDisplayName ?? repoDisplayName ?? "Untitled Repo",
    metadata: reconciledMetadata,
  };
};

/**
 * Имена wrapper-репо считаются "чистыми", если соответствуют формату
 * `adorable-meta-<uuid>`. Все остальные (старые: спрэдингованные пробелы
 * → дефисы, осколки prompt'а в URL) подлежат one-time миграции.
 */
const CLEAN_WRAPPER_NAME_RE =
  /^adorable-meta-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const migrateWrapperNameIfNeeded = async (
  repo: { id: string; name: string },
): Promise<{ id: string; name: string }> => {
  if (CLEAN_WRAPPER_NAME_RE.test(repo.name)) return repo;
  const provider = await getGitProvider();
  if (!provider.renameRepo) return repo;

  const newName = `adorable-meta-${randomUUID()}`;
  try {
    const renamed = await provider.renameRepo(repo.id, newName);
    await migrateRepoIdInAcl(repo.id, renamed.repoId);
    return { id: renamed.repoId, name: newName };
  } catch (err) {
    process.stderr.write(
      `repos: migrate rename failed for ${repo.id} (${(err as Error).message})\n`,
    );
    return repo;
  }
};

export async function GET() {
  const { identityId, identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  const wrapperRepositories = repositories.filter((repo) =>
    isWrapperRepoName(repo.name),
  );

  // One-time миграция: старые wrapper'ы вроде
  // "adorable-meta-----------------------------Mazda-MX-5..." (созданные
  // до фикса префикса) переименовываются в "adorable-meta-<uuid>". ACL
  // обновляется через migrateRepoIdInAcl. После rename старые URL
  // перестают работать — пользователь увидит redirect через clean имя
  // в следующем render'е home grid.
  const migratedRepositories = await Promise.all(
    wrapperRepositories.map((repo) => migrateWrapperNameIfNeeded(repo)),
  );

  // TODO(phase-5): list deployments via DeployProvider. For now leave
  // empty — the reconciler treats missing matches as "idle"/"deploying"
  // as appropriate.
  const deploymentEntries: DeploymentEntry[] = [];

  const items = await Promise.all(
    migratedRepositories.map((repo) => toRepoResponse(repo, deploymentEntries)),
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
  let clientRequestId: string | undefined;
  try {
    const payload = (await req.json()) as {
      name?: string;
      conversationTitle?: string;
      githubRepoName?: string;
      clientRequestId?: string;
    };
    const nextName = payload?.name?.trim();
    const nextConversationTitle = payload?.conversationTitle?.trim();
    const nextGithubRepoName = payload?.githubRepoName?.trim();
    const nextClientRequestId = payload?.clientRequestId?.trim();
    requestedName = nextName ? nextName : undefined;
    requestedConversationTitle = nextConversationTitle
      ? nextConversationTitle
      : undefined;
    githubRepoName = nextGithubRepoName ? nextGithubRepoName : undefined;
    clientRequestId = nextClientRequestId ? nextClientRequestId : undefined;
  } catch {
    requestedName = undefined;
    requestedConversationTitle = undefined;
    githubRepoName = undefined;
    clientRequestId = undefined;
  }

  const result = await createRepoIdempotency.run(clientRequestId, () =>
    createRepoForRequest({
      identity,
      requestedName,
      requestedConversationTitle,
      githubRepoName,
    }),
  );

  return NextResponse.json(result);
}

async function createRepoForRequest(args: {
  identity: Awaited<ReturnType<typeof getOrCreateIdentitySession>>["identity"];
  requestedName: string | undefined;
  requestedConversationTitle: string | undefined;
  githubRepoName: string | undefined;
}): Promise<CreateRepoResponse> {
  const { identity, requestedName, requestedConversationTitle, githubRepoName } =
    args;

  const gitProvider = await getGitProvider();

  // Source-repo тоже получает UUID-имя. Раньше использовалось
  // requestedName (первые 50 символов prompt'а) — но Cyrillic-prompt'ы
  // после Gitea-sanitization превращаются в одинаковые `-----` строки,
  // что приводило к 409 при повторных попытках. Display-name приходит
  // из metadata.name — sourceRepo human-readable имя нам не нужно.
  const sourceUuid = randomUUID();
  let sourceRepoId: string;
  if (githubRepoName) {
    const { repo, repoId: createdRepoId } = await gitProvider.createRepo({
      name: `adorable-src-${sourceUuid}`,
    });
    sourceRepoId = createdRepoId;

    // Enable GitHub Sync (push-mirror in Gitea).
    await repo.githubSync.enable({ githubRepoName });
  } else {
    // Создаём пустой репо и заливаем в него bundled Vite + React template
    // через seedTemplateRepo. Раньше здесь был gitProvider.createRepo({
    // import: { url: TEMPLATE_REPO } }) который дёргал Gitea migrate-endpoint
    // против external GitHub. Теперь template лежит рядом с кодом, никаких
    // внешних зависимостей при создании проекта.
    const created = await gitProvider.createRepo({
      name: `adorable-src-${sourceUuid}`,
    });
    sourceRepoId = created.repoId;
    await seedTemplateRepo({
      provider: gitProvider,
      repo: created.repo,
    });
  }

  const inferredName =
    requestedName ?? githubRepoName?.split("/").pop()?.trim() ?? "Project";
  // Раньше имя wrapper-репо склеивалось из ADORABLE_WRAPPER_REPO_PREFIX +
  // первых 50 символов prompt'а пользователя. Gitea sanitiz'ил пробелы и
  // спецсимволы в дефисы, и URL получался вроде
  // /adorable%2Fadorable-meta-----------------------------Mazda-MX-5- —
  // длинный, нечитабельный, и ничего полезного в нём не было (display name
  // и так берётся из metadata.json).
  // Используем UUID — короткий, гарантированно уникальный, без коллизий
  // при повторных prompt'ах. isWrapperRepoName ловит как старые
  // "adorable-meta-..." имена, так и новые "adorable-meta-<uuid>".
  const wrapperUuid = randomUUID();
  const wrapperRepoName = `${ADORABLE_WRAPPER_REPO_PREFIX}${wrapperUuid}`;
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

  // Branch by preview-provider name (CONTRACTS §10):
  //   - "sandbox": legacy createVmForRepo path stays (it already does
  //     proxy registration + identity grants via the sandbox provider's
  //     internals). previewProvider.create() in sandbox-mode is
  //     idempotent but does its own createVmForRepo — calling both would
  //     double-create the container, so we skip the provider call here.
  //   - "static" / "mock": call previewProvider.create() so the project
  //     is registered with the provider (scratch dir, Caddy file_server
  //     route, in-memory state). Synthesize the legacy `vm` field from
  //     PreviewMetadata for backwards compat with existing UI/storage.
  const boilerplateVersion = await readBoilerplateVersion();
  const previewProvider = await getPreviewProvider();

  let vm;
  if (previewProvider.name === "sandbox") {
    vm = await createVmForRepo(sourceRepoId);
  } else {
    const previewMeta = await previewProvider.create({
      repoId: sourceRepoId,
      boilerplateVersion,
    });
    vm = {
      // For static-mode there is no container; expose sourceRepoId as a
      // stable identifier so downstream code that passes vmId around
      // still has something. /wake endpoint already handles missing
      // sandboxes by falling back to recreate.
      vmId: previewMeta.projectId,
      previewUrl: previewMeta.previewUrl,
      devCommandTerminalUrl: previewMeta.terminalUrls?.devCommand ?? "",
      additionalTerminalsUrl: previewMeta.terminalUrls?.additional ?? "",
    };
  }

  // VM identity grants were a Freestyle concept. In the self-hosted
  // model the builder process is the sole controller of sandbox
  // containers, so per-identity ACLs on VMs don't exist. The Git repo
  // grant above remains (Phase 3 will migrate that to Gitea).

  const previewMetadata: RepoPreviewMetadata = {
    provider: previewProvider.name,
    capabilities: { ...previewProvider.capabilities },
    createdAt: new Date().toISOString(),
    migrationStatus: "ok",
  };

  const initialMetadata: RepoMetadata = {
    version: 2,
    sourceRepoId,
    ...(requestedName ? { name: requestedName } : {}),
    vm,
    conversations: [],
    deployments: [],
    productionDomain: null,
    productionDeploymentId: null,
    boilerplateVersion,
    preview: previewMetadata,
  };

  await writeRepoMetadata(wrapperRepoId, initialMetadata);

  const conversationId = randomUUID();
  const metadata = await createConversationInRepo(
    wrapperRepoId,
    initialMetadata,
    conversationId,
    requestedConversationTitle,
  );

  return {
    id: wrapperRepoId,
    metadata,
    conversationId,
  };
}
