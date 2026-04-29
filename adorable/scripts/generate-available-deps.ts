#!/usr/bin/env node
// Регенерация templates/vite-react/AVAILABLE_DEPS.md.
//
// Source: docs/preview-provider/BOILERPLATE.md §4, DEPENDENCIES.md §8.
//
// Запуск (из adorable/):
//   npx tsx scripts/generate-available-deps.ts
//
// Или с явным путём:
//   npx tsx scripts/generate-available-deps.ts \
//     --template templates/vite-react \
//     --out templates/vite-react/AVAILABLE_DEPS.md
//
// Логика:
//   1. Читает <template>/package.json — собирает {deps, devDeps}.
//   2. Читает <template>/VERSION — для заголовка.
//   3. Импортирует SYNONYMS из lib/preview/available-deps.ts.
//   4. Генерирует markdown через generateAvailableDepsMarkdown().
//   5. Пишет в <out>.
//   6. Завершается с exit-code 0/1.

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { SYNONYMS } from "../lib/preview/available-deps";
import {
  generateAvailableDepsMarkdown,
  type PackageJsonShape,
} from "../lib/preview/available-deps-markdown";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ADORABLE_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_TEMPLATE = path.join(ADORABLE_ROOT, "templates", "vite-react");

interface CliArgs {
  templateDir: string;
  outPath: string;
  dryRun: boolean;
}

const parseArgs = (argv: string[]): CliArgs => {
  let templateDir = DEFAULT_TEMPLATE;
  let outPath = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--template" || a === "-t") && argv[i + 1]) {
      templateDir = path.resolve(argv[i + 1]);
      i++;
    } else if ((a === "--out" || a === "-o") && argv[i + 1]) {
      outPath = path.resolve(argv[i + 1]);
      i++;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      printHelpAndExit(2);
    }
  }
  if (!outPath) outPath = path.join(templateDir, "AVAILABLE_DEPS.md");
  return { templateDir, outPath, dryRun };
};

const printHelpAndExit = (code: number): never => {
  console.log(`generate-available-deps — regenerate AVAILABLE_DEPS.md

usage: npx tsx scripts/generate-available-deps.ts [--template DIR] [--out FILE] [--dry-run]

  --template, -t   Path to template directory (default: ${DEFAULT_TEMPLATE})
  --out, -o        Path to output markdown file (default: <template>/AVAILABLE_DEPS.md)
  --dry-run        Print markdown to stdout, don't write file
`);
  process.exit(code);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const pkgPath = path.join(args.templateDir, "package.json");
  const verPath = path.join(args.templateDir, "VERSION");

  const pkgRaw = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(pkgRaw) as PackageJsonShape;

  let version: string;
  try {
    version = (await readFile(verPath, "utf8")).trim();
  } catch {
    version = "0.0.0";
    console.warn(
      `generate-available-deps: VERSION file missing in ${args.templateDir}; using "${version}".`,
    );
  }

  const md = generateAvailableDepsMarkdown({
    packageJson: pkg,
    boilerplateVersion: version,
    synonyms: SYNONYMS,
  });

  if (args.dryRun) {
    process.stdout.write(md);
    return;
  }
  await writeFile(args.outPath, md, "utf8");
  console.log(
    `generate-available-deps: wrote ${args.outPath} (boilerplate v${version}).`,
  );
};

void main().catch((err: Error) => {
  console.error(`generate-available-deps: ${err.message}`);
  process.exit(1);
});
