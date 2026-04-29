// Тесты для isWritablePath / explainNonWritable (CONTRACTS §9, ADR-007).
// Pure-функции, без fs/io. Запретный whitelist — критичная security-граница,
// поэтому покрытие подробное.

import { describe, expect, it } from "vitest";

import {
  explainNonWritable,
  isWritablePath,
} from "@/lib/preview/project-fs";

describe("isWritablePath — accepts", () => {
  it.each([
    ["src/App.tsx"],
    ["src/components/Button.tsx"],
    ["src/utils/helpers.ts"],
    ["src/main.jsx"],
    ["src/index.js"],
    ["src/styles/global.css"],
    ["src/styles/theme.scss"],
    ["src/page.html"],
    ["src/data/config.json"],
    ["public/icon.svg"],
    ["public/manifest.webmanifest"],
    ["public/data.json"],
    ["public/sitemap.xml"],
    ["public/robots.txt"],
    ["public/index.html"],
    ["functions/api.ts"],
    ["functions/handlers/auth.ts"],
    ["functions/config.json"],
  ])("allows %s", (path) => {
    expect(isWritablePath(path)).toBe(true);
  });
});

describe("isWritablePath — rejects (root + extension)", () => {
  it.each([
    ["index.html"], // root files
    ["package.json"],
    ["vite.config.js"],
    ["node_modules/x.js"],
    ["dist/x.js"],
    [".env"],
    ["src/App.css.bak"], // unknown extension in src
    ["public/cat.jpg"], // binary in public
    ["public/photo.png"],
    ["public/font.woff2"],
    ["functions/api.js"], // js in functions (only ts/json allowed)
    ["functions/tsconfig.json"], // explicit boilerplate file
    ["src/script.py"], // unknown extension
    ["src/binary.wasm"],
  ])("rejects %s", (path) => {
    expect(isWritablePath(path)).toBe(false);
  });
});

describe("isWritablePath — rejects (security)", () => {
  it.each([
    ["../escape.txt"],
    ["src/../escape.txt"],
    ["src/components/../../etc/passwd"],
    ["/etc/passwd"],
    ["/src/App.tsx"],
    ["src/file\0name.tsx"],
    [""], // empty
    ["./src/App.tsx"], // explicit ./ leading segment is rejected
  ])("rejects %s", (path) => {
    expect(isWritablePath(path)).toBe(false);
  });
});

describe("explainNonWritable", () => {
  it("explains absolute path", () => {
    expect(explainNonWritable("/etc/passwd")).toMatch(/absolute/i);
  });

  it("explains traversal", () => {
    expect(explainNonWritable("src/../escape.txt")).toMatch(/traversal/i);
  });

  it("explains outside-of-writable-dirs", () => {
    expect(explainNonWritable("package.json")).toMatch(/src.*public.*functions/);
  });

  it("explains binary asset", () => {
    const msg = explainNonWritable("public/photo.png");
    expect(msg).toMatch(/binary/i);
    expect(msg).toMatch(/upload/i);
  });

  it("explains fixed tsconfig", () => {
    expect(explainNonWritable("functions/tsconfig.json")).toMatch(
      /fixed boilerplate/i,
    );
  });

  it("explains generic non-writable in writable dir", () => {
    expect(explainNonWritable("src/script.py")).toMatch(/not writable/i);
  });

  it("explains NUL byte", () => {
    expect(explainNonWritable("src/file\0name.tsx")).toMatch(/NUL/i);
  });

  it("explains empty path", () => {
    expect(explainNonWritable("")).toMatch(/empty/i);
  });
});
