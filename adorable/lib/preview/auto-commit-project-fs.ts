// Static-mode auto-commit: snapshot всё что лежит в ProjectFs (= scratch
// dir статика-проекта) одним батч-коммитом в source-репо Gitea.
//
// Параллель с lib/api/chat/route.ts autoCommitWorkspace (sandbox-mode), но
// читает через ProjectFs API (whitelist-aware) вместо vm.exec/find.
//
// Контракт: каждый chat onFinish в static-mode вызывает эту функцию;
// результат — один git commit в source-репо. Без сетевых запросов от
// агента.

import type { ProjectFs } from "@/lib/adapters/preview";
import type { GitProvider } from "@/lib/adapters/git";

export interface AutoCommitProjectFsOptions {
  fs: ProjectFs;
  gitProvider: GitProvider;
  sourceRepoId: string;
  /** Skip files larger than this (default 512 KiB matches sandbox autoCommit). */
  maxFileBytes?: number;
  /** Override commit message format (sees fileCount). */
  commitMessage?: (fileCount: number) => string;
  /** Commit author override. */
  author?: { name: string; email: string };
}

export interface AutoCommitResult {
  fileCount: number;
  /** True iff a commit was created. False when nothing to commit. */
  committed: boolean;
  /** sha of the commit if known. */
  sha?: string;
}

const DEFAULT_MAX_BYTES = 512 * 1024;

const defaultMessage = (n: number): string =>
  `Auto-save: ${n} file${n === 1 ? "" : "s"}`;

const DEFAULT_AUTHOR = {
  name: "Adorable",
  email: "adorable@localhost",
};

const SAFE_TEXT_EXTS: ReadonlyArray<string> = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "html",
  "json",
  "svg",
  "xml",
  "txt",
  "webmanifest",
  "md",
];

const isTextExt = (path: string): boolean => {
  const idx = path.lastIndexOf(".");
  if (idx < 0) return false;
  return SAFE_TEXT_EXTS.includes(path.slice(idx + 1).toLowerCase());
};

export const autoCommitProjectFs = async (
  opts: AutoCommitProjectFsOptions,
): Promise<AutoCommitResult> => {
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const messageFor = opts.commitMessage ?? defaultMessage;
  const author = opts.author ?? DEFAULT_AUTHOR;

  // Walk recursive — ProjectFs.list() already skips node_modules/.vite/
  // .git/etc per its safe walker. Collect file entries within size cap.
  const entries = await opts.fs.list({ recursive: true, maxDepth: 8 });
  const candidates = entries
    .filter((e) => e.type === "file")
    .filter((e) => isTextExt(e.path))
    .filter((e) => (e.size ?? 0) <= maxBytes);

  const files: Array<{ path: string; content: string }> = [];
  for (const ent of candidates) {
    try {
      const content = await opts.fs.readTextFile(ent.path);
      files.push({ path: ent.path, content });
    } catch (err) {
      // Skip unreadable / binary-detected files.
      process.stderr.write(
        `auto-commit-project-fs: skipped ${ent.path} (${(err as Error).message})\n`,
      );
    }
  }

  if (files.length === 0) {
    return { fileCount: 0, committed: false };
  }

  const repo = opts.gitProvider.getRepo(opts.sourceRepoId);
  const { defaultBranch } = await repo.branches.getDefaultBranch();
  const result = await repo.commits.create({
    branch: defaultBranch,
    message: messageFor(files.length),
    files,
    author,
  });
  return {
    fileCount: files.length,
    committed: true,
    ...(result?.sha ? { sha: result.sha } : {}),
  };
};
