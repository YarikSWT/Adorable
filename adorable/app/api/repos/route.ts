import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createVmForRepo } from "@/lib/adorable-vm";
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
import { db } from "@/lib/db/client";
import { projectMembers, projects } from "@/lib/db/schema/projects";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireEmailVerified, type RequestSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/authorization";
import { recordUsage, requireQuota } from "@/lib/auth/quotas";
import { writeAuditLog } from "@/lib/auth/audit";
import { getRoleId } from "@/lib/auth/role-cache";
import {
  listProjectsForUser,
  type ProjectRow,
} from "@/lib/db/queries/projects";
import { getDefaultPersonalOrgId } from "@/lib/db/queries/users";
import { HttpError } from "@/lib/auth/errors";

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
  let port = envPort ? Number.parseInt(envPort, 10) : NaN;
  // Dev-fallback: docker-compose маппит Caddy на 8080 по умолчанию, и
  // если в .env CADDY_HTTP_PORT не задан, без этого фолбэка iframe
  // тычется на :80 → connection refused → "Loading preview..." вечно.
  // Применяем только для localhost-хостов, чтобы не ломать prod.
  if (
    !Number.isFinite(port) &&
    parsed.hostname.endsWith(".preview.localhost")
  ) {
    port = 8080;
  }
  if (!Number.isFinite(port) || port <= 0) return url;
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  if (port === defaultPort) return url;
  parsed.port = String(port);
  return parsed.toString().replace(/\/$/, ""); // тривиальный trailing-slash trim
};

const toRepoResponse = async (
  project: ProjectRow,
  deploymentEntries: DeploymentEntry[],
) => {
  // URL contract: external `repoId` = giteaWrapperRepoId for legacy projects,
  // the project uuid for wrapper-less ones. Metadata is read PG-first (with a
  // Gitea fallback) for BOTH.
  const idStr = project.giteaWrapperRepoId ?? project.id;
  const metadata = await readRepoMetadata(idStr);
  const repoDisplayName = toDisplayRepoName(project.giteaWrapperRepoName);
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
  //   1. project.name (что юзер ввёл при создании, теперь живёт в БД)
  //   2. metadata.name (legacy projects до Phase 12)
  //   3. stripped wrapper-repo name
  //   4. fallback "Untitled Repo"
  return {
    id: idStr,
    name:
      project.name ??
      metadataDisplayName ??
      repoDisplayName ??
      "Untitled Repo",
    metadata: reconciledMetadata,
  };
};

export const GET = protectedRoute(async ({ session }) => {
  const projectRows = await listProjectsForUser(session.user.id);
  // TODO(phase-5 of preview-pipeline): list deployments via DeployProvider.
  const deploymentEntries: DeploymentEntry[] = [];
  const items = await Promise.all(
    projectRows.map((p) => toRepoResponse(p, deploymentEntries)),
  );
  return NextResponse.json({
    userId: session.user.id,
    repositories: items,
  });
});

type CreatePayload = {
  name?: string;
  conversationTitle?: string;
  githubRepoName?: string;
  clientRequestId?: string;
  organizationId?: string;
};

const parsePayload = async (req: Request): Promise<CreatePayload> => {
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const pickStr = (k: string): string | undefined => {
      const v = raw[k];
      if (typeof v !== "string") return undefined;
      const t = v.trim();
      return t ? t : undefined;
    };
    return {
      name: pickStr("name"),
      conversationTitle: pickStr("conversationTitle"),
      githubRepoName: pickStr("githubRepoName"),
      clientRequestId: pickStr("clientRequestId"),
      organizationId: pickStr("organizationId"),
    };
  } catch {
    return {};
  }
};

export const POST = protectedRoute(async ({ req, session }) => {
  requireEmailVerified(session);
  const payload = await parsePayload(req);

  const orgId =
    payload.organizationId ??
    (await getDefaultPersonalOrgId(session.user.id));
  if (!orgId) {
    throw new HttpError(
      404,
      "not_found",
      "Не найдена персональная организация для пользователя",
    );
  }

  await requirePermission(session.user.id, "organization.projects.create", {
    organizationId: orgId,
  });
  await requireQuota(orgId, "projects.max", 1);

  const result = await createRepoIdempotency.run(payload.clientRequestId, () =>
    createRepoForRequest({ session, payload, organizationId: orgId }),
  );

  return NextResponse.json(result);
});

