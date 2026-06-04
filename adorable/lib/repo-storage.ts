import { type UIMessage } from "ai";
import { desc, eq } from "drizzle-orm";
import { getGitProvider } from "@/lib/git/provider-singleton";
import { dedupeToolCallsAcrossMessages } from "@/lib/cross-message-tool-dedup";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { conversations } from "@/lib/db/schema/conversations";
import { getProjectByExternalRepoId } from "@/lib/db/queries/projects";
import {
  loadConversationUIMessages,
  saveConversationMessages as savePgConversationMessages,
  ensureConversation,
} from "@/lib/db/queries/transcript";

export const ADORABLE_METADATA_PATH = "metadata.json";
export const ADORABLE_CONVERSATIONS_DIR = "conversations";
/**
 * Префикс для имён wrapper-репо в Gitea. Раньше использовалось
 * "adorable-meta - " (с пробелами) для красоты, но Gitea sanitiz'ит
 * пробелы в дефисы → URL содержат "---". Без пробелов префикс остаётся
 * чистым "adorable-meta-<uuid>" после roundtrip'а.
 *
 * Регулярка `WRAPPER_NAME_RE` ниже толерантна к обоим формам — старые
 * репо в Gitea (с "adorable-meta---", "adorable-meta-----...", и т.д.)
 * по-прежнему распознаются, чтобы пользователь не потерял к ним доступ
 * после миграции.
 */
export const ADORABLE_WRAPPER_REPO_PREFIX = "adorable-meta-";

const WRAPPER_NAME_RE = /^adorable-meta(?:[\s-]+|$)/i;

export const isWrapperRepoName = (name: string | null | undefined): boolean => {
  if (!name) return false;
  return WRAPPER_NAME_RE.test(name);
};

export const stripWrapperPrefix = (
  name: string | null | undefined,
): string | undefined => {
  if (!name) return undefined;
  const m = name.match(WRAPPER_NAME_RE);
  if (!m) return name;
  return name.slice(m[0].length) || undefined;
};

export type RepoVmMetadata = {
  vmId: string;
  previewUrl: string;
  devCommandTerminalUrl: string;
  additionalTerminalsUrl: string;
};

export type RepoConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type RepoDeploymentSummary = {
  commitSha: string;
  commitMessage: string;
  commitDate: string;
  domain: string;
  url: string;
  deploymentId: string | null;
  state: "idle" | "deploying" | "live" | "failed";
};

/**
 * Pinned preview-provider state per project. Source: CONTRACTS §12,
 * ADR-008 (boilerplate versioning), ADR-015 (capability pinning).
 *
 * Optional in v2 metadata — existing repos created before Phase 4
 * don't have it. Phase 5 migration script backfills with defaults
 * derived from the active provider at migration time.
 */
export type RepoPreviewMetadata = {
  /** "static" | "sandbox" | "mock" — the provider this project lives on. */
  provider: "static" | "sandbox" | "mock";
  /** Pinned copy of provider.capabilities at create time. */
  capabilities: {
    shellAccess: boolean;
    customDependencies: boolean;
    serverRuntime: boolean;
    hotReload: boolean;
    manualRebuild: boolean;
  };
  /** ISO-timestamp of preview environment creation. */
  createdAt: string;
  /**
   * Migration status when the global env shifts away from the provider
   * this project was created on. Default "ok".
   */
  migrationStatus?: "ok" | "needs-review" | "migrating";
  /** ISO-timestamp of last promote (POST /repos/<id>/promote). */
  publishedAt?: string;
  /** Build id that the `published` symlink currently points to. */
  publishedBuildId?: string;
};

export type RepoMetadata = {
  version: 2;
  sourceRepoId: string;
  name?: string;
  vm: RepoVmMetadata;
  conversations: RepoConversationSummary[];
  deployments: RepoDeploymentSummary[];
  productionDomain: string | null;
  productionDeploymentId: string | null;
  /**
   * Semver of the boilerplate the project was created on. Read from
   * `templates/vite-react/VERSION` at create time. Optional until
   * Phase 5 migration backfills "1.0.0" for existing repos.
   * Source: ADR-008.
   */
  boilerplateVersion?: string;
  /** Pinned preview-provider state. Optional — see RepoPreviewMetadata. */
  preview?: RepoPreviewMetadata;
};

type StoredRepoMetadata = {
  version: 2;
  sourceRepoId: string;
  name?: string;
  vm: RepoVmMetadata;
  conversations: RepoConversationSummary[];
  deployments: RepoDeploymentSummary[];
  productionDomain: string | null;
  productionDeploymentId: string | null;
  boilerplateVersion?: string;
  preview?: RepoPreviewMetadata;
};

