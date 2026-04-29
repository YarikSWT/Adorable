// IC-8 sync gate (VERIFICATION.md §2):
//   templates/vite-react/AVAILABLE_DEPS.md must match what
//   generateAvailableDepsMarkdown() produces from the current
//   package.json + VERSION + SYNONYMS table. If drifted, regenerate
//   via `npx tsx scripts/generate-available-deps.ts`.
//
// This catches "added a dep but forgot to refresh AVAILABLE_DEPS" and
// "synonyms changed but doc didn't" before they reach LLM context.

import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { SYNONYMS } from "@/lib/preview/available-deps";
import {
  generateAvailableDepsMarkdown,
  type PackageJsonShape,
} from "@/lib/preview/available-deps-markdown";

const TEMPLATE_DIR = path.resolve(
  __dirname,
  "..",
  "templates",
  "vite-react",
);

describe("IC-8 — AVAILABLE_DEPS.md is in sync with package.json + SYNONYMS", () => {
  it("matches generator output exactly", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(TEMPLATE_DIR, "package.json"), "utf8"),
    ) as PackageJsonShape;
    const version = (
      await readFile(path.join(TEMPLATE_DIR, "VERSION"), "utf8")
    ).trim();

    const expected = generateAvailableDepsMarkdown({
      packageJson: pkg,
      boilerplateVersion: version,
      synonyms: SYNONYMS,
    });
    const actual = await readFile(
      path.join(TEMPLATE_DIR, "AVAILABLE_DEPS.md"),
      "utf8",
    );

    expect(actual).toBe(expected);
  });
});
