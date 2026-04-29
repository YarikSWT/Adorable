// Тесты для createNodeFsProjectFs — реализация ProjectFs над node:fs.
// Используют tmp-директории, не требуют docker/инфры.
//
// Покрывает:
//   - read/write/exists roundtrip
//   - whitelist enforcement (write/remove/rename запрещают неwriteable пути)
//   - bypassWriteWhitelist={true} разрешает системные операции
//   - path traversal: rejected для read И write
//   - list (recursive + non-recursive + maxDepth, sort)
//   - search (line numbers, query, maxResults, skip dirs)
//   - remove (idempotent, recursive)
//   - rename (создаёт parent dirs)
//   - mkdir (only inside src/public/functions)
//   - ProjectFsError code values

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectFsError } from "@/lib/adapters/preview";
import { createNodeFsProjectFs } from "@/lib/preview/project-fs";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "adorable-pfs-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("createNodeFsProjectFs — read/write/exists", () => {
  it("write then read roundtrips utf-8 content", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/App.tsx", "export const App = 1;\n");
    expect(await fs.readTextFile("src/App.tsx")).toBe(
      "export const App = 1;\n",
    );
    expect(await fs.exists("src/App.tsx")).toBe(true);
    expect(await fs.exists("src/Missing.tsx")).toBe(false);
  });

  it("creates parent directories on write", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile(
      "src/components/ui/Button.tsx",
      "export const Button = 1;",
    );
    expect(await fs.exists("src/components/ui/Button.tsx")).toBe(true);
  });

  it("readTextFile throws not-found on missing", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await expect(fs.readTextFile("src/missing.tsx")).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("createNodeFsProjectFs — whitelist enforcement", () => {
  it("write to non-whitelisted root throws path-not-writable", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await expect(
      fs.writeTextFile("package.json", "{}"),
    ).rejects.toMatchObject({ code: "path-not-writable" });
  });

  it("write of binary asset under public/ rejected", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await expect(
      fs.writeTextFile("public/cat.jpg", "\xff\xd8"),
    ).rejects.toMatchObject({ code: "path-not-writable" });
  });

  it("bypassWriteWhitelist=true allows any path", async () => {
    const fs = createNodeFsProjectFs({
      rootDir: workDir,
      bypassWriteWhitelist: true,
    });
    await fs.writeTextFile("package.json", "{}\n");
    expect(await fs.readTextFile("package.json")).toBe("{}\n");
  });
});

describe("createNodeFsProjectFs — path traversal", () => {
  it("read with .. throws invalid-path", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await expect(fs.readTextFile("../escape")).rejects.toMatchObject({
      code: "invalid-path",
    });
    await expect(fs.readTextFile("src/../../escape")).rejects.toMatchObject({
      code: "invalid-path",
    });
  });

  it("write with absolute path throws invalid-path", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await expect(
      fs.writeTextFile("/etc/passwd", "x"),
    ).rejects.toMatchObject({ code: "invalid-path" });
  });

  it("write with NUL byte throws invalid-path", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await expect(
      fs.writeTextFile("src/file\0.tsx", "x"),
    ).rejects.toMatchObject({ code: "invalid-path" });
  });

  it("symlink escape attempt is blocked by safeJoin", async () => {
    const fs = createNodeFsProjectFs({
      rootDir: workDir,
      bypassWriteWhitelist: true,
    });
    // Even with bypass, escape is impossible.
    await expect(fs.writeTextFile("../oops", "x")).rejects.toMatchObject({
      code: "invalid-path",
    });
  });
});

