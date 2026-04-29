// Тесты для createStaticTools — capability-driven LLM tools для
// PreviewProvider'а в static-режиме. Используют mock provider's
// in-memory ProjectFs + real BuildQueue + mock build provider.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockPreviewProvider } from "@/lib/adapters/preview-mock";
import { createInMemoryBuildQueue } from "@/lib/preview/build-queue";
import { createStaticTools } from "@/lib/create-static-tools";
import type { BuildQueue, BuildResult, PreviewProvider } from "@/lib/adapters/preview";

const succeeded = (): BuildResult => ({
  status: "succeeded",
  exitCode: 0,
  durationMs: 0,
  wasSwapped: true,
  errors: [],
  warnings: [],
  stdout: "",
  stderr: "",
});

let provider: PreviewProvider;
let queue: BuildQueue;
let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "adorable-cstools-"));
  provider = createMockPreviewProvider();
  await provider.create({ repoId: "p1", boilerplateVersion: "1.0.0" });
  queue = createInMemoryBuildQueue({
    runJob: async () => succeeded(),
  });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const callTool = async (
  tool: unknown,
  input: unknown,
): Promise<unknown> => {
  const exec = (tool as { execute?: (i: unknown, ctx: unknown) => Promise<unknown> })
    .execute;
  if (!exec) throw new Error("tool has no execute");
  return exec(input, {} as unknown);
};

describe("createStaticTools — file tools", () => {
  it("read after write roundtrip", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });

    let writeRes = (await callTool(tools.writeFileTool, {
      file: "src/App.tsx",
      content: "export const App = 1;",
    })) as { ok: boolean };
    expect(writeRes.ok).toBe(true);

    const readRes = (await callTool(tools.readFileTool, {
      file: "src/App.tsx",
    })) as { ok: boolean; content: string };
    expect(readRes.ok).toBe(true);
    expect(readRes.content).toContain("App");
  });

  it("write fires onFileChange callback", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const seen: Array<[string, string]> = [];
    const tools = createStaticTools({
      fs,
      buildQueue: queue,
      projectId: "p1",
      onFileChange: (p, c) => seen.push([p, c]),
    });
    await callTool(tools.writeFileTool, { file: "src/x.tsx", content: "x" });
    expect(seen).toEqual([["src/x.tsx", "x"]]);
  });

  it("write returns friendly error for non-writable path (no throw)", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    const res = (await callTool(tools.writeFileTool, {
      file: "../escape",
      content: "x",
    })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("replaceInFile replaces all occurrences by default", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    await callTool(tools.writeFileTool, {
      file: "src/x.tsx",
      content: "foo bar foo baz",
    });
    const res = (await callTool(tools.replaceInFileTool, {
      file: "src/x.tsx",
      search: "foo",
      replace: "qux",
      all: true,
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    const back = (await callTool(tools.readFileTool, {
      file: "src/x.tsx",
    })) as { content: string };
    expect(back.content).toBe("qux bar qux baz");
  });

  it("replaceInFile errors when search string not found", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    await callTool(tools.writeFileTool, {
      file: "src/x.tsx",
      content: "abc",
    });
    const res = (await callTool(tools.replaceInFileTool, {
      file: "src/x.tsx",
      search: "missing",
      replace: "x",
      all: true,
    })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("appendToFile creates the file when missing", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    await callTool(tools.appendToFileTool, {
      file: "src/notes.md",
      content: "hello",
    });
    const back = (await callTool(tools.readFileTool, {
      file: "src/notes.md",
    })) as { content: string };
    expect(back.content).toBe("hello");
  });

  it("listFiles returns project entries", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    await callTool(tools.writeFileTool, { file: "src/a.tsx", content: "a" });
    await callTool(tools.writeFileTool, { file: "src/b.tsx", content: "b" });
    const res = (await callTool(tools.listFilesTool, {
      path: "src",
      recursive: true,
      maxDepth: 3,
    })) as { ok: boolean; entries: Array<{ path: string; type: string }> };
    expect(res.ok).toBe(true);
    expect(res.entries.map((e) => e.path).sort()).toEqual(
      expect.arrayContaining(["src/a.tsx", "src/b.tsx"]),
    );
  });

  it("searchFiles finds matches with line numbers", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    await callTool(tools.writeFileTool, {
      file: "src/x.tsx",
      content: "first\nNEEDLE here\nthird",
    });
    const res = (await callTool(tools.searchFilesTool, {
      query: "NEEDLE",
      path: "src",
      maxResults: 10,
    })) as {
      ok: boolean;
      results: Array<{ file: string; line: number; text: string }>;
    };
    expect(res.ok).toBe(true);
    expect(res.results[0].line).toBe(2);
  });

  it("delete removes file and fires onFileDelete", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const deleted: string[] = [];
    const tools = createStaticTools({
      fs,
      buildQueue: queue,
      projectId: "p1",
      onFileDelete: (p) => deleted.push(p),
    });
    await callTool(tools.writeFileTool, { file: "src/x.tsx", content: "x" });
    await callTool(tools.deletePathTool, { path: "src/x.tsx" });
    expect(deleted).toEqual(["src/x.tsx"]);
  });

  it("move renames file and fires onFileDelete for source", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const deleted: string[] = [];
    const tools = createStaticTools({
      fs,
      buildQueue: queue,
      projectId: "p1",
      onFileDelete: (p) => deleted.push(p),
    });
    await callTool(tools.writeFileTool, { file: "src/x.tsx", content: "x" });
    await callTool(tools.movePathTool, {
      from: "src/x.tsx",
      to: "src/y.tsx",
    });
    expect(deleted).toContain("src/x.tsx");
    const back = (await callTool(tools.readFileTool, {
      file: "src/y.tsx",
    })) as { content: string };
    expect(back.content).toBe("x");
  });

  it("makeDirectory creates dir", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    const res = (await callTool(tools.makeDirectoryTool, {
      path: "src/components",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
  });
});

describe("createStaticTools — build tools", () => {
  it("requestRebuildTool enqueues a build", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    const res = (await callTool(tools.requestRebuildTool, {})) as {
      ok: boolean;
      jobId: string;
      status: string;
    };
    expect(res.ok).toBe(true);
    expect(typeof res.jobId).toBe("string");
    expect(res.status).toMatch(/^(running|queued)$/);
  });

  it("getBuildLogsTool returns no completed build initially", async () => {
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("fs");
    const tools = createStaticTools({ fs, buildQueue: queue, projectId: "p1" });
    const res = (await callTool(tools.getBuildLogsTool, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no completed build/i);
  });
});
