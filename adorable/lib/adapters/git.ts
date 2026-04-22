// GitProvider — адаптер над git-хостингом.
//
// Контракт сознательно близок к Freestyle `freestyle.git.repos.*` чтобы
// callers (repo-storage.ts, deployment-status.ts, repos/route.ts) мигрировали
// с минимальной перестройкой. Существенные отличия:
//
//   1. Вместо `.ref({ repoId })` — `provider.getRepo(repoId)`. Тот же shape.
//   2. `commits.create` принимает UTF-8 content (не base64). Base64 применяется
//      только в contents.get для бинарных файлов по желанию.
//   3. Нет `serverless.*` / `identities.*` — это отдельные адаптеры (Phase 5
//      / Better Auth).
//
// Переключение через env `GIT_PROVIDER`:
//   - "gitea" — lib/adapters/git-gitea.ts (Phase 3 prod).
//   - "mock"  — in-memory для тестов.
//   - undefined → "gitea" в prod, "mock" в тестах.

export interface GitFileEntry {
  /** Тип записи в репозитории. */
  type: "file" | "dir";
  /**
   * UTF-8 содержимое для файлов. Для бинарных callers используют
   * `contentBase64`. Gitea API возвращает оба.
   */
  content: string;
  /** Raw base64 (Gitea возвращает этим полем). */
  contentBase64?: string;
  /** Полный путь относительно корня репо. */
  path: string;
  sha?: string;
}

export interface GitCommitMeta {
  sha: string;
  message: string;
  author: {
    name?: string;
    email?: string;
    date: string;
  };
}

export interface GitCommitFile {
  path: string;
  content: string;
  /** By default UTF-8. If true, `content` is already base64-encoded. */
  base64?: boolean;
}

export interface GitBranchInfo {
  defaultBranch: string;
}

export interface GithubSyncOptions {
  githubRepoName: string;
}

export interface GitRepoRef {
  repoId: string;
  branches: {
    getDefaultBranch: () => Promise<GitBranchInfo>;
  };
  contents: {
    /**
     * Get a single file (or dir listing). For a file returns type="file" and
     * `content` (utf-8) + `contentBase64`. For a dir returns type="dir" with
     * directory listing in content (JSON stringified array).
     */
    get: (opts: { path: string; rev: string }) => Promise<GitFileEntry>;
  };
  commits: {
    list: (opts: {
      limit?: number;
      order?: "asc" | "desc";
    }) => Promise<{ commits: GitCommitMeta[] }>;
    create: (opts: {
      message: string;
      branch: string;
      files: GitCommitFile[];
      author?: { name?: string; email?: string };
    }) => Promise<{ sha: string }>;
  };
  /**
   * Mirror-sync с GitHub (push). В Gitea реализации — push mirror через
   * admin API. В mock — no-op.
   */
  githubSync: {
    enable: (opts: GithubSyncOptions) => Promise<void>;
    disable: () => Promise<void>;
  };
}

export interface GitCreateRepoOptions {
  /** Имя репо. Если не задано — провайдер генерирует uuid-подобное. */
  name?: string;
  /** Если задано — клонирует из указанного URL (template import). */
  import?: {
    url: string;
    type: "git";
    commitMessage?: string;
  };
  /** Private/public. Дефолт private. */
  private?: boolean;
}

export interface GitProvider {
  name: string;
  /** Create a new repo. Returns repoId that can be used with getRepo. */
  createRepo: (opts: GitCreateRepoOptions) => Promise<{
    repoId: string;
    repo: GitRepoRef;
    /** Clone URL suitable for `git clone` (http[s]://...). */
    cloneUrl: string;
  }>;
  /** List repos owned by the authenticated org/user. */
  listRepos: (opts?: { limit?: number }) => Promise<
    Array<{ id: string; name: string }>
  >;
  /** Get a ref to an existing repo. Does not validate existence. */
  getRepo: (repoId: string) => GitRepoRef;
  /** Delete a repo (used by cleanup / tests). */
  deleteRepo: (repoId: string) => Promise<void>;
}

export type GitProviderName = "gitea" | "mock";

const normalizeProviderName = (
  raw?: string | null,
): GitProviderName | null => {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "gitea") return "gitea";
  if (v === "mock" || v === "test" || v === "fake") return "mock";
  return null;
};

export const resolveGitProviderName = (
  override?: string,
): GitProviderName => {
  const explicit =
    normalizeProviderName(override) ??
    normalizeProviderName(process.env["GIT_PROVIDER"]);
  if (explicit) return explicit;
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) return "mock";
  return "gitea";
};

export const createGitProvider = async (
  options: { providerOverride?: string } = {},
): Promise<GitProvider> => {
  const name = resolveGitProviderName(options.providerOverride);
  switch (name) {
    case "mock": {
      const mod = await import("./git-mock");
      return mod.createMockGitProvider();
    }
    case "gitea": {
      const mod = await import("./git-gitea");
      return mod.createGiteaGitProvider();
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown git provider: ${_exhaustive as string}`);
    }
  }
};
