// Раньше дефолтный template создавался через Gitea migrate endpoint
// (`gitProvider.createRepo({ import: { url: TEMPLATE_REPO } })`), который
// тянул external GitHub-репо freestyle-sh/...-nextjs-shadcn.
//
// Проблемы Next.js как бойлерплейта:
//   1. SWC native binary требует exec-permissions на /workspace (docker
//      по умолчанию может ставить noexec на tmpfs — ломается loadNext).
//   2. node_modules ≈ 1-1.5 GiB, .next cache + turbopack ещё 1 GiB.
//   3. Dev-сервер тяжёлый (часто OOM на 2 GiB sandbox).
//
// Vite+React:
//   1. esbuild вместо SWC — 1 self-contained бинарник, работает и без exec
//      на workspace (esbuild запускается из /workspace/node_modules/.bin).
//   2. node_modules ≈ 250 MiB для базового шаблона.
//   3. Dev-сервер стартует за ~1 секунду.
//
// Этот модуль читает template-директорию, бандлированную рядом с кодом
// Adorable, и заливает её содержимое в новосозданный Gitea-репо через
// `commits.create`. Работает и с mock-git-провайдером (для тестов).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  GitCommitFile,
  GitProvider,
  GitRepoRef,
} from "@/lib/adapters/git";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Абсолютный путь к папке с дефолтным template'ом. Прилегает к lib/
 * (resolved at runtime, так что работает и через `next dev`, и в тестах
 * из vitest). Можно переопределить через env `ADORABLE_TEMPLATE_DIR` —
 * полезно для тестов и для точечной подмены в проде без пересборки.
 */
export const resolveTemplateDir = (): string => {
  const override = process.env["ADORABLE_TEMPLATE_DIR"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.resolve(MODULE_DIR, "..", "templates", "vite-react");
};

/** Файлы/директории, которые не заливаем в новый репо. */
const IGNORED_ENTRIES = new Set<string>([
  "node_modules",
  "dist",
  ".git",
  ".DS_Store",
]);

const walkTemplate = async (
  root: string,
  relDir = "",
): Promise<Array<{ relPath: string; content: string }>> => {
  const results: Array<{ relPath: string; content: string }> = [];
  const abs = path.join(root, relDir);

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `template-seeder: cannot read directory ${abs}: ${
        (err as Error).message
      }`,
    );
  }

  for (const entry of entries) {
    if (IGNORED_ENTRIES.has(entry.name)) continue;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...(await walkTemplate(root, relPath)));
    } else {
      const absPath = path.join(root, relPath);
      const content = await fs.readFile(absPath, "utf8");
      results.push({ relPath, content });
    }
  }

  return results;
};

export interface SeedTemplateOptions {
  /** Provider instance — main caller уже его dern'л. */
  provider: GitProvider;
  repo: GitRepoRef;
  /** Override path to the template dir (for tests). */
  templateDir?: string;
  /** Commit message for the initial seeding. */
  commitMessage?: string;
  /** Commit author metadata. */
  author?: { name: string; email: string };
}

/**
 * Заливает все файлы template-директории одним коммитом в default-branch
 * указанного репо. Используется вместо `gitProvider.createRepo({ import })`
 * для того, чтобы не зависеть от external URL-импорта.
 */
/**
 * Заливает template-файлы в уже созданный sandbox через Docker archive API
 * (используем штатный `handle.fs.writeTextFile`, который это умеет).
 *
 * Зачем это нужно: `provider.create()` в docker-адаптере НЕ выполняет
 * `git clone` из `opts.git.repos` (option описан в контракте, но реализация
 * empty). Поэтому workspace стартует пустым. До того, как мы интегрируем
 * настоящий `git clone` в sandbox (нужен git в образе + Gitea reachable —
 * отдельная задача), наполняем workspace тем же template'ом, что
 * заливается в репо через `seedTemplateRepo`. Агент видит файлы сразу,
 * `npm install` / `npm run dev` работают.
 */
export const seedSandboxFromTemplate = async (opts: {
  fs: {
    writeTextFile: (path: string, content: string) => Promise<void>;
  };
  templateDir?: string;
}): Promise<{ fileCount: number }> => {
  const templateDir = opts.templateDir ?? resolveTemplateDir();
  const files = await walkTemplate(templateDir);
  if (files.length === 0) {
    throw new Error(
      `template-seeder: no files found in ${templateDir} — bundled template missing?`,
    );
  }
  for (const file of files) {
    await opts.fs.writeTextFile(file.relPath, file.content);
  }
  return { fileCount: files.length };
};

/**
 * Заливает в sandbox последнее закоммиченное состояние source-репо в
 * Gitea. Используется при пересоздании sandbox'а: если в source-репо
 * есть коммиты сверх initial template'а (агент дёрнул commitTool),
 * восстанавливаем эти правки. Если коммитов нет — наполняется чистым
 * template'ом, который был залит при создании репо.
 *
 * Fallback на bundled template при ошибке (Gitea недоступен,
 * провайдер не реализует listAllFiles) — sandbox получит хотя бы
 * боилерплейт, а не пустой workspace.
 */
export const seedSandboxFromSourceRepo = async (opts: {
  fs: {
    writeTextFile: (path: string, content: string) => Promise<void>;
  };
  provider: GitProvider;
  sourceRepoId: string;
}): Promise<{ fileCount: number; from: "source" | "template" }> => {
  if (opts.provider.listAllFiles) {
    try {
      const files = await opts.provider.listAllFiles(opts.sourceRepoId);
      if (files.length > 0) {
        for (const file of files) {
          await opts.fs.writeTextFile(file.path, file.content);
        }
        return { fileCount: files.length, from: "source" };
      }
    } catch (err) {
      process.stderr.write(
        `template-seeder: source-repo seed failed for ${opts.sourceRepoId} (${(err as Error).message}); falling back to bundled template\n`,
      );
    }
  }
  const result = await seedSandboxFromTemplate({ fs: opts.fs });
  return { fileCount: result.fileCount, from: "template" };
};

export const seedTemplateRepo = async (
  opts: SeedTemplateOptions,
): Promise<{ sha: string; fileCount: number }> => {
  const templateDir = opts.templateDir ?? resolveTemplateDir();
  const files = await walkTemplate(templateDir);
  if (files.length === 0) {
    throw new Error(
      `template-seeder: no files found in ${templateDir} — bundled template missing?`,
    );
  }

  const commitFiles: GitCommitFile[] = files.map((f) => ({
    path: f.relPath,
    content: f.content,
  }));

  const { defaultBranch } = await opts.repo.branches.getDefaultBranch();
  const { sha } = await opts.repo.commits.create({
    branch: defaultBranch,
    message: opts.commitMessage ?? "Initial commit (Vite + React template)",
    files: commitFiles,
    author: opts.author ?? {
      name: "Adorable",
      email: "adorable@localhost",
    },
  });

  return { sha, fileCount: commitFiles.length };
};
