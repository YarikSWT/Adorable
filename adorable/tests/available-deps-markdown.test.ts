// Тесты для generateAvailableDepsMarkdown — pure-функция.

import { describe, expect, it } from "vitest";

import {
  generateAvailableDepsMarkdown,
  type PackageJsonShape,
} from "@/lib/preview/available-deps-markdown";
import { SYNONYMS } from "@/lib/preview/available-deps";

const samplePkg: PackageJsonShape = {
  name: "adorable-app",
  version: "0.0.0",
  dependencies: {
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.475.0",
  },
  devDependencies: {
    vite: "^5.4.8",
    "@vitejs/plugin-react": "^4.3.2",
  },
};

describe("generateAvailableDepsMarkdown", () => {
  it("includes the boilerplate version in the heading", () => {
    const md = generateAvailableDepsMarkdown({
      packageJson: samplePkg,
      boilerplateVersion: "1.2.3",
      synonyms: {},
    });
    expect(md).toMatch(/# AVAILABLE DEPENDENCIES — boilerplate v1\.2\.3/);
  });

  it("trims the version string", () => {
    const md = generateAvailableDepsMarkdown({
      packageJson: samplePkg,
      boilerplateVersion: "  2.0.0\n",
      synonyms: {},
    });
    expect(md).toContain("v2.0.0");
    expect(md).not.toContain("v  2.0.0");
  });

  it("lists runtime dependencies sorted alphabetically", () => {
    const md = generateAvailableDepsMarkdown({
      packageJson: samplePkg,
      boilerplateVersion: "1.0.0",
      synonyms: {},
    });
    const runtimeStart = md.indexOf("## Runtime dependencies");
    const buildStart = md.indexOf("## Build / dev dependencies");
    const runtimeSection = md.slice(runtimeStart, buildStart);
    const lines = runtimeSection
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
    expect(lines).toEqual(["lucide-react", "react", "react-dom"]);
  });

  it("lists dev dependencies sorted alphabetically", () => {
    const md = generateAvailableDepsMarkdown({
      packageJson: samplePkg,
      boilerplateVersion: "1.0.0",
      synonyms: {},
    });
    expect(md).toContain("- @vitejs/plugin-react");
    expect(md).toContain("- vite");
  });

  it("renders synonyms with suggestion text", () => {
    const md = generateAvailableDepsMarkdown({
      packageJson: samplePkg,
      boilerplateVersion: "1.0.0",
      synonyms: {
        axios: {
          available: "fetch",
          reason: "x",
          suggestion: "Use the built-in `fetch` API instead of axios.",
        },
      },
    });
    expect(md).toContain("- `axios` → Use the built-in `fetch` API");
  });

  it("emits placeholder when no deps", () => {
    const md = generateAvailableDepsMarkdown({
      packageJson: { dependencies: {}, devDependencies: {} },
      boilerplateVersion: "0.0.1",
      synonyms: {},
    });
    expect(md).toContain("_(none — see DEPENDENCIES.md)_");
    expect(md).toContain("_(none)_");
    expect(md).toContain("_(no synonyms registered)_");
  });

  it("works with the real boilerplate SYNONYMS", () => {
    const md = generateAvailableDepsMarkdown({
      packageJson: samplePkg,
      boilerplateVersion: "1.0.0",
      synonyms: SYNONYMS,
    });
    expect(md).toContain("axios");
    expect(md).toContain("dayjs");
    expect(md).toContain("@chakra-ui/react");
  });
});
