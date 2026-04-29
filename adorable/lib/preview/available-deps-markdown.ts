// Pure helper: from package.json + SYNONYMS to markdown.
//
// Используется в scripts/generate-available-deps.ts (Node CLI) и в
// тестах. Не делает fs-операций — рожает строку, которую вызывающий
// код пишет в templates/vite-react/AVAILABLE_DEPS.md.

import type { SynonymEntry } from "./available-deps";

export interface PackageJsonShape {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface GenerateAvailableDepsOptions {
  /** Распарсенный package.json. */
  packageJson: PackageJsonShape;
  /** Версия из templates/vite-react/VERSION (без trailing newline). */
  boilerplateVersion: string;
  /** Synonyms для секции "NOT AVAILABLE". */
  synonyms: Record<string, SynonymEntry>;
}

/** Sort + render a category into a list of "- name" lines. */
const renderDeps = (deps: Record<string, string>): string[] => {
  const sorted = Object.keys(deps).sort();
  return sorted.map((name) => `- ${name}`);
};

const renderSynonyms = (
  synonyms: Record<string, SynonymEntry>,
): string[] => {
  const sorted = Object.keys(synonyms).sort();
  return sorted.map((name) => {
    const entry = synonyms[name];
    return `- \`${name}\` → ${entry.suggestion}`;
  });
};

export const generateAvailableDepsMarkdown = (
  opts: GenerateAvailableDepsOptions,
): string => {
  const deps = opts.packageJson.dependencies ?? {};
  const devDeps = opts.packageJson.devDependencies ?? {};
  const ver = opts.boilerplateVersion.trim();

  const lines: string[] = [
    `# AVAILABLE DEPENDENCIES — boilerplate v${ver}`,
    "",
    "This is the COMPLETE list of npm packages available in this project.",
    'Do NOT import packages that are not listed here — the build will fail.',
    "",
    "## Runtime dependencies",
    "",
    ...(Object.keys(deps).length > 0
      ? renderDeps(deps)
      : ["_(none — see DEPENDENCIES.md)_"]),
    "",
    "## Build / dev dependencies (typecheck only — not bundled)",
    "",
    ...(Object.keys(devDeps).length > 0
      ? renderDeps(devDeps)
      : ["_(none)_"]),
    "",
    "## NOT AVAILABLE — common requests with suggested replacements",
    "",
    ...(Object.keys(opts.synonyms).length > 0
      ? renderSynonyms(opts.synonyms)
      : ["_(no synonyms registered)_"]),
    "",
    "## How this file is generated",
    "",
    "Generated automatically from `templates/vite-react/package.json`",
    "and `adorable/lib/preview/available-deps.ts` SYNONYMS table by",
    "`adorable/scripts/generate-available-deps.ts`. Re-run after every",
    "boilerplate version bump (BOILERPLATE.md §3).",
    "",
  ];
  return lines.join("\n");
};
