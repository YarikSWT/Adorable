// Unit-тесты для parseBuildErrors / parseBuildWarnings.
// Корпус — типичные строки vite/esbuild stderr (см. CONTRACTS §4,
// BUILD_PIPELINE §4.4, DEPENDENCIES.md §5).

import { describe, expect, it } from "vitest";

import {
  parseBuildErrors,
  parseBuildWarnings,
} from "@/lib/preview/build-error-parser";

const empty = { stdout: "", stderr: "" };

describe("parseBuildErrors — module-not-found / import-not-allowed", () => {
  it("parses 'Could not resolve' as module-not-found for unknown package", () => {
    const stderr = `Could not resolve "totally-unknown-pkg" from src/App.tsx`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("module-not-found");
    expect(errs[0].missingModule).toBe("totally-unknown-pkg");
    expect(errs[0].file).toBe("src/App.tsx");
    expect(errs[0].suggestion).toBeUndefined();
  });

  it("parses 'Could not resolve' as import-not-allowed for synonym (axios)", () => {
    const stderr = `Could not resolve "axios" from src/api.ts`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("import-not-allowed");
    expect(errs[0].missingModule).toBe("axios");
    expect(errs[0].suggestion).toMatch(/fetch/i);
  });

  it("parses scoped synonym (@chakra-ui/react)", () => {
    const stderr = `Could not resolve "@chakra-ui/react" from src/Button.tsx`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs[0].code).toBe("import-not-allowed");
    expect(errs[0].missingModule).toBe("@chakra-ui/react");
  });

  it("flags systemFailure as 'unknown' if boilerplate dep is missing", () => {
    const stderr = `Could not resolve "react" from src/App.tsx`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs[0].code).toBe("unknown");
    expect(errs[0].missingModule).toBe("react");
    expect(errs[0].message).toMatch(/boilerplate dependency/i);
  });

  it("dedupes identical Could-not-resolve entries", () => {
    const stderr = [
      `Could not resolve "axios" from src/a.ts`,
      `Could not resolve "axios" from src/a.ts`,
    ].join("\n");
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(1);
  });

  it("emits one entry per distinct missing module", () => {
    const stderr = [
      `Could not resolve "axios" from src/a.ts`,
      `Could not resolve "lodash-es" from src/b.ts`,
    ].join("\n");
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(2);
    expect(errs.map((e) => e.missingModule).sort()).toEqual([
      "axios",
      "lodash-es",
    ]);
  });
});

describe("parseBuildErrors — syntax errors", () => {
  it("parses esbuild ERROR: Expected", () => {
    const stderr = `
✘ [ERROR]: Expected "}" but found "<eof>"
    src/App.tsx:42:10
`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("syntax-error");
    expect(errs[0].message).toMatch(/Expected/);
    expect(errs[0].file).toBe("src/App.tsx");
    expect(errs[0].line).toBe(42);
    expect(errs[0].column).toBe(10);
  });

  it("parses Babel-style SyntaxError", () => {
    const stderr = `SyntaxError: Unexpected token (12:5) at src/index.tsx:12:5`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs.some((e) => e.code === "syntax-error")).toBe(true);
  });
});

describe("parseBuildErrors — transform / plugin errors", () => {
  it("parses Vite plugin error", () => {
    const stderr = `
[plugin:vite-plugin-react] Failed to transform src/Foo.tsx
Some details
`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs.some((e) => e.code === "transform-error")).toBe(true);
  });

  it("parses 'Transform failed'", () => {
    const stderr = `Transform failed with 1 error: src/Bar.tsx:9:0`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs.some((e) => e.code === "transform-error")).toBe(true);
  });
});

describe("parseBuildErrors — config errors", () => {
  it("parses 'failed to load config'", () => {
    const stderr = `failed to load config from /workspace/vite.config.js`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs.some((e) => e.code === "config-error")).toBe(true);
  });

  it("parses missing vite module", () => {
    const stderr = `Cannot find module 'vite'`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs.some((e) => e.code === "config-error")).toBe(true);
  });
});

describe("parseBuildErrors — fallback unknown", () => {
  it("emits a single unknown when stderr does not match any rule", () => {
    const stderr = "some unparseable garbage that doesn't match patterns";
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("unknown");
    expect(errs[0].message).toContain("garbage");
  });

  it("returns [] for fully empty input", () => {
    expect(parseBuildErrors(empty)).toEqual([]);
  });

  it("returns [] when only stdout is present and no failure", () => {
    const stdout = `vite v5.4.8 building for production...
✓ 32 modules transformed.
dist/index.html  0.45 kB
✓ built in 1.24s`;
    expect(parseBuildErrors({ stdout, stderr: "" })).toEqual([]);
  });

  it("clamps unknown message to 2000 chars", () => {
    const stderr = "x".repeat(5000);
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(1);
    expect(errs[0].message.length).toBeLessThanOrEqual(2000);
  });
});

describe("parseBuildWarnings", () => {
  it("captures simple WARNING lines", () => {
    const stderr = `
[WARNING]: deprecated API used
    src/Old.tsx:7:1
[WARNING]: deprecated API used
    src/Old.tsx:7:1
[warn]: postcss-import: ignoring import
`;
    const warns = parseBuildWarnings({ stdout: "", stderr });
    // Дедупликация: первая строка должна посчитаться один раз
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expect(warns.some((w) => /deprecated/i.test(w.message))).toBe(true);
    expect(warns.some((w) => /postcss/i.test(w.message))).toBe(true);
  });

  it("returns [] on empty input", () => {
    expect(parseBuildWarnings(empty)).toEqual([]);
  });
});
