// Tests for preview-static.build() audit-log integration:
// build_swap (after successful atomic swap) and build_gc (after
// garbageCollectBuilds removed at least one build dir).
//
// BUILD_PIPELINE.md §9.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockProxyProvider } from "@/lib/adapters/proxy-mock";
import {
  createStaticPreviewProvider,
  type BuildExecutor,
  type BuildExecutorInput,
  type BuildExecutorResult,
} from "@/lib/adapters/preview-static";
import { createAuditLogger } from "@/lib/sandbox/audit-log";
import type { PreviewProvider } from "@/lib/adapters/preview";

const writingExecutor = (contents: string): BuildExecutor => ({
  async runBuild(input: BuildExecutorInput): Promise<BuildExecutorResult> {
    const fs = await import("node:fs/promises");
    await fs.writeFile(path.join(input.artifactDir, "index.html"), contents);
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: false,
      timedOut: false,
      durationMs: 0,
    };
  },
});

let projectsRoot: string;
let staticRoot: string;
let logPath: string;
let proxy: ReturnType<typeof createMockProxyProvider>;

let activeLogger: ReturnType<typeof createAuditLogger> | null = null;

const readEvents = async (): Promise<unknown[]> => {
  if (activeLogger) await activeLogger.flush();
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

beforeEach(async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "adorable-pstatic-audit-"));
  projectsRoot = path.join(tmp, "projects");
  staticRoot = path.join(tmp, "static");
  logPath = path.join(tmp, "audit.log");
  proxy = createMockProxyProvider();
});

afterEach(async () => {
  await rm(path.dirname(projectsRoot), { recursive: true, force: true });
});

describe("preview-static — audit", () => {
  it("emits build_swap after atomic symlink swap", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    activeLogger = auditLogger;
    const provider: PreviewProvider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: writingExecutor("A"),
      auditLogger,
    });
    await provider.create({ repoId: "p1", boilerplateVersion: "1.0.0" });

    const r = await provider.build({
      projectId: "p1",
      reason: "initial",
      buildId: "first",
    });
    expect(r.status).toBe("succeeded");
    expect(r.wasSwapped).toBe(true);

    const events = (await readEvents()) as Array<Record<string, unknown>>;
    const swap = events.find((e) => e.event === "build_swap");
    expect(swap).toBeDefined();
    expect(swap).toMatchObject({
      event: "build_swap",
      projectId: "p1",
      buildId: "first",
    });
  });

  it("includes previousBuildId on second swap", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    activeLogger = auditLogger;
    const provider: PreviewProvider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: writingExecutor("X"),
      auditLogger,
    });
    await provider.create({ repoId: "p2", boilerplateVersion: "1.0.0" });

    await provider.build({
      projectId: "p2",
      reason: "initial",
      buildId: "first",
    });
    await provider.build({
      projectId: "p2",
      reason: "manual",
      buildId: "second",
    });

    const events = (await readEvents()) as Array<{
      event: string;
      buildId?: string;
      previousBuildId?: string;
    }>;
    const swaps = events.filter((e) => e.event === "build_swap");
    expect(swaps).toHaveLength(2);
    expect(swaps[1]).toMatchObject({
      event: "build_swap",
      buildId: "second",
      previousBuildId: "first",
    });
  });

  it("emits build_gc with deleted build IDs when limit is exceeded", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    activeLogger = auditLogger;
    const provider: PreviewProvider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: writingExecutor("X"),
      buildHistoryLimit: 2,
      auditLogger,
    });
    await provider.create({ repoId: "p3", boilerplateVersion: "1.0.0" });

    const ids = ["b001", "b002", "b003", "b004"];
    for (const id of ids) {
      await provider.build({
        projectId: "p3",
        reason: "manual",
        buildId: id,
      });
    }

    const events = (await readEvents()) as Array<{
      event: string;
      deletedBuilds?: string[];
    }>;
    const gcs = events.filter((e) => e.event === "build_gc");
    // The fourth build should have triggered a GC that deletes the
    // earliest non-protected entry.
    expect(gcs.length).toBeGreaterThan(0);
    const allDeleted = gcs.flatMap((g) => g.deletedBuilds ?? []);
    expect(allDeleted).toContain("b001");
  });

  it("emits build_runner_killed_timeout when executor reports timedOut", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    activeLogger = auditLogger;
    const timeoutExecutor: BuildExecutor = {
      async runBuild(): Promise<BuildExecutorResult> {
        return {
          exitCode: 137,
          stdout: "",
          stderr: "",
          cancelled: false,
          timedOut: true,
          durationMs: 120_000,
        };
      },
    };
    const provider: PreviewProvider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: timeoutExecutor,
      auditLogger,
    });
    await provider.create({ repoId: "p-to", boilerplateVersion: "1.0.0" });
    const r = await provider.build({
      projectId: "p-to",
      reason: "initial",
      buildId: "timed-out",
    });
    expect(r.status).toBe("failed");
    expect(r.errors.some((e) => /timed out/i.test(e.message))).toBe(true);

    const events = (await readEvents()) as Array<Record<string, unknown>>;
    const ev = events.find(
      (e) => e.event === "build_runner_killed_timeout",
    );
    expect(ev).toMatchObject({
      event: "build_runner_killed_timeout",
      projectId: "p-to",
      buildId: "timed-out",
      durationMs: 120_000,
      exitCode: 137,
    });
  });

  it("skips audit emission when no auditLogger is configured", async () => {
    const provider: PreviewProvider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: writingExecutor("X"),
    });
    await provider.create({ repoId: "p4", boilerplateVersion: "1.0.0" });
    const r = await provider.build({
      projectId: "p4",
      reason: "initial",
      buildId: "alone",
    });
    expect(r.status).toBe("succeeded");
    expect(r.wasSwapped).toBe(true);
    // logPath was never written to — readEvents returns [].
    expect(await readEvents()).toEqual([]);
  });
});
