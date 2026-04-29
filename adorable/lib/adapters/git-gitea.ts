// Gitea GitProvider через REST API v1.
//
// Endpoints (Gitea 1.22+):
//   POST   /api/v1/orgs/{org}/repos           — создать репо в org
//   POST   /api/v1/user/repos                 — создать репо у текущего юзера
//   POST   /api/v1/repos/migrate              — создать репо из import URL
//   GET    /api/v1/repos/{owner}/{repo}                         — metadata (default_branch)
//   GET    /api/v1/repos/{owner}/{repo}/contents/{path}?ref=... — читать файл
//   GET    /api/v1/repos/{owner}/{repo}/commits                 — список коммитов
//   POST   /api/v1/repos/{owner}/{repo}/contents                — batch change files
//   POST   /api/v1/repos/{owner}/{repo}/push_mirrors            — github push mirror
//   DELETE /api/v1/repos/{owner}/{repo}                         — удалить
//
// repoId в нашем внутреннем формате — "<owner>/<repo>" (full name). Это
// удобно, потому что все Gitea endpoints принимают owner/repo, а не
// numeric id.

import type {
  GitBranchInfo,
  GitCommitFile,
  GitCommitMeta,
  GitCreateRepoOptions,
  GitFileEntry,
  GitProvider,
  GitRepoRef,
  GithubSyncOptions,
} from "./git";

type GiteaConfig = {
  baseUrl: string;
  token: string;
  owner: string;
};

