// Read the templates/vite-react/VERSION file at runtime.
//
// Single owner of "where does the boilerplate version come from".
// Source: docs/preview-provider/BOILERPLATE.md §3.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Default templates/vite-react/VERSION resolved relative to this file. */
const DEFAULT_VERSION_PATH = path.resolve(
  MODULE_DIR,
  "..",
  "..",
  "templates",
  "vite-react",
  "VERSION",
);

/**
 * Override env: ADORABLE_TEMPLATE_DIR (matches lib/template-seeder.ts so a
 * single env can redirect both the template seeder and the version reader
 * during tests).
 */
const resolveVersionPath = (): string => {
  const dir = process.env["ADORABLE_TEMPLATE_DIR"];
  if (dir && dir.trim()) {
    return path.resolve(dir.trim(), "VERSION");
  }
  return DEFAULT_VERSION_PATH;
};

let cached: { path: string; value: string } | null = null;

/**
 * Read + cache the boilerplate version. Cache is keyed by resolved path
 * so test overrides via ADORABLE_TEMPLATE_DIR work between describe blocks
 * if `__resetBoilerplateVersionCache()` is called.
 *
 * Returns "0.0.0" if the file is missing — caller decides if that's fatal
 * (production should never see this; dev / fresh-clone might).
 */
export const readBoilerplateVersion = async (): Promise<string> => {
  const file = resolveVersionPath();
  if (cached && cached.path === file) return cached.value;
  let value: string;
  try {
    value = (await fs.readFile(file, "utf8")).trim();
  } catch {
    value = "0.0.0";
  }
  cached = { path: file, value };
  return value;
};

/** Test helper. */
export const __resetBoilerplateVersionCache = (): void => {
  cached = null;
};
