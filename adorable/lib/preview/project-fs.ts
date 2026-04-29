// ProjectFs — узкий fs-API над scratch dir статика-проекта (либо
// adapter'ом над sandbox'ом). Этот модуль владеет двумя вещами:
//
//  1. Whitelist для writeFileTool — какие пути LLM может писать.
//     Это pure-функция isWritablePath + сопровождающий объяснитель.
//     Source: docs/preview-provider/CONTRACTS.md §9, ADR-007.
//
//  2. createNodeFsProjectFs(rootDir) — реализация ProjectFs поверх
//     node:fs.promises. Все операции делают safety-resolve относительно
//     rootDir и проверяют что итоговый путь не выходит за пределы
//     корня (path traversal protection). Запись дополнительно требует
//     isWritablePath(relPath) === true.
//
// Whitelist намеренно строгий и pure: тесты проверяют каждое правило.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  ProjectFsError,
  type FileEntry,
  type ProjectFs,
  type SearchResult,
} from "@/lib/adapters/preview";

// ---------------------------------------------------------------------------
// §9. isWritablePath / explainNonWritable
// ---------------------------------------------------------------------------

/**
 * Pure-проверка: может ли LLM писать в этот относительный путь.
 *
 * Правила (см. CONTRACTS.md §9, ADR-007, ADR-024):
 *   - Только src/**, public/**, functions/** разрешены как корни.
 *   - Path traversal ".." и NUL-байты — запрещены.
 *   - Абсолютные пути запрещены.
 *   - В src/** — JS/TS/CSS/HTML/JSON/SCSS.
 *   - В public/** — текстовые ресурсы (svg/json/xml/txt/html/webmanifest).
 *     Бинарные ассеты (jpg/png/woff/...) загружаются юзером через UI.
 *   - В functions/** — TypeScript edge-handler'ы (.ts) и .json. Файл
 *     functions/tsconfig.json фиксирован — его LLM не пишет.
 */
export const isWritablePath = (relPath: string): boolean => {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  if (relPath.startsWith("/")) return false;
  if (relPath.includes("\0")) return false;
  // ".." как сегмент пути (даже если внутри длинного имени типа "..foo" — нет,
  // это валидное имя файла; запрещаем только когда ".." стоит как сегмент):
  for (const segment of relPath.split("/")) {
    if (segment === ".." || segment === ".") return false;
  }
  if (!/^(src|public|functions)\//.test(relPath)) return false;

  // src/** — JS/TS-расширения + стили / шаблоны / json:
  if (/^src\/.+\.(js|jsx|ts|tsx|css|scss|html|json)$/.test(relPath)) {
    return true;
  }
  // public/** — только текстовые ресурсы:
  if (/^public\/.+\.(svg|json|xml|txt|html|webmanifest)$/.test(relPath)) {
    return true;
  }
  // functions/** — .ts edge-handlers, .json конфиги; tsconfig.json
  // фиксирован.
  if (
    /^functions\/.+\.(ts|json)$/.test(relPath) &&
    relPath !== "functions/tsconfig.json"
  ) {
    return true;
  }
  return false;
};

/**
 * Хелпер для генерации сообщения ошибки с подсказкой пользователя.
 * Используется ProjectFs.writeTextFile при отклонении (CONTRACTS §9).
 */
export const explainNonWritable = (relPath: string): string => {
  if (typeof relPath !== "string" || relPath.length === 0) {
    return `Path is empty.`;
  }
  if (relPath.startsWith("/")) {
    return `Path "${relPath}" is absolute. Use a path relative to the project root.`;
  }
  if (relPath.includes("\0")) {
    return `Path "${relPath}" contains a NUL byte.`;
  }
  for (const segment of relPath.split("/")) {
    if (segment === "..") {
      return `Path "${relPath}" contains ".." (directory traversal is not allowed).`;
    }
  }
  if (!/^(src|public|functions)\//.test(relPath)) {
    return `Path "${relPath}" is outside writable directories. Only src/**, public/**, and functions/** are writable.`;
  }
  if (
    /\.(jpg|jpeg|png|webp|gif|mp4|webm|woff|woff2|ttf|otf|eot)$/.test(relPath)
  ) {
    return `Path "${relPath}" is a binary asset. Binary files must be uploaded by the user via the UI.`;
  }
  if (relPath === "functions/tsconfig.json") {
    return `Path "${relPath}" is a fixed boilerplate file and cannot be edited.`;
  }
  return `Path "${relPath}" is not writable in this project.`;
};

// ---------------------------------------------------------------------------
// Node fs ProjectFs implementation
// ---------------------------------------------------------------------------

const MAX_SEARCH_FILE_BYTES = 1024 * 1024; // 1 MiB — крупнее не сканируем
const SEARCH_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".vite",
  "dist",
  "build",
  ".next",
]);

