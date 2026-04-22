// In-memory GitProvider для тестов.
//
// Хранит каждое репо как {files: Map<path,content>, commits: Array, branch}.
// Поддерживает базовые операции: create, ref, commits.list/create,
// contents.get, branches.getDefaultBranch, githubSync (no-op).

import { createHash, randomUUID } from "node:crypto";

import type {
  GitCommitFile,
  GitCommitMeta,
  GitCreateRepoOptions,
  GitFileEntry,
  GitProvider,
  GitRepoRef,
} from "./git";

type RepoState = {
  repoId: string;
  name: string;
  defaultBranch: string;
  /** path → utf-8 content (latest state of default branch). */
  files: Map<string, string>;
  commits: GitCommitMeta[];
  githubSyncTarget: string | null;
};

const toBase64 = (utf8: string): string =>
  Buffer.from(utf8, "utf8").toString("base64");

const shortSha = (input: string): string =>
  createHash("sha1").update(input).digest("hex");

export interface MockGitProvider extends GitProvider {
  /** Test helper — seed files bypassing commit machinery. */
  seedFiles: (repoId: string, files: Record<string, string>) => void;
  /** Test helper — peek raw state. */
  inspect: (repoId: string) => RepoState | undefined;
  /** Clear everything. */
  reset: () => void;
}

export const createMockGitProvider = (): MockGitProvider => {
  const store = new Map<string, RepoState>();

  const buildRef = (state: RepoState): GitRepoRef => ({
    repoId: state.repoId,
    branches: {
      getDefaultBranch: async () => ({ defaultBranch: state.defaultBranch }),
    },
    contents: {
      get: async ({ path }): Promise<GitFileEntry> => {
        const content = state.files.get(path);
        if (content === undefined) {
          throw new Error(`mock-git: file not found: ${path}`);
        }
        return {
          type: "file",
          content,
          contentBase64: toBase64(content),
          path,
        };
      },
    },
    commits: {
      list: async ({ limit = 50, order = "desc" } = {}) => {
        const sorted = [...state.commits];
        if (order === "desc") sorted.reverse();
        return { commits: sorted.slice(0, limit) };
      },
      create: async ({ message, branch, files, author }) => {
        if (branch !== state.defaultBranch) {
          throw new Error(
            `mock-git: branch ${branch} ≠ default ${state.defaultBranch}`,
          );
        }
        for (const f of files) {
          const content = f.base64
            ? Buffer.from(f.content, "base64").toString("utf8")
            : f.content;
          state.files.set(f.path, content);
        }
        const sha = shortSha(
          `${state.repoId}:${state.commits.length}:${message}:${Date.now()}:${randomUUID()}`,
        );
        state.commits.push({
          sha,
          message,
          author: {
            name: author?.name,
            email: author?.email,
            date: new Date().toISOString(),
          },
        });
        return { sha };
      },
    },
    githubSync: {
      enable: async ({ githubRepoName }) => {
        state.githubSyncTarget = githubRepoName;
      },
      disable: async () => {
        state.githubSyncTarget = null;
      },
    },
  });

  const createRepo: GitProvider["createRepo"] = async (
    opts: GitCreateRepoOptions,
  ) => {
    const repoId = randomUUID();
    const name = opts.name ?? `mock-repo-${repoId.slice(0, 8)}`;
    const state: RepoState = {
      repoId,
      name,
      defaultBranch: "main",
      files: new Map(),
      commits: [],
      githubSyncTarget: null,
    };

    if (opts.import) {
      // Simulate template import: seed a minimal package.json so contents.get
      // has something to return.
      const bootstrap: GitCommitFile[] = [
        { path: "package.json", content: '{"name":"imported"}' },
        { path: "README.md", content: `# ${name}\n` },
      ];
      for (const f of bootstrap) {
        state.files.set(f.path, f.content);
      }
      state.commits.push({
        sha: shortSha(`${repoId}:bootstrap:${Date.now()}:${randomUUID()}`),
        message: opts.import.commitMessage ?? "Initial commit",
        author: {
          name: "Adorable",
          email: "adorable@localhost",
          date: new Date().toISOString(),
        },
      });
    }

    store.set(repoId, state);
    return {
      repoId,
      repo: buildRef(state),
      cloneUrl: `mock://git/${repoId}.git`,
    };
  };

  const listRepos: GitProvider["listRepos"] = async ({ limit = 100 } = {}) => {
    return Array.from(store.values())
      .slice(0, limit)
      .map((s) => ({ id: s.repoId, name: s.name }));
  };

  const getRepo: GitProvider["getRepo"] = (repoId: string) => {
    const state = store.get(repoId);
    if (!state) throw new Error(`mock-git: repo not found: ${repoId}`);
    return buildRef(state);
  };

  const deleteRepo: GitProvider["deleteRepo"] = async (repoId: string) => {
    store.delete(repoId);
  };

  const seedFiles: MockGitProvider["seedFiles"] = (repoId, files) => {
    const state = store.get(repoId);
    if (!state) throw new Error(`mock-git: repo not found: ${repoId}`);
    for (const [path, content] of Object.entries(files)) {
      state.files.set(path, content);
    }
  };

  const inspect: MockGitProvider["inspect"] = (repoId) => store.get(repoId);

  const reset: MockGitProvider["reset"] = () => store.clear();

  return {
    name: "mock",
    createRepo,
    listRepos,
    getRepo,
    deleteRepo,
    seedFiles,
    inspect,
    reset,
  };
};
