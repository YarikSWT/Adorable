// Тесты для classifyMissingModule (lib/preview/available-deps.ts).
// Pure-функция, без fs/io.

import { describe, expect, it } from "vitest";

import {
  ALL_BOILERPLATE_DEPS,
  BOILERPLATE_RUNTIME_DEPS,
  classifyMissingModule,
  SYNONYMS,
} from "@/lib/preview/available-deps";

describe("classifyMissingModule", () => {
  it("returns import-not-allowed + suggestion for synonyms", () => {
    const r = classifyMissingModule("axios");
    expect(r.code).toBe("import-not-allowed");
    expect(r.suggestion).toMatch(/fetch/i);
  });

  it("returns import-not-allowed for renamed package (react-query)", () => {
    const r = classifyMissingModule("react-query");
    expect(r.code).toBe("import-not-allowed");
    expect(r.suggestion).toMatch(/@tanstack\/react-query/);
  });

  it("returns module-not-found for unknown packages", () => {
    const r = classifyMissingModule("totally-fictional-pkg-xyz");
    expect(r.code).toBe("module-not-found");
    expect(r.suggestion).toBeUndefined();
  });

  it("handles scoped packages in synonyms", () => {
    const r = classifyMissingModule("@chakra-ui/react");
    expect(r.code).toBe("import-not-allowed");
    expect(r.suggestion).toMatch(/Tailwind/);
  });

  it("flags systemFailure when boilerplate dep is missing in build", () => {
    const r = classifyMissingModule("react");
    expect(r.code).toBe("unknown");
    expect(r.systemFailure).toBe(true);
  });

  it("strips package subpath when checking allow-set", () => {
    const r = classifyMissingModule("react-router-dom/dist/index.js");
    expect(r.code).toBe("unknown");
    expect(r.systemFailure).toBe(true);
  });

  it("strips scoped package subpath when checking", () => {
    const r = classifyMissingModule("@vitejs/plugin-react/dist/index.js");
    expect(r.code).toBe("unknown");
    expect(r.systemFailure).toBe(true);
  });

  it("strips quotes from raw name", () => {
    const r = classifyMissingModule('"axios"');
    expect(r.code).toBe("import-not-allowed");
  });

  it("returns module-not-found for empty input", () => {
    const r = classifyMissingModule("");
    expect(r.code).toBe("module-not-found");
  });

  it("respects custom allowSet override", () => {
    const r = classifyMissingModule("custom-pkg", {
      allowSet: new Set(["custom-pkg"]),
    });
    expect(r.code).toBe("unknown");
    expect(r.systemFailure).toBe(true);
  });

  it("respects custom synonyms override", () => {
    const r = classifyMissingModule("foo-pkg", {
      synonyms: {
        "foo-pkg": {
          reason: "custom",
          suggestion: "use bar instead",
        },
      },
    });
    expect(r.code).toBe("import-not-allowed");
    expect(r.suggestion).toBe("use bar instead");
  });
});

describe("static dep tables", () => {
  it("BOILERPLATE_RUNTIME_DEPS includes core React + Tailwind helpers", () => {
    for (const dep of [
      "react",
      "react-dom",
      "react-router-dom",
      "lucide-react",
      "tailwind-merge",
      "clsx",
      "class-variance-authority",
    ]) {
      expect(BOILERPLATE_RUNTIME_DEPS.has(dep)).toBe(true);
    }
  });

  it("ALL_BOILERPLATE_DEPS includes vite + plugin-react", () => {
    expect(ALL_BOILERPLATE_DEPS.has("vite")).toBe(true);
    expect(ALL_BOILERPLATE_DEPS.has("@vitejs/plugin-react")).toBe(true);
  });

  it("SYNONYMS covers the expected denylist set", () => {
    for (const name of [
      "axios",
      "express",
      "fastify",
      "next",
      "react-query",
      "lodash-es",
      "dayjs",
      "luxon",
      "mongodb",
      "pg",
      "jquery",
      "styled-components",
      "@mui/material",
      "@chakra-ui/react",
    ]) {
      expect(SYNONYMS[name]).toBeDefined();
      expect(SYNONYMS[name].suggestion.length).toBeGreaterThan(0);
    }
  });
});
