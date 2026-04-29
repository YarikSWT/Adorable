// AVAILABLE_DEPS — таблица пакетов, доступных в boilerplate'е, плюс
// synonyms-таблица для парсера ошибок (DEPENDENCIES.md §5, ADR-018).
//
// Источник правды для:
//   - `lib/preview/build-error-parser.ts` — классификация
//     `Could not resolve "X"` как `import-not-allowed` (с suggestion)
//     vs `module-not-found` (без подсказки).
//   - Будущей генерации `templates/vite-react/AVAILABLE_DEPS.md`
//     для system-prompt'а в static-режиме (Phase 2 generator script).
//
// Ничего не импортирует из node:fs — pure data + функции, тестируется
// в memory.

import type { BuildErrorCode } from "@/lib/adapters/preview";

// ---------------------------------------------------------------------------
// Текущие boilerplate dependencies (из templates/vite-react/package.json).
// Будет расширяться в отдельной итерации Phase 2 + 4 (ADR-019). Сейчас —
// то что реально лежит в `package.json` шаблона.
// ---------------------------------------------------------------------------

export const BOILERPLATE_RUNTIME_DEPS: ReadonlySet<string> = new Set([
  "class-variance-authority",
  "clsx",
  "lucide-react",
  "react",
  "react-dom",
  "react-router-dom",
  "tailwind-merge",
]);

export const BOILERPLATE_DEV_DEPS: ReadonlySet<string> = new Set([
  "@vitejs/plugin-react",
  "autoprefixer",
  "postcss",
  "tailwindcss",
  "tailwindcss-animate",
  "vite",
]);

/** Все packages, доступные коду — runtime + (для типов) dev. */
export const ALL_BOILERPLATE_DEPS: ReadonlySet<string> = new Set([
  ...BOILERPLATE_RUNTIME_DEPS,
  ...BOILERPLATE_DEV_DEPS,
]);

// ---------------------------------------------------------------------------
// Synonyms — explicit guidance для частых запрещённых импортов.
// Source: DEPENDENCIES.md §5.
// ---------------------------------------------------------------------------

export interface SynonymEntry {
  /** Что есть на замену (если есть). */
  available?: string;
  /** Почему запрашиваемого пакета нет. */
  reason: string;
  /** Готовый текст-подсказка для LLM. */
  suggestion: string;
}

export const SYNONYMS: Record<string, SynonymEntry> = {
  axios: {
    available: "fetch",
    reason: "Built-in fetch is preferred for static SPAs.",
    suggestion: "Use the built-in `fetch` API instead of axios.",
  },
  express: {
    reason: "No server runtime in static SPAs.",
    suggestion:
      "This project is a static SPA — no Express server. Connect to the managed BaaS for backend functionality.",
  },
  fastify: {
    reason: "No server runtime in static SPAs.",
    suggestion:
      "This project is a static SPA — no Fastify. Connect to the managed BaaS for backend functionality.",
  },
  next: {
    reason: "Adorable uses Vite, not Next.js.",
    suggestion:
      "Use Vite + react-router-dom for routing instead of Next.js.",
  },
  "react-query": {
    available: "@tanstack/react-query",
    reason: "react-query was renamed to @tanstack/react-query in v4.",
    suggestion: "Import from `@tanstack/react-query` (v5).",
  },
  "@tanstack/query-core": {
    available: "@tanstack/react-query",
    reason: "Use the React-specific package, not the core.",
    suggestion: "Import from `@tanstack/react-query`.",
  },
  "lodash-es": {
    available: "lodash",
    reason: "We have CJS lodash; ESM variant is not installed.",
    suggestion:
      "Import from `lodash` (e.g. `import { debounce } from 'lodash'`).",
  },
  dayjs: {
    available: "date-fns",
    reason: "We standardised on date-fns.",
    suggestion: "Use `date-fns` instead of dayjs.",
  },
  luxon: {
    available: "date-fns",
    reason: "We standardised on date-fns.",
    suggestion: "Use `date-fns` instead of luxon.",
  },
  mongodb: {
    reason: "No database drivers in static SPAs.",
    suggestion:
      "This project is a static SPA — no DB. Use the managed BaaS for persistent data.",
  },
  pg: {
    reason: "No database drivers in static SPAs.",
    suggestion:
      "This project is a static SPA — no DB. Use the managed BaaS for persistent data.",
  },
  mysql: {
    reason: "No database drivers in static SPAs.",
    suggestion:
      "This project is a static SPA — no DB. Use the managed BaaS for persistent data.",
  },
  mysql2: {
    reason: "No database drivers in static SPAs.",
    suggestion:
      "This project is a static SPA — no DB. Use the managed BaaS for persistent data.",
  },
  jquery: {
    reason: "Use React refs and state — manual DOM manipulation breaks reconciliation.",
    suggestion:
      "Replace jQuery with React refs (`useRef`) and state (`useState`).",
  },
  "styled-components": {
    available: "tailwindcss",
    reason: "We standardised on Tailwind classes for styling.",
    suggestion:
      "Use Tailwind utility classes instead of styled-components.",
  },
  "@emotion/react": {
    available: "tailwindcss",
    reason: "We standardised on Tailwind classes for styling.",
    suggestion: "Use Tailwind utility classes instead of @emotion/react.",
  },
  "@emotion/styled": {
    available: "tailwindcss",
    reason: "We standardised on Tailwind classes for styling.",
    suggestion: "Use Tailwind utility classes instead of @emotion/styled.",
  },
  "@mui/material": {
    available: "tailwindcss + lucide-react",
    reason: "We standardised on Tailwind + lucide-react.",
    suggestion:
      "Build UI with Tailwind classes + lucide-react icons instead of MUI.",
  },
  "@chakra-ui/react": {
    available: "tailwindcss + lucide-react",
    reason: "We standardised on Tailwind + lucide-react.",
    suggestion:
      "Build UI with Tailwind classes + lucide-react icons instead of Chakra.",
  },
};