const normalizeRel = (input: string): string => {
  if (typeof input !== "string") {
    throw new ProjectFsError(
      "invalid-path",
      `Path is not a string: ${String(input)}`,
    );
  }
  if (input.includes("\0")) {
    throw new ProjectFsError(
      "invalid-path",
      `Path contains NUL byte: "${input}"`,
      input,
    );
  }
  if (path.isAbsolute(input)) {
    throw new ProjectFsError(
      "invalid-path",
      `Absolute path not allowed: "${input}"`,
      input,
    );
  }
  // path.normalize collapses "./", "//" and resolves "..".
  // We forbid any segment from being "..", even after normalisation.
  const normalised = path.posix.normalize(input.replace(/\\/g, "/"));
  if (normalised === ".." || normalised.startsWith("../")) {
    throw new ProjectFsError(
      "invalid-path",
      `Path escapes the project root: "${input}"`,
      input,
    );
  }
  // Strip leading "./":
  return normalised.replace(/^\.\//, "").replace(/^\.$/, "");
};

const safeJoin = (rootDir: string, relInput: string): string => {
  const rel = normalizeRel(relInput);
  const absolute = path.resolve(rootDir, rel);
  const rootResolved = path.resolve(rootDir);
  if (
    absolute !== rootResolved &&
    !absolute.startsWith(rootResolved + path.sep)
  ) {
    throw new ProjectFsError(
      "invalid-path",
      `Path resolves outside project root: "${relInput}"`,
      relInput,
    );
  }
  return absolute;
};

const wrapNodeError = (err: unknown, action: string, p: string): never => {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "ENOENT") {
    throw new ProjectFsError("not-found", `${action}: not found (${p})`, p);
  }
  throw new ProjectFsError(
    "io",
    `${action} failed for "${p}": ${(err as Error).message}`,
    p,
  );
};

export interface NodeFsProjectFsOptions {
  rootDir: string;
  /**
   * Если true — writeTextFile/remove/rename/mkdir не применяют isWritablePath
   * whitelist. Используется для системных операций (initial seed, migration,
   * upload через API). LLM-флоу всегда должен видеть enforced=true.
   * Default: false (= whitelist enforced).
   */
  bypassWriteWhitelist?: boolean;
}

