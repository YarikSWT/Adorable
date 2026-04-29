// Тесты для readBoilerplateVersion (lib/preview/boilerplate-version.ts).

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetBoilerplateVersionCache,
  readBoilerplateVersion,
} from "@/lib/preview/boilerplate-version";

let tmpRoot: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "adorable-bvers-"));
  originalEnv = process.env["ADORABLE_TEMPLATE_DIR"];
  __resetBoilerplateVersionCache();
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env["ADORABLE_TEMPLATE_DIR"];
  else process.env["ADORABLE_TEMPLATE_DIR"] = originalEnv;
  __resetBoilerplateVersionCache();
});

describe("readBoilerplateVersion", () => {
  it("reads VERSION file, trims whitespace", async () => {
    process.env["ADORABLE_TEMPLATE_DIR"] = tmpRoot;
    await writeFile(path.join(tmpRoot, "VERSION"), "  1.2.3 \n", "utf8");
    expect(await readBoilerplateVersion()).toBe("1.2.3");
  });

  it("falls back to '0.0.0' when VERSION file is missing", async () => {
    process.env["ADORABLE_TEMPLATE_DIR"] = tmpRoot;
    expect(await readBoilerplateVersion()).toBe("0.0.0");
  });

  it("caches result — second read does not re-touch fs", async () => {
    process.env["ADORABLE_TEMPLATE_DIR"] = tmpRoot;
    await writeFile(path.join(tmpRoot, "VERSION"), "5.5.5\n", "utf8");
    expect(await readBoilerplateVersion()).toBe("5.5.5");
    // Now mutate the file underneath; cache should win.
    await writeFile(path.join(tmpRoot, "VERSION"), "9.9.9\n", "utf8");
    expect(await readBoilerplateVersion()).toBe("5.5.5");
  });

  it("__reset wipes cache so override env can change", async () => {
    process.env["ADORABLE_TEMPLATE_DIR"] = tmpRoot;
    await writeFile(path.join(tmpRoot, "VERSION"), "1.0.0\n", "utf8");
    expect(await readBoilerplateVersion()).toBe("1.0.0");
    __resetBoilerplateVersionCache();
    await writeFile(path.join(tmpRoot, "VERSION"), "2.0.0\n", "utf8");
    expect(await readBoilerplateVersion()).toBe("2.0.0");
  });

  it("uses bundled templates/vite-react/VERSION when env not set", async () => {
    delete process.env["ADORABLE_TEMPLATE_DIR"];
    __resetBoilerplateVersionCache();
    expect(await readBoilerplateVersion()).toBe("1.0.0");
  });
});