const encodeJson = (value: unknown) => {
  return JSON.stringify(value, null, 2);
};

const getDefaultBranch = async (repoId: string) => {
  const provider = await getGitProvider();
  const repo = provider.getRepo(repoId);
  const { defaultBranch } = await repo.branches.getDefaultBranch();
  return defaultBranch;
};

const readJsonFile = async <T>(
  repoId: string,
  path: string,
): Promise<T | null> => {
  const provider = await getGitProvider();
  const repo = provider.getRepo(repoId);
  const rev = await getDefaultBranch(repoId);

  try {
    const entry = await repo.contents.get({ path, rev });
    if (entry.type !== "file") return null;
    // GitProvider already decodes to utf-8 in `content`.
    return JSON.parse(entry.content) as T;
  } catch {
    return null;
  }
};

const writeCommit = async (
  repoId: string,
  message: string,
  files: Array<{ path: string; content: string }>,
) => {
  const provider = await getGitProvider();
  const repo = provider.getRepo(repoId);
  const branch = await getDefaultBranch(repoId);

  await repo.commits.create({
    message,
    branch,
    files,
    author: {
      name: "Adorable",
      email: "adorable@localhost",
    },
  });
};

const conversationPath = (conversationId: string) => {
  return `${ADORABLE_CONVERSATIONS_DIR}/${conversationId}.json`;
};

const deriveConversationTitle = (
  messages: UIMessage[] | undefined,
  fallback: string,
): string => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return fallback;
  }

  const userMessage = messages.find((m) => m.role === "user");
  const textPart = userMessage?.parts?.find((part) => part.type === "text");
  const text = textPart && "text" in textPart ? textPart.text : "";
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return fallback;
  return clean.slice(0, 60);
};

// ─────────────────────── PG-backed metadata + transcript ───────────────────────
// (спец v2.1 §3.2/§3.3) The project metadata that used to live in the Gitea
// adorable-meta wrapper repo now lives in projects.metadata (jsonb) and the
// transcript in conversations/messages. The Gitea helpers above are retained
// only for the one-time migration (lib/db/migrate-metadata-from-gitea.ts).

/** The persisted blob = RepoMetadata minus the (PG-row-sourced) conversations. */
type MetadataBlob = Omit<StoredRepoMetadata, "conversations">;

/**
 * Resolve the project for an external repoId, swallowing DB errors (so callers
 * fall back to the legacy Gitea path for un-migrated projects / non-DB test
 * envs). Returns null if there is no project or the DB is unavailable.
 */
const tryProject = async (repoId: string) => {
  try {
    return await getProjectByExternalRepoId(repoId);
  } catch {
    return null;
  }
};

/** A project counts as PG-migrated once its metadata blob is present. */
const hasPgMetadata = (
  p: Awaited<ReturnType<typeof tryProject>>,
): p is NonNullable<typeof p> & { metadata: MetadataBlob } => {
  const blob = (p?.metadata ?? null) as MetadataBlob | null;
  return !!blob && !!blob.sourceRepoId;
};

// ── legacy Gitea read/write (fallback for un-migrated projects) ──
const readGiteaMetadata = async (
  repoId: string,
): Promise<RepoMetadata | null> => {
  const metadata = await readJsonFile<StoredRepoMetadata>(
    repoId,
    ADORABLE_METADATA_PATH,
  );
  if (!metadata || !metadata.sourceRepoId) return null;
  return {
    version: metadata.version,
    sourceRepoId: metadata.sourceRepoId,
    name: metadata.name,
    vm: metadata.vm,
    conversations: metadata.conversations,
    deployments: metadata.deployments,
    productionDomain: metadata.productionDomain,
    productionDeploymentId: metadata.productionDeploymentId,
    ...(metadata.boilerplateVersion !== undefined
      ? { boilerplateVersion: metadata.boilerplateVersion }
      : {}),
    ...(metadata.preview !== undefined ? { preview: metadata.preview } : {}),
  };
};

const conversationSummaries = async (
  projectId: string,
): Promise<RepoConversationSummary[]> => {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? "Conversation",
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
};