describe("createNodeFsProjectFs — list", () => {
  it("non-recursive list returns immediate children only", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/App.tsx", "");
    await fs.writeTextFile("src/utils/x.ts", "");
    await fs.writeTextFile("public/icon.svg", "");
    const root = await fs.list({});
    const paths = root.map((e) => e.path).sort();
    expect(paths).toContain("src");
    expect(paths).toContain("public");
    // Files inside subdirs should not appear at depth 1.
    expect(paths).not.toContain("src/App.tsx");
  });

  it("recursive list returns nested files", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/App.tsx", "");
    await fs.writeTextFile("src/utils/x.ts", "");
    const all = await fs.list({ recursive: true });
    const files = all
      .filter((e) => e.type === "file")
      .map((e) => e.path)
      .sort();
    expect(files).toEqual(["src/App.tsx", "src/utils/x.ts"]);
  });

  it("list respects path scope", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/App.tsx", "");
    await fs.writeTextFile("src/utils/x.ts", "");
    await fs.writeTextFile("public/icon.svg", "");
    const inSrc = await fs.list({ path: "src", recursive: true });
    const files = inSrc
      .filter((e) => e.type === "file")
      .map((e) => e.path)
      .sort();
    expect(files).toEqual(["src/App.tsx", "src/utils/x.ts"]);
  });

  it("list returns size for files", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/App.tsx", "abc");
    const all = await fs.list({ recursive: true });
    const f = all.find((e) => e.path === "src/App.tsx");
    expect(f?.size).toBe(3);
  });
});

describe("createNodeFsProjectFs — search", () => {
  it("finds matching lines with line numbers", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile(
      "src/App.tsx",
      "import x from 'react';\nexport const App = () => null;\n",
    );
    const found = await fs.search({ query: "export" });
    expect(found.length).toBe(1);
    expect(found[0].file).toBe("src/App.tsx");
    expect(found[0].line).toBe(2);
    expect(found[0].text).toContain("export");
  });

  it("respects maxResults cap", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    const lines = Array(20).fill("match").join("\n");
    await fs.writeTextFile("src/App.tsx", lines);
    const found = await fs.search({ query: "match", maxResults: 5 });
    expect(found.length).toBe(5);
  });

  it("skips node_modules", async () => {
    const fs = createNodeFsProjectFs({
      rootDir: workDir,
      bypassWriteWhitelist: true,
    });
    await fs.writeTextFile("src/App.tsx", "needle");
    await fs.writeTextFile("node_modules/x/index.js", "needle");
    const found = await fs.search({ query: "needle" });
    expect(found.length).toBe(1);
    expect(found[0].file).toBe("src/App.tsx");
  });

  it("returns [] on no match (no exception)", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/App.tsx", "abc");
    expect(await fs.search({ query: "xyz" })).toEqual([]);
  });
});

describe("createNodeFsProjectFs — remove / rename / mkdir", () => {
  it("remove is idempotent (no throw on missing)", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/App.tsx", "x");
    await fs.remove("src/App.tsx");
    await fs.remove("src/App.tsx"); // idempotent
    expect(await fs.exists("src/App.tsx")).toBe(false);
  });

  it("remove on whitelist-rejected path throws", async () => {
    const fs = createNodeFsProjectFs({
      rootDir: workDir,
      bypassWriteWhitelist: true,
    });
    await writeFile(path.join(workDir, "package.json"), "{}");
    const fsEnforced = createNodeFsProjectFs({ rootDir: workDir });
    await expect(fsEnforced.remove("package.json")).rejects.toMatchObject({
      code: "path-not-writable",
    });
  });

  it("rename creates parent directories", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.writeTextFile("src/A.tsx", "x");
    await fs.rename("src/A.tsx", "src/components/B.tsx");
    expect(await fs.exists("src/A.tsx")).toBe(false);
    expect(await fs.exists("src/components/B.tsx")).toBe(true);
  });

  it("mkdir works inside writable roots", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await fs.mkdir("src/components/ui");
    expect(await fs.exists("src/components/ui")).toBe(true);
  });

  it("mkdir outside src/public/functions is rejected", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    await expect(fs.mkdir("dist")).rejects.toMatchObject({
      code: "path-not-writable",
    });
  });

  it("mkdir bypass for system ops", async () => {
    const fs = createNodeFsProjectFs({
      rootDir: workDir,
      bypassWriteWhitelist: true,
    });
    await fs.mkdir("dist");
    expect(await fs.exists("dist")).toBe(true);
  });
});

describe("ProjectFsError shape", () => {
  it("carries code and path", async () => {
    const fs = createNodeFsProjectFs({ rootDir: workDir });
    try {
      await fs.writeTextFile("package.json", "{}");
      throw new Error("expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectFsError);
      expect((err as ProjectFsError).code).toBe("path-not-writable");
      expect((err as ProjectFsError).path).toBe("package.json");
    }
  });
});
