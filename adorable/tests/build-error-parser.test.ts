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

describe("parseBuildErrors — benign stderr noise on successful builds", () => {
  // Real captures from a successful `npx vite build` run inside the
  // build-runner image (Vite v5.4.21 + npm 10). Reproducer: STATIC_MODE
  // _REMAINING.md §6 — `errorsCount: 1` with exitCode=0 was caused by the
  // fallback unknown-error branch firing on these benign banners.
  const VITE_5_DEPRECATION_BANNER =
    "The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.";
  const VITE_5_SUCCESS_STDOUT = `vite v5.4.21 building for production...
transforming...
✓ 1601 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  0.45 kB │ gzip:   0.30 kB
dist/assets/index-DJKLm0kF.css  12.34 kB │ gzip:   3.21 kB
dist/assets/index-Bq2J8Pol.js  178.00 kB │ gzip:  56.78 kB
✓ built in 6.81s`;

  it("returns [] for the Vite 5.4 CJS deprecation banner alone", () => {
    expect(
      parseBuildErrors({ stdout: "", stderr: VITE_5_DEPRECATION_BANNER }),
    ).toEqual([]);
  });

  it("returns [] for a full successful Vite 5 build (banner on stderr, summary on stdout)", () => {
    expect(
      parseBuildErrors({
        stdout: VITE_5_SUCCESS_STDOUT,
        stderr: VITE_5_DEPRECATION_BANNER,
      }),
    ).toEqual([]);
  });

  it("returns [] for npm warn/notice/info noise", () => {
    const stderr = `npm warn deprecated source-map@0.8.0-beta.0
npm notice updating package-lock.json
npm info ok`;
    expect(parseBuildErrors({ stdout: "", stderr })).toEqual([]);
  });

  it("returns [] for Browserslist 'is outdated' nag", () => {
    const stderr = `Browserslist: caniuse-lite is outdated. Please run:
  npx update-browserslist-db@latest
  Why you should do it regularly: https://github.com/browserslist/update-db#readme`;
    // The two known nag lines are stripped; the explanatory third line
    // remains and *would* trigger the fallback. That is acceptable
    // behavior — it is unusual to see such output without exitCode=0,
    // and the build queue already gates errorsCount on exitCode.
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs.every((e) => !/caniuse-lite/.test(e.message))).toBe(true);
  });

  it("still emits an unknown error when stderr contains real failure noise", () => {
    const stderr = `${VITE_5_DEPRECATION_BANNER}
Internal error: build executor crashed unexpectedly
exit code 137`;
    const errs = parseBuildErrors({ stdout: "", stderr });
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("unknown");
    expect(errs[0].message).toContain("Internal error");
    // The banner was stripped, the actionable line remained.
    expect(errs[0].message).not.toContain("CJS build");
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