export const readRepoMetadata = async (
  repoId: string,
): Promise<RepoMetadata | null> => {
  const project = await tryProject(repoId);
  if (!hasPgMetadata(project)) {
    // Un-migrated / no-DB: read legacy Gitea wrapper.
    return readGiteaMetadata(repoId);
  }
  const blob = project.metadata;
  return {
    version: 2,
    sourceRepoId: blob.sourceRepoId,
    name: blob.name,
    vm: blob.vm,
    conversations: await conversationSummaries(project.id),
    deployments: blob.deployments ?? [],
    productionDomain: blob.productionDomain ?? null,
    productionDeploymentId: blob.productionDeploymentId ?? null,
    ...(blob.boilerplateVersion !== undefined
      ? { boilerplateVersion: blob.boilerplateVersion }
      : {}),
    ...(blob.preview !== undefined ? { preview: blob.preview } : {}),
  };
};

export const resolveSourceRepoId = async (repoId: string) => {
  const metadata = await readRepoMetadata(repoId);
  return metadata?.sourceRepoId ?? repoId;
};

/** Persist the metadata blob to PG (conversations stripped — they are PG rows). */
const saveMetadataBlobPg = async (
  projectId: string,
  metadata: RepoMetadata,
): Promise<void> => {
  const { conversations: _conversations, ...blob } = metadata;
  void _conversations;
  await db
    .update(projects)
    .set({ metadata: blob as Record<string, unknown> })
    .where(eq(projects.id, projectId));
};

/** Legacy Gitea write (fallback). */
const writeGiteaMetadata = async (
  repoId: string,
  metadata: RepoMetadata,
): Promise<void> => {
  await writeCommit(repoId, "Update adorable metadata", [
    { path: ADORABLE_METADATA_PATH, content: encodeJson(metadata) },
  ]);
};

export const writeRepoMetadata = async (
  repoId: string,
  metadata: RepoMetadata,
) => {
  const project = await tryProject(repoId);
  if (project) await saveMetadataBlobPg(project.id, metadata);
  else await writeGiteaMetadata(repoId, metadata);
};

export const createConversationInRepo = async (
  repoId: string,
  metadata: RepoMetadata,
  conversationId: string,
  initialTitle?: string,
) => {
  const normalizedInitialTitle = initialTitle?.trim().replace(/\s+/g, " ");
  const title =
    normalizedInitialTitle && normalizedInitialTitle.length > 0
      ? normalizedInitialTitle.slice(0, 60)
      : "Conversation 1";

  const project = await tryProject(repoId);
  if (project) {
    await ensureConversation(db, {
      conversationId,
      projectId: project.id,
      userId: project.createdByUserId,
      title,
    });
    if (!hasPgMetadata(project)) await saveMetadataBlobPg(project.id, metadata);
    return (await readRepoMetadata(repoId)) ?? metadata;
  }

  // Legacy Gitea fallback.
  const latestMetadata = (await readGiteaMetadata(repoId)) ?? metadata;
  const now = new Date().toISOString();
  const nextMetadata: RepoMetadata = {
    ...metadata,
    ...latestMetadata,
    sourceRepoId: latestMetadata.sourceRepoId,
    conversations: [
      { id: conversationId, title, createdAt: now, updatedAt: now },
      ...latestMetadata.conversations,
    ],
  };
  await writeCommit(repoId, "Create conversation", [
    { path: ADORABLE_METADATA_PATH, content: encodeJson(nextMetadata) },
    { path: conversationPath(conversationId), content: encodeJson([]) },
  ]);
  return nextMetadata;
};

export const readConversationMessages = async (
  repoId: string,
  conversationId: string,
): Promise<UIMessage[]> => {
  const project = await tryProject(repoId);
  if (project) return loadConversationUIMessages(db, conversationId);
  return (
    (await readJsonFile<UIMessage[]>(repoId, conversationPath(conversationId))) ??
    []
  );
};

/**
 * Sanitise a conversation transcript before persisting:
 *  - Drops user/tool messages that ended up with zero parts. The
 *    assistant-ui runtime sometimes emits a placeholder user/tool slot
 *    that never gets filled; persisting it loads back as a phantom row
 *    and the iteration in `tapResources` can then duplicate-key on the
 *    surrounding tool-call parts.
 *  - Within each message, dedupes parts by `toolCallId`. Keeps the
 *    LAST occurrence, since later events (output-available) supersede
 *    earlier ones (input-streaming).
 *  - ACROSS messages, dedupes parts by `toolCallId` (delegated to
 *    `dedupeToolCallsAcrossMessages`). After a step-boundary the same
 *    callId can appear in two messages; the older copy carries strictly
 *    less information than the newer (lifecycle is monotonically
 *    informational), so keeping the last occurrence is safe and
 *    cleaner for both persisted state and LLM context on next turn.
 *
 * Pure / side-effect-free so it's covered by a unit test.
 */
