// Best-effort парсер vite/esbuild stderr → структурированные BuildError[].
//
// Входные источники: stdout + stderr контейнера build-runner'а.
// Выход: массив BuildError (см. CONTRACTS §4) и массив BuildWarning.
//
// Источник правды для регэкспов: BUILD_PIPELINE.md §4.4 + DEPENDENCIES.md §5.
//
// Парсер — best-effort: цель не покрыть 100% кейсов, а превратить в
// структурированный вид частые типы ошибок чтобы LLM мог реагировать
// (особенно «import-not-allowed» с suggestion). Для нераспарсенного
// stderr эмитим единственный {code:"unknown", message: head(stderr)}.

import type {
  BuildError,
  BuildErrorCode,
  BuildWarning,
} from "@/lib/adapters/preview";

import { classifyMissingModule } from "./available-deps";

const UNKNOWN_HEAD_BYTES = 2000;

export interface ParseInput {
  stdout: string;
  stderr: string;
  /** Не используется парсером, доступно для будущего обогащения. */
  projectId?: string;
  boilerplateVersion?: string;
}

// ---------------------------------------------------------------------------
// parseBuildErrors
// ---------------------------------------------------------------------------

export const parseBuildErrors = (input: ParseInput): BuildError[] => {
  const text = `${input.stderr ?? ""}\n${input.stdout ?? ""}`;
  if (!text.trim()) return [];

  const errors: BuildError[] = [];
  const seen = new Set<string>();

  const push = (e: BuildError): void => {
    const key = `${e.code}:${e.missingModule ?? ""}:${e.file ?? ""}:${e.line ?? ""}:${e.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push(e);
  };

  // 1. Could not resolve "X" — module-not-found / import-not-allowed.
  // Файл и строка ищутся отдельно через extractFileLocation, потому что
  // esbuild/vite выводят их на следующих строках, а не в самой строке.
  for (const match of text.matchAll(
    /Could not resolve\s+["']([^"']+)["'](?:\s+from\s+["']?([^"'\n]+?)["']?(?=$|\s|\n))?/g,
  )) {
    const moduleName = match[1];
    const fileLoc = extractFileLocation(text, match.index ?? 0);
    const fromFile =
      match[2]?.trim().replace(/^['"]|['"]$/g, "") ?? fileLoc.file;
    const cls = classifyMissingModule(moduleName);
    if (cls.code === "unknown") {
      push({
        code: "unknown",
        message: `Boilerplate dependency "${moduleName}" was not resolvable. This is likely a build pipeline error, not a code issue.`,
        missingModule: moduleName,
        file: fromFile,
        raw: match[0],
      });
      continue;
    }
    if (cls.code === "import-not-allowed") {
      push({
        code: "import-not-allowed",
        message: `Module "${moduleName}" is not available in this project.`,
        missingModule: moduleName,
        suggestion: cls.suggestion,
        file: fromFile,
        raw: match[0],
      });
      continue;
    }
    // module-not-found
    push({
      code: "module-not-found",
      message: `Module "${moduleName}" could not be resolved.`,
      missingModule: moduleName,
      file: fromFile,
      raw: match[0],
    });
  }

  // 2. Syntax errors — esbuild emits `ERROR: Expected ... but got ...`.
  for (const match of text.matchAll(
    /^\s*(?:✘?\s*)?\[?ERROR\]?:\s*(Expected[^]+?)(?:\n|$)/gm,
  )) {
    push({
      code: "syntax-error",
      message: match[1].trim(),
      ...extractFileLocation(text, match.index ?? 0),
      raw: match[0].trim(),
    });
  }
  // 2b. Babel-style "SyntaxError: ..." messages (Vite plugins reformat).
  for (const match of text.matchAll(/SyntaxError:\s*([^\n]+)/g)) {
    push({
      code: "syntax-error",
      message: match[1].trim(),
      ...extractFileLocation(text, match.index ?? 0),
      raw: match[0],
    });
  }

  // 3. Vite plugin / transform errors.
  for (const match of text.matchAll(
    /(?:^|\n)\s*\[plugin[^\]]*\][^\n]*\n[^]+?(?:\n\s*\n|$)/g,
  )) {
    const message = match[0].trim().split("\n")[0].replace(/^\[plugin[^\]]*\]\s*/, "");
    push({
      code: "transform-error",
      message: message || "Vite plugin error",
      ...extractFileLocation(text, match.index ?? 0),
      raw: match[0].trim().slice(0, 500),
    });
  }
  for (const match of text.matchAll(/Transform failed[^\n]*/g)) {
    push({
      code: "transform-error",
      message: match[0],
      ...extractFileLocation(text, match.index ?? 0),
      raw: match[0],
    });
  }

  // 4. Config errors — vite cannot read config.
  for (const match of text.matchAll(
    /(?:failed to load config|Cannot find module ['"]vite['"]|error during build|Could not load[^\n]*vite\.config)[^\n]*/g,
  )) {
    push({
      code: "config-error",
      message: match[0],
      raw: match[0],
    });
  }

  // 5. Если вообще ничего не распарсили, но stderr непустой — эмитим
  // generic {code:"unknown", message: head(stderr)}.
  if (errors.length === 0 && (input.stderr ?? "").trim()) {
    push({
      code: "unknown",
      message: input.stderr.slice(0, UNKNOWN_HEAD_BYTES).trim(),
      raw: input.stderr.slice(0, UNKNOWN_HEAD_BYTES),
    });
  }

  return errors;
};

// ---------------------------------------------------------------------------
// parseBuildWarnings
// ---------------------------------------------------------------------------

export const parseBuildWarnings = (input: ParseInput): BuildWarning[] => {
  const text = `${input.stderr ?? ""}\n${input.stdout ?? ""}`;
  if (!text.trim()) return [];
  const warnings: BuildWarning[] = [];
  const seen = new Set<string>();

  const push = (w: BuildWarning): void => {
    const key = `${w.file ?? ""}:${w.line ?? ""}:${w.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(w);
  };

  for (const match of text.matchAll(/^\s*\[?(?:WARNING|warn)\]?:\s*([^\n]+)/gm)) {
    const message = match[1].trim();
    push({
      message,
      ...extractFileLocation(text, match.index ?? 0),
      raw: match[0].trim(),
    });
  }
  return warnings;
};

// ---------------------------------------------------------------------------
// extractFileLocation
//
// Ищет первое упоминание `path.tsx:line:col` или `path.tsx:line` в окрестности
// сообщения об ошибке (±400 символов). Best-effort.
// ---------------------------------------------------------------------------

const FILE_LOC_RE =
  /([^\s'"`]+\.(?:tsx?|jsx?|css|scss|html|json))(?::(\d+))?(?::(\d+))?/g;

interface FileLocation {
  file?: string;
  line?: number;
  column?: number;
}

const extractFileLocation = (text: string, atIndex: number): FileLocation => {
  const start = Math.max(0, atIndex - 200);
  const end = Math.min(text.length, atIndex + 400);
  const slice = text.slice(start, end);
  let best: FileLocation = {};
  for (const m of slice.matchAll(FILE_LOC_RE)) {
    const candidate: FileLocation = { file: m[1] };
    if (m[2]) candidate.line = Number.parseInt(m[2], 10);
    if (m[3]) candidate.column = Number.parseInt(m[3], 10);
    // Пропускаем абсолютные / node_modules пути:
    if (
      candidate.file &&
      (candidate.file.includes("node_modules") ||
        candidate.file.startsWith("/")) &&
      !candidate.file.startsWith("/workspace/")
    ) {
      continue;
    }
    best = candidate;
    break;
  }
  return best;
};

// Re-export для удобства тестов:
export type { BuildError, BuildErrorCode, BuildWarning };