async function createRepoForRequest(args: {
  session: RequestSession;
  payload: CreatePayload;
  organizationId: string;
}): Promise<CreateRepoResponse> {
  const { session, payload, organizationId } = args;
  const gitProvider = await getGitProvider();

  // Source-repo тоже получает UUID-имя. Раньше использовалось
  // requestedName (первые 50 символов prompt'а) — но Cyrillic-prompt'ы
  // после Gitea-sanitization превращаются в одинаковые `-----` строки,
  // что приводило к 409 при повторных попытках. Display-name приходит
  // из metadata.name — sourceRepo human-readable имя нам не нужно.
  const sourceUuid = randomUUID();
  let sourceRepoId: string;
  if (payload.githubRepoName) {
    const { repo, repoId: createdRepoId } = await gitProvider.createRepo({
      name: `adorable-src-${sourceUuid}`,
    });
    sourceRepoId = createdRepoId;
    await repo.githubSync.enable({ githubRepoName: payload.githubRepoName });
  } else {
    const created = await gitProvider.createRepo({
      name: `adorable-src-${sourceUuid}`,
    });
    sourceRepoId = created.repoId;
    await seedTemplateRepo({ provider: gitProvider, repo: created.repo });
  }

  const inferredName =
    payload.name ??
    payload.githubRepoName?.split("/").pop()?.trim() ??
    "Project";

  // Metadata now lives in projects.metadata (Postgres) — the Gitea adorable-meta
  // wrapper repo is no longer created (спец §3.3 / Phase 2 unit 8). The external
  // repoId becomes the project uuid; getProjectByGiteaWrapperId resolves it.
  void isWrapperRepoName;
  void ADORABLE_WRAPPER_REPO_PREFIX;

  // Phase 12: explicit project_members record for the creator (Doc 2 §8.2 +
  // правка 3) — same transaction as the project insert. Survives org-role
  // downgrades and works uniformly for personal- and team-orgs.
  const projectOwnerRoleId = await getRoleId("project", "owner");
  const slug = `proj-${randomUUID().slice(0, 8)}`;

  const projectRow = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        organizationId,
        slug,
        name: inferredName,
        giteaRepoId: sourceRepoId,
        giteaRepoName: `adorable-src-${sourceUuid}`,
        // No wrapper repo — metadata is in projects.metadata.
        giteaWrapperRepoId: null,
        giteaWrapperRepoName: null,
        createdByUserId: session.user.id,
      })
      .returning();
    await tx.insert(projectMembers).values({
      projectId: row.id,
      userId: session.user.id,
      roleId: projectOwnerRoleId,
      invitedBy: session.user.id,
    });
    return row;
  });

  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.create",
    targetType: "project",
    targetId: projectRow.id,
    organizationId,
  });

  await recordUsage({
    organizationId,
    userId: session.user.id,
    projectId: projectRow.id,
    kind: "projects.max",
    amount: 1,
    unit: "projects",
  });

  // Branch by preview-provider name (CONTRACTS §10):
  //   - "sandbox": legacy createVmForRepo path stays.
  //   - "static" / "mock": call previewProvider.create() and synthesize the
  //     legacy `vm` field for backwards compat.
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
      vmId: previewMeta.projectId,
      previewUrl: previewMeta.previewUrl,
      devCommandTerminalUrl: previewMeta.terminalUrls?.devCommand ?? "",
      additionalTerminalsUrl: previewMeta.terminalUrls?.additional ?? "",
    };
  }

  const previewMetadata: RepoPreviewMetadata = {
    provider: previewProvider.name,
    capabilities: { ...previewProvider.capabilities },
    createdAt: new Date().toISOString(),
    migrationStatus: "ok",
  };

  const initialMetadata: RepoMetadata = {
    version: 2,
    sourceRepoId,
    name: inferredName,
    vm,
    conversations: [],
    deployments: [],
    productionDomain: null,
    productionDeploymentId: null,
    boilerplateVersion,
    preview: previewMetadata,
  };

  await writeRepoMetadata(projectRow.id, initialMetadata);

  const conversationId = randomUUID();
  const metadata = await createConversationInRepo(
    projectRow.id,
    initialMetadata,
    conversationId,
    payload.conversationTitle,
  );

  return {
    id: projectRow.id,
    metadata,
    conversationId,
  };
}