// ---------------------------------------------------------------------------
// classifyMissingModule
// ---------------------------------------------------------------------------

export interface MissingModuleClassification {
  code: Exclude<BuildErrorCode, "syntax-error" | "transform-error" | "config-error">;
  suggestion?: string;
  /**
   * Если true — модуль был объявлен в boilerplate'е, но всё равно не
   * нашёлся в build-runner'е. Это сигнал не запрещённого импорта,
   * а системной ошибки (битый volume / расхождение версий).
   */
  systemFailure?: boolean;
}

export interface ClassifyOptions {
  /** Override allow-set (для тестов / альтернативных boilerplate'ов). */
  allowSet?: ReadonlySet<string>;
  /** Override synonyms map. */
  synonyms?: Record<string, SynonymEntry>;
}

/**
 * Классифицировать имя missing-module из vite/esbuild error.
 *
 * Логика (DEPENDENCIES.md §5):
 *   - модуль в allow-set → systemFailure=true (volume/build broken),
 *     code = "unknown" (caller обернёт raw stderr).
 *   - модуль в synonyms → "import-not-allowed" + suggestion.
 *   - иначе → "module-not-found".
 */
export const classifyMissingModule = (
  rawName: string,
  opts: ClassifyOptions = {},
): MissingModuleClassification => {
  const allow = opts.allowSet ?? ALL_BOILERPLATE_DEPS;
  const synonyms = opts.synonyms ?? SYNONYMS;

  const name = normalizeModuleName(rawName);
  if (!name) return { code: "module-not-found" };

  if (allow.has(name)) {
    return { code: "unknown", systemFailure: true };
  }
  // Subpath imports (например "lodash/debounce") — берём корень:
  const root = scopedRoot(name);
  if (root !== name && allow.has(root)) {
    return { code: "unknown", systemFailure: true };
  }
  const synonym = synonyms[name] ?? synonyms[root];
  if (synonym) {
    return { code: "import-not-allowed", suggestion: synonym.suggestion };
  }
  return { code: "module-not-found" };
};

/** "react"        → "react"
 *  "react/jsx-runtime" → "react"
 *  "@scope/pkg"   → "@scope/pkg"
 *  "@scope/pkg/x" → "@scope/pkg"
 */
const scopedRoot = (name: string): string => {
  if (name.startsWith("@")) {
    const parts = name.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : name;
  }
  const slash = name.indexOf("/");
  return slash === -1 ? name : name.slice(0, slash);
};

const normalizeModuleName = (raw: string): string => {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^["']|["']$/g, "");
};
