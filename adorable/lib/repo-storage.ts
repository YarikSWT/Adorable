import { type UIMessage } from "ai";
import { getGitProvider } from "@/lib/git/provider-singleton";

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

export const readRepoMetadata = async (
  repoId: string,
): Promise<RepoMetadata | null> => {
  const metadata = await readJsonFile<StoredRepoMetadata>(
    repoId,
    ADORABLE_METADATA_PATH,
  );
  if (!metadata) return null;
  if (!metadata.sourceRepoId) return null;

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

export const resolveSourceRepoId = async (repoId: string) => {
  const metadata = await readRepoMetadata(repoId);
  return metadata?.sourceRepoId ?? repoId;
};

export const writeRepoMetadata = async (
  repoId: string,
  metadata: RepoMetadata,
) => {
  await writeCommit(repoId, "Update adorable metadata", [
    { path: ADORABLE_METADATA_PATH, content: encodeJson(metadata) },
  ]);
};

export const createConversationInRepo = async (
  repoId: string,
  metadata: RepoMetadata,
  conversationId: string,
  initialTitle?: string,
) => {
  const latestMetadata = (await readRepoMetadata(repoId)) ?? metadata;
  const now = new Date().toISOString();
  const normalizedInitialTitle = initialTitle?.trim().replace(/\s+/g, " ");
  const fallbackTitle =
    normalizedInitialTitle && normalizedInitialTitle.length > 0
      ? normalizedInitialTitle.slice(0, 60)
      : `Conversation ${latestMetadata.conversations.length + 1}`;

  const nextMetadata: RepoMetadata = {
    ...metadata,
    ...latestMetadata,
    sourceRepoId: latestMetadata.sourceRepoId,
    conversations: [
      {
        id: conversationId,
        title: fallbackTitle,
        createdAt: now,
        updatedAt: now,
      },
      ...latestMetadata.conversations,
    ],
  };

  await writeCommit(repoId, "Create conversation", [
    {
      path: ADORABLE_METADATA_PATH,
      content: encodeJson(nextMetadata),
    },
    {
      path: conversationPath(conversationId),
      content: encodeJson([]),
    },
  ]);

  return nextMetadata;
};

export const readConversationMessages = async (
  repoId: string,
  conversationId: string,
): Promise<UIMessage[]> => {
  return (
    (await readJsonFile<UIMessage[]>(
      repoId,
      conversationPath(conversationId),
    )) ?? []
  );
};

export const saveConversationMessages = async (
  repoId: string,
  metadata: RepoMetadata,
  conversationId: string,
  messages: UIMessage[],
) => {
  const latestMetadata = (await readRepoMetadata(repoId)) ?? metadata;
  const now = new Date().toISOString();

  const existing = latestMetadata.conversations.find(
    (c) => c.id === conversationId,
  );
  const fallbackTitle =
    existing?.title ??
    `Conversation ${latestMetadata.conversations.length + 1}`;
  const title = deriveConversationTitle(messages, fallbackTitle);

  const updatedConversation: RepoConversationSummary = {
    id: conversationId,
    title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const nextConversations = [
    updatedConversation,
    ...latestMetadata.conversations.filter((c) => c.id !== conversationId),
  ];

  const nextMetadata: RepoMetadata = {
    ...latestMetadata,
    conversations: nextConversations,
  };

  await writeCommit(repoId, "Update conversation", [
    {
      path: ADORABLE_METADATA_PATH,
      content: encodeJson(nextMetadata),
    },
    {
      path: conversationPath(conversationId),
      content: encodeJson(messages),
    },
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

  await writeCommit(repoId, "Record deployment", [
    {
      path: ADORABLE_METADATA_PATH,
      content: encodeJson(nextMetadata),
    },
  ]);

  return nextMetadata;
};

export const setRepoProductionDomain = async (
  repoId: string,
  metadata: RepoMetadata,
  productionDomain: string,
) => {
  const latestMetadata = (await readRepoMetadata(repoId)) ?? metadata;
  const nextMetadata: RepoMetadata = {
    ...latestMetadata,
    productionDomain,
  };

  await writeCommit(repoId, "Configure production domain", [
    {
      path: ADORABLE_METADATA_PATH,
      content: encodeJson(nextMetadata),
    },
  ]);

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

  await writeCommit(repoId, "Promote deployment to production", [
    {
      path: ADORABLE_METADATA_PATH,
      content: encodeJson(nextMetadata),
    },
  ]);

  return nextMetadata;
};