const readConfig = (): GiteaConfig => {
  const baseUrl = (process.env["GITEA_BASE_URL"] ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  const token = process.env["GITEA_TOKEN"] ?? "";
  const owner =
    process.env["GITEA_ORG"] ??
    process.env["GITEA_ADMIN_USER"] ??
    "adorable";
  if (!token) {
    throw new Error(
      "git-gitea: GITEA_TOKEN is not set. Run `npm run dev:infra:init-gitea` first.",
    );
  }
  return { baseUrl, token, owner };
};

type GiteaResponse = {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
};

const api = async (
  cfg: GiteaConfig,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<GiteaResponse> => {
  const res = await fetch(`${cfg.baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `token ${cfg.token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { ok: res.ok, status: res.status, json, text };
};

const parseRepoId = (
  repoId: string,
): { owner: string; repo: string } => {
  const parts = repoId.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`git-gitea: invalid repoId (expected owner/repo): ${repoId}`);
  }
  return { owner: parts[0], repo: parts[1] };
};

type GiteaRepoInfo = {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  clone_url: string;
  html_url: string;
};

type GiteaCommitInfo = {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
};

type GiteaContentInfo = {
  type: "file" | "dir" | "symlink" | "submodule";
  content?: string; // base64 for files
  path: string;
  sha?: string;
};

export const createGiteaGitProvider = (): GitProvider => {
  const cfg = readConfig();

  const buildRef = (repoId: string): GitRepoRef => {
    const { owner, repo } = parseRepoId(repoId);

    const getDefaultBranch: GitRepoRef["branches"]["getDefaultBranch"] =
      async (): Promise<GitBranchInfo> => {
        const r = await api(cfg, "GET", `/repos/${owner}/${repo}`);
        if (!r.ok) {
          throw new Error(
            `git-gitea: failed to fetch repo ${repoId} (${r.status}): ${r.text}`,
          );
        }
        const info = r.json as GiteaRepoInfo;
        return { defaultBranch: info.default_branch ?? "main" };
      };

    const getContents: GitRepoRef["contents"]["get"] = async ({
      path,
      rev,
    }): Promise<GitFileEntry> => {
      const encodedPath = path
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/");
      const r = await api(
        cfg,
        "GET",
        `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(rev)}`,
      );
      if (r.status === 404) {
        throw new Error(`git-gitea: file not found: ${path} @ ${rev}`);
      }
      if (!r.ok) {
        throw new Error(
          `git-gitea: contents.get failed (${r.status}): ${r.text}`,
        );
      }
      const info = r.json as GiteaContentInfo;
      if (info.type !== "file") {
        return {
          type: info.type === "dir" ? "dir" : "file",
          content: "",
          path,
        };
      }
      const b64 = (info.content ?? "").replace(/\n/g, "");
      return {
        type: "file",
        content: Buffer.from(b64, "base64").toString("utf8"),
        contentBase64: b64,
        path,
        sha: info.sha,
      };
    };

    const listCommits: GitRepoRef["commits"]["list"] = async ({
      limit = 50,
      order = "desc",
    } = {}) => {
      const q = `limit=${encodeURIComponent(String(limit))}&page=1`;
      const r = await api(cfg, "GET", `/repos/${owner}/${repo}/commits?${q}`);
      if (!r.ok) {
        throw new Error(
          `git-gitea: commits.list failed (${r.status}): ${r.text}`,
        );
      }
      const list = Array.isArray(r.json) ? (r.json as GiteaCommitInfo[]) : [];
      const commits: GitCommitMeta[] = list.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        author: {
          name: c.commit.author?.name,
          email: c.commit.author?.email,
          date: c.commit.author?.date ?? new Date().toISOString(),
        },
      }));
      return { commits: order === "asc" ? commits.slice().reverse() : commits };
    };

    /**
     * Batch-commit: посылаем один POST /contents с массивом files. Если
     * файл уже есть — нужен его sha для `update`. Для простоты: читаем
     * существующие shas параллельно и решаем create/update по факту.
     */
    const createCommit: GitRepoRef["commits"]["create"] = async ({
      message,
      branch,
      files,
      author,
    }) => {
      if (files.length === 0) {
        throw new Error("git-gitea: commits.create requires at least 1 file");
      }

      // Probe existence of each path to decide create vs update.
      const probes = await Promise.all(
        files.map(async (f) => {
          const encoded = f.path
            .split("/")
            .filter(Boolean)
            .map(encodeURIComponent)
            .join("/");
          const r = await api(
            cfg,
            "GET",
            `/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
          );
          if (r.ok && r.json && typeof r.json === "object" && "sha" in r.json) {
            return (r.json as { sha: string }).sha;
          }
          return null;
        }),
      );

      const changes = files.map((f, i) => {
        const content = f.base64
          ? f.content
          : Buffer.from(f.content, "utf8").toString("base64");
        const sha = probes[i];
        return {
          operation: sha ? "update" : "create",
          path: f.path,
          content,
          ...(sha ? { sha } : {}),
        };
      });

      const r = await api(
        cfg,
        "POST",
        `/repos/${owner}/${repo}/contents`,
        {
          branch,
          message,
          ...(author
            ? {
                author: {
                  name: author.name ?? "Adorable",
                  email: author.email ?? "adorable@localhost",
                },
                committer: {
                  name: author.name ?? "Adorable",
                  email: author.email ?? "adorable@localhost",
                },
              }
            : {}),
          files: changes,
        },
      );
      if (!r.ok) {
        throw new Error(
          `git-gitea: commits.create failed (${r.status}): ${r.text}`,
        );
      }
      const resp = r.json as { commit?: { sha?: string } } | undefined;
      const sha = resp?.commit?.sha ?? "";
      return { sha };
    };

    const githubSyncEnable = async ({
      githubRepoName,
    }: GithubSyncOptions): Promise<void> => {
      const remote = `https://github.com/${githubRepoName}.git`;
      const r = await api(cfg, "POST", `/repos/${owner}/${repo}/push_mirrors`, {
        remote_address: remote,
        interval: "8h0m0s",
        sync_on_commit: true,
      });
      if (!r.ok) {
        throw new Error(
          `git-gitea: push_mirror enable failed (${r.status}): ${r.text}`,
        );
      }
    };

    const githubSyncDisable = async (): Promise<void> => {
      const r = await api(cfg, "GET", `/repos/${owner}/${repo}/push_mirrors`);
      if (!r.ok) return;
      const list = Array.isArray(r.json) ? (r.json as Array<{ remote_name?: string }>) : [];
      for (const m of list) {
        if (!m.remote_name) continue;
        await api(
          cfg,
          "DELETE",
          `/repos/${owner}/${repo}/push_mirrors/${encodeURIComponent(m.remote_name)}`,
        );
      }
    };

    return {
      repoId,
      branches: { getDefaultBranch },
      contents: { get: getContents },
      commits: { list: listCommits, create: createCommit },
      githubSync: { enable: githubSyncEnable, disable: githubSyncDisable },
    };
  };

  const createRepo: GitProvider["createRepo"] = async (
    opts: GitCreateRepoOptions,
  ) => {
    const name = opts.name ?? `adorable-${Date.now().toString(36)}`;
    const safeName = name.replace(/[^A-Za-z0-9._-]/g, "-");
    const isPrivate = opts.private ?? true;

    let created: GiteaRepoInfo;
    if (opts.import) {
      const r = await api(cfg, "POST", `/repos/migrate`, {
        clone_addr: opts.import.url,
        repo_name: safeName,
        repo_owner: cfg.owner,
        service: "git",
        private: isPrivate,
        description: `Imported into ${cfg.owner}`,
        mirror: false,
      });
      if (!r.ok) {
        throw new Error(
          `git-gitea: migrate failed (${r.status}): ${r.text}`,
        );
      }
      created = r.json as GiteaRepoInfo;
    } else {
      // If the owner is the authenticated user itself, /user/repos works.
      // For organization-owned repos we'd use /orgs/{org}/repos. Our dev
      // setup creates repos under the admin user, so /user/repos is fine.
      const endpoint =
        process.env["GITEA_ORG"] &&
        process.env["GITEA_ORG"] !== process.env["GITEA_ADMIN_USER"]
          ? `/orgs/${encodeURIComponent(cfg.owner)}/repos`
          : "/user/repos";
      const r = await api(cfg, "POST", endpoint, {
        name: safeName,
        private: isPrivate,
        auto_init: true,
        default_branch: "main",
      });
      if (!r.ok) {
        throw new Error(
          `git-gitea: createRepo failed (${r.status}): ${r.text}`,
        );
      }
      created = r.json as GiteaRepoInfo;
    }

    const repoId = created.full_name;
    return {
      repoId,
      repo: buildRef(repoId),
      cloneUrl: created.clone_url,
    };
  };

  const listRepos: GitProvider["listRepos"] = async ({ limit = 100 } = {}) => {
    // Gitea caps `?limit=N` at its per-page setting (50 by default).
    // Without pagination an instance with >50 repos hides everything
    // past page 1, which silently breaks ACL checks for newly-created
    // projects (the wrapper just isn't in the returned list → identity
    // sees a 403 on the API for its own repo). Page until we either
    // hit the caller's limit or run out.
    const PAGE_SIZE = 50;
    const out: Array<{ id: string; name: string }> = [];
    let page = 1;
    while (out.length < limit) {
      const r = await api(
        cfg,
        "GET",
        `/users/${encodeURIComponent(cfg.owner)}/repos?limit=${PAGE_SIZE}&page=${page}`,
      );
      if (!r.ok) break;
      const list = Array.isArray(r.json) ? (r.json as GiteaRepoInfo[]) : [];
      if (list.length === 0) break;
      for (const x of list) {
        out.push({ id: x.full_name, name: x.name });
        if (out.length >= limit) break;
      }
      if (list.length < PAGE_SIZE) break; // last page
      page++;
    }
    return out;
  };

  const getRepo: GitProvider["getRepo"] = (repoId: string) => buildRef(repoId);

  const deleteRepo: GitProvider["deleteRepo"] = async (
    repoId: string,
  ): Promise<void> => {
    const { owner, repo } = parseRepoId(repoId);
    const r = await api(cfg, "DELETE", `/repos/${owner}/${repo}`);
    if (!r.ok && r.status !== 404) {
      throw new Error(
        `git-gitea: deleteRepo failed (${r.status}): ${r.text}`,
      );
    }
  };

  const listAllFiles: NonNullable<GitProvider["listAllFiles"]> = async (
    repoId: string,
    opts?: { rev?: string },
  ) => {
    const { owner, repo } = parseRepoId(repoId);
    let rev = opts?.rev;
    if (!rev) {
      const info = await api(cfg, "GET", `/repos/${owner}/${repo}`);
      const data = (info.json ?? {}) as { default_branch?: string };
      rev = data.default_branch ?? "main";
    }
    // Gitea git/trees/<ref>?recursive=true возвращает плоский список с
    // type=blob/tree. Берём только blob'ы.
    const treeRes = await api(
      cfg,
      "GET",
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(rev)}?recursive=true&per_page=1000`,
    );
    if (!treeRes.ok) {
      throw new Error(
        `git-gitea: listAllFiles tree failed (${treeRes.status}): ${treeRes.text}`,
      );
    }
    const treeData = (treeRes.json ?? {}) as {
      tree?: Array<{ path: string; type: string }>;
    };
    const blobs = (treeData.tree ?? []).filter((e) => e.type === "blob");

    const files: Array<{ path: string; content: string }> = [];
    const ref = buildRef(repoId);
    for (const blob of blobs) {
      try {
        const entry = await ref.contents.get({ path: blob.path, rev });
        if (entry.type === "file") {
          files.push({ path: blob.path, content: entry.content });
        }
      } catch (err) {
        process.stderr.write(
          `git-gitea: listAllFiles skipped ${blob.path}: ${(err as Error).message}\n`,
        );
      }
    }
    return files;
  };

  const renameRepo: NonNullable<GitProvider["renameRepo"]> = async (
    repoId: string,
    newName: string,
  ) => {
    const { owner, repo } = parseRepoId(repoId);
    const r = await api(cfg, "PATCH", `/repos/${owner}/${repo}`, { name: newName });
    if (!r.ok) {
      throw new Error(`git-gitea: renameRepo failed (${r.status}): ${r.text}`);
    }
    const data = (r.json ?? {}) as { full_name?: string; clone_url?: string };
    const newRepoId = data.full_name ?? `${owner}/${newName}`;
    return {
      repoId: newRepoId,
      cloneUrl: data.clone_url,
    };
  };

  return {
    name: "gitea",
    createRepo,
    listRepos,
    getRepo,
    deleteRepo,
    renameRepo,
    listAllFiles,
  };
};
