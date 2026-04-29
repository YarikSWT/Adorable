// Verifies createStaticTools logs a `path_rejected` audit event when
// the LLM hits the writable whitelist via writeFileTool / mkdir /
// move / delete. Security-relevant per SECURITY.md §6.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeFsProjectFs } from "@/lib/preview/project-fs";
import { createInMemoryBuildQueue } from "@/lib/preview/build-queue";
import { createStaticTools } from "@/lib/create-static-tools";
import { createAuditLogger } from "@/lib/sandbox/audit-log";
import type { BuildResult } from "@/lib/adapters/preview";

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

let workDir: string;
let logPath: string;

beforeEach(async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "adorable-cstools-audit-"));
  workDir = path.join(tmp, "scratch");
  logPath = path.join(tmp, "audit.log");
});

afterEach(async () => {
  await rm(path.dirname(workDir), { recursive: true, force: true });
});

const callTool = async (
  tool: unknown,
  input: unknown,
): Promise<unknown> => {
  const exec = (
    tool as { execute?: (i: unknown, ctx: unknown) => Promise<unknown> }
  ).execute;
  if (!exec) throw new Error("tool has no execute");
  return exec(input, {} as unknown);
};

let activeAuditLogger: ReturnType<typeof createAuditLogger> | null = null;

const readEvents = async (): Promise<unknown[]> => {
  if (activeAuditLogger) await activeAuditLogger.flush();
  let raw = "";
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};

const buildTools = () => {
  const fs = createNodeFsProjectFs({ rootDir: workDir });
  const queue = createInMemoryBuildQueue({ runJob: async () => succeeded() });
  const auditLogger = createAuditLogger({ path: logPath });
  activeAuditLogger = auditLogger;
  return createStaticTools({
    fs,
    buildQueue: queue,
    projectId: "p-audit",
    auditLogger,
  });
};

describe("createStaticTools — path_rejected audit", () => {
  it("emits path_rejected when writeFileTool hits the whitelist", async () => {
    const tools = buildTools();
    const res = (await callTool(tools.writeFileTool, {
      file: "package.json",
      content: "{}",
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
    const events = (await readEvents()) as Array<Record<string, unknown>>;
    const ev = events.find((e) => e.event === "path_rejected");
    expect(ev).toMatchObject({
      event: "path_rejected",
      projectId: "p-audit",
      path: "package.json",
      tool: "write",
    });
  });

  it("emits path_rejected for mkdir outside writable roots", async () => {
    const tools = buildTools();
    await callTool(tools.makeDirectoryTool, { path: "dist" });
    const ev = (await readEvents()).find(
      (e) =>
        (e as { event: string }).event === "path_rejected" &&
        (e as { tool: string }).tool === "mkdir",
    );
    expect(ev).toBeDefined();
  });

  it("emits path_rejected for traversal in deletePath", async () => {
    const tools = buildTools();
    await callTool(tools.deletePathTool, { path: "../escape" });
    const ev = (await readEvents()).find(
      (e) =>
        (e as { event: string }).event === "path_rejected" &&
        (e as { tool: string }).tool === "remove",
    );
    expect(ev).toBeDefined();
  });

  it("emits path_rejected for movePath into non-writable area", async () => {
    const tools = buildTools();
    await callTool(tools.writeFileTool, { file: "src/A.tsx", content: "x" });
    await callTool(tools.movePathTool, {
      from: "src/A.tsx",
      to: "package.json",
    });
    const ev = (await readEvents()).find(
      (e) =>
        (e as { event: string }).event === "path_rejected" &&
        (e as { tool: string }).tool === "rename",
    );
    expect(ev).toBeDefined();
  });

  it("does NOT emit on legitimate writes", async () => {
    const tools = buildTools();
    await callTool(tools.writeFileTool, {
      file: "src/A.tsx",
      content: "x",
    });
    const evs = (await readEvents()).filter(
      (e) => (e as { event: string }).event === "path_rejected",
    );
    expect(evs).toEqual([]);
  });
});