export const sanitiseConversationMessages = (
  messages: UIMessage[],
): UIMessage[] => {
  const cleaned: UIMessage[] = [];
  for (const msg of messages) {
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    if (parts.length === 0 && msg.role !== "assistant") {
      // phantom placeholder — drop
      continue;
    }
    // Dedupe by toolCallId, keeping last write.
    const lastIdxByCallId = new Map<string, number>();
    parts.forEach((p, i) => {
      const callId = (p as { toolCallId?: string }).toolCallId;
      if (callId != null) lastIdxByCallId.set(callId, i);
    });
    const dedupedParts = parts.filter((p, i) => {
      const callId = (p as { toolCallId?: string }).toolCallId;
      if (callId == null) return true;
      return lastIdxByCallId.get(callId) === i;
    });
    cleaned.push({ ...msg, parts: dedupedParts });
  }
  // Final pass: cross-message dedup. Identical toolCallId across two
  // assistant messages (typical post step-boundary) would still crash
  // tapResources on reload; this drops earlier copies thread-wide.
  return dedupeToolCallsAcrossMessages(cleaned);
};

export const saveConversationMessages = async (
  repoId: string,
  metadata: RepoMetadata,
  conversationId: string,
  messages: UIMessage[],
) => {
  const sanitisedMessages = sanitiseConversationMessages(messages);
  const project = await tryProject(repoId);

  if (project) {
    // PG path: ensure the conversation row, persist transcript, refresh title.
    await ensureConversation(db, {
      conversationId,
      projectId: project.id,
      userId: project.createdByUserId,
    });
    await savePgConversationMessages(db, {
      conversationId,
      messages: sanitisedMessages,
    });
    const existing = (await readRepoMetadata(repoId))?.conversations.find(
      (c) => c.id === conversationId,
    );
    const title = deriveConversationTitle(
      sanitisedMessages,
      existing?.title ?? "Conversation 1",
    );
    await db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    if (!hasPgMetadata(project)) await saveMetadataBlobPg(project.id, metadata);
    return (await readRepoMetadata(repoId)) ?? metadata;
  }

  // Legacy Gitea fallback.
  const latestMetadata = (await readGiteaMetadata(repoId)) ?? metadata;
  const now = new Date().toISOString();
  const existing = latestMetadata.conversations.find(
    (c) => c.id === conversationId,
  );
  const title = deriveConversationTitle(
    sanitisedMessages,
    existing?.title ?? `Conversation ${latestMetadata.conversations.length + 1}`,
  );
  const nextMetadata: RepoMetadata = {
    ...latestMetadata,
    conversations: [
      { id: conversationId, title, createdAt: existing?.createdAt ?? now, updatedAt: now },
      ...latestMetadata.conversations.filter((c) => c.id !== conversationId),
    ],
  };
  await writeCommit(repoId, "Update conversation", [
    { path: ADORABLE_METADATA_PATH, content: encodeJson(nextMetadata) },
    { path: conversationPath(conversationId), content: encodeJson(sanitisedMessages) },
  ]);
  return nextMetadata;
};

export const addRepoDeployment = async (
  repoId: string,
  metadata: RepoMetadata,
  deployment: RepoDeploymentSummary,
) => {
  const latestMetadata = (await readRepoMetadata(repoId)) ?? metadata;
  const nextMetadata: RepoMetadata = {
    ...latestMetadata,
    deployments: [
      deployment,
      ...latestMetadata.deployments.filter(
        (d) => d.commitSha !== deployment.commitSha,
      ),
    ],
  };
  await writeRepoMetadata(repoId, nextMetadata);
  return nextMetadata;
};

export const setRepoProductionDomain = async (
  repoId: string,
  metadata: RepoMetadata,
  productionDomain: string,
) => {
  const latestMetadata = (await readRepoMetadata(repoId)) ?? metadata;
  const nextMetadata: RepoMetadata = { ...latestMetadata, productionDomain };
  await writeRepoMetadata(repoId, nextMetadata);
  return nextMetadata;
};

export const promoteRepoDeploymentToProduction = async (
  repoId: string,
  metadata: RepoMetadata,
  productionDeploymentId: string,
) => {
  const latestMetadata = (await readRepoMetadata(repoId)) ?? metadata;
  const nextMetadata: RepoMetadata = {
    ...latestMetadata,
    productionDeploymentId,
  };
  await writeRepoMetadata(repoId, nextMetadata);
  return nextMetadata;
};