export const createNodeFsProjectFs = (
  options: NodeFsProjectFsOptions,
): ProjectFs => {
  const rootDir = path.resolve(options.rootDir);
  const enforce = options.bypassWriteWhitelist !== true;

  const enforceWritable = (relInput: string): string => {
    const rel = normalizeRel(relInput);
    if (enforce && !isWritablePath(rel)) {
      throw new ProjectFsError(
        "path-not-writable",
        explainNonWritable(rel),
        rel,
      );
    }
    return rel;
  };

  const fsImpl: ProjectFs = {
    async readTextFile(p: string): Promise<string> {
      const abs = safeJoin(rootDir, p);
      try {
        return await fs.readFile(abs, "utf8");
      } catch (err) {
        throw wrapNodeError(err, "readTextFile", p);
      }
    },

    async writeTextFile(p: string, content: string): Promise<void> {
      const rel = enforceWritable(p);
      const abs = safeJoin(rootDir, rel);
      try {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, "utf8");
      } catch (err) {
        wrapNodeError(err, "writeTextFile", p);
      }
    },

    async exists(p: string): Promise<boolean> {
      try {
        const abs = safeJoin(rootDir, p);
        await fs.access(abs);
        return true;
      } catch {
        return false;
      }
    },

    async list(opts): Promise<FileEntry[]> {
      const startRel = opts.path ? normalizeRel(opts.path) : "";
      const recursive = opts.recursive ?? false;
      const maxDepth = Math.min(Math.max(opts.maxDepth ?? 3, 1), 8);
      const out: FileEntry[] = [];

      const walk = async (relDir: string, depth: number): Promise<void> => {
        if (depth > maxDepth) return;
        let entries: import("node:fs").Dirent[];
        try {
          entries = await fs.readdir(safeJoin(rootDir, relDir), {
            withFileTypes: true,
          });
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code === "ENOENT" || e.code === "ENOTDIR") return;
          throw new ProjectFsError(
            "io",
            `list failed at "${relDir}": ${e.message}`,
            relDir,
          );
        }
        for (const ent of entries) {
          const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;
          if (ent.isDirectory()) {
            out.push({ path: childRel, type: "directory" });
            if (recursive) await walk(childRel, depth + 1);
          } else if (ent.isFile()) {
            const stat = await fs
              .stat(safeJoin(rootDir, childRel))
              .catch(() => null);
            out.push({
              path: childRel,
              type: "file",
              size: stat?.size ?? 0,
            });
          }
          // symlinks/sockets/etc — пропускаем
        }
      };

      await walk(startRel, 1);
      out.sort((a, b) => a.path.localeCompare(b.path));
      return out;
    },

    async search(opts): Promise<SearchResult[]> {
      const startRel = opts.path ? normalizeRel(opts.path) : "";
      const maxResults = Math.min(Math.max(opts.maxResults ?? 100, 1), 500);
      const results: SearchResult[] = [];

      const walk = async (relDir: string): Promise<void> => {
        if (results.length >= maxResults) return;
        let entries: import("node:fs").Dirent[];
        try {
          entries = await fs.readdir(safeJoin(rootDir, relDir), {
            withFileTypes: true,
          });
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code === "ENOENT" || e.code === "ENOTDIR") return;
          throw new ProjectFsError(
            "io",
            `search failed at "${relDir}": ${e.message}`,
            relDir,
          );
        }
        for (const ent of entries) {
          if (results.length >= maxResults) return;
          if (SEARCH_SKIP_DIRS.has(ent.name)) continue;
          const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;
          if (ent.isDirectory()) {
            await walk(childRel);
          } else if (ent.isFile()) {
            const abs = safeJoin(rootDir, childRel);
            let stat;
            try {
              stat = await fs.stat(abs);
            } catch {
              continue;
            }
            if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
            let content: string;
            try {
              content = await fs.readFile(abs, "utf8");
            } catch {
              continue; // binary or unreadable
            }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(opts.query)) {
                results.push({ file: childRel, line: i + 1, text: lines[i] });
                if (results.length >= maxResults) return;
              }
            }
          }
        }
      };

      await walk(startRel);
      return results;
    },

    async remove(p: string): Promise<void> {
      const rel = enforceWritable(p);
      const abs = safeJoin(rootDir, rel);
      try {
        await fs.rm(abs, { recursive: true, force: true });
      } catch (err) {
        wrapNodeError(err, "remove", p);
      }
    },

    async rename(from: string, to: string): Promise<void> {
      const fromRel = enforceWritable(from);
      const toRel = enforceWritable(to);
      const fromAbs = safeJoin(rootDir, fromRel);
      const toAbs = safeJoin(rootDir, toRel);
      try {
        await fs.mkdir(path.dirname(toAbs), { recursive: true });
        await fs.rename(fromAbs, toAbs);
      } catch (err) {
        wrapNodeError(err, "rename", from);
      }
    },

    async mkdir(p: string): Promise<void> {
      // mkdir не использует isWritablePath напрямую — каталоги без
      // расширения не подпадают под whitelist (.tsx и т.п.). Вместо
      // этого требуем чтобы сегменты пути были одним из root'ов
      // src/public/functions (либо пустым).
      const rel = normalizeRel(p);
      if (enforce && rel) {
        const root = rel.split("/")[0];
        if (root !== "src" && root !== "public" && root !== "functions") {
          throw new ProjectFsError(
            "path-not-writable",
            `Cannot create directory outside src/, public/, functions/: "${p}"`,
            p,
          );
        }
      }
      const abs = safeJoin(rootDir, rel);
      try {
        await fs.mkdir(abs, { recursive: true });
      } catch (err) {
        wrapNodeError(err, "mkdir", p);
      }
    },
  };

  return fsImpl;
};
