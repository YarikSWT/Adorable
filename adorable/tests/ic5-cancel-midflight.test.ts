// IC-5 (VERIFICATION.md §2):
//   Cancel mid-flight cooperates between BuildQueue and the
//   BuildExecutor — when an enqueue cancels a running build the
//   executor sees signal.aborted, returns cancelled=true, and
//   preview-static cleans the partial artifact dir + emits the
//   "cancelled" event.
//
// Uses the BuildQueue + preview-static together with a slow executor
// that hangs until abort. Pure tmpdir + mocks; no docker.

import { mkdtemp, rm, stat } from "node:fs/promises";
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
import { createInMemoryBuildQueue } from "@/lib/preview/build-queue";
import type {
  BuildEvent,
  BuildQueue,
  PreviewProvider,
} from "@/lib/adapters/preview";

// Executor that hangs forever until signal is aborted, then returns
// cancelled=true. Mimics the dockerode executor which kills its
// container on signal.aborted.
const cancelAwareSlowExecutor = (): {
  exec: BuildExecutor;
  callCount: () => number;
} => {
  let calls = 0;
  return {
    exec: {
      async runBuild(input: BuildExecutorInput): Promise<BuildExecutorResult> {
        calls++;
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) return resolve();
          input.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return {
          exitCode: 143,
          stdout: "",
          stderr: "",
          cancelled: true,
          timedOut: false,
          durationMs: 0,
        };
      },
    },
    callCount: () => calls,
  };
};

let projectsRoot: string;
let staticRoot: string;
let proxy: ReturnType<typeof createMockProxyProvider>;
let provider: PreviewProvider;
let queue: BuildQueue;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "adorable-ic5-projects-"));
  staticRoot = await mkdtemp(path.join(tmpdir(), "adorable-ic5-static-"));
  proxy = createMockProxyProvider();
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
  await rm(staticRoot, { recursive: true, force: true });
});

describe("IC-5 — cancel mid-flight (signal cooperation)", () => {
  it("running build aborted via BuildQueue.cancel emits cancelled + cleans artifact", async () => {
    const { exec, callCount } = cancelAwareSlowExecutor();
    provider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: exec,
    });
    await provider.create({ repoId: "p", boilerplateVersion: "1.0.0" });

    queue = createInMemoryBuildQueue({
      runJob: async ({ job, signal }) =>
        provider.build({
          projectId: job.projectId,
          reason: job.reason,
          signal,
          buildId: `build-${job.jobId.slice(0, 8)}`,
        }),
    });

    const events: BuildEvent[] = [];
    queue.subscribe("p", (e) => events.push(e));

    const first = await queue.enqueue({ projectId: "p", reason: "manual" });
    expect(first.status).toBe("running");

    // Wait a bit so the executor's await-on-signal is registered.
    await new Promise((r) => setTimeout(r, 10));
    expect(callCount()).toBe(1);

    // Now cancel the running job through the queue.
    await queue.cancel("p");

    // Wait for executor to react to abort + queue to emit final event.
    await new Promise((r) => setTimeout(r, 30));

    const finals = events.filter((e) => e.jobId === first.jobId);
    const cancelled = finals.find((e) => e.status === "cancelled");
    expect(cancelled).toBeDefined();
    // The static provider's BuildResult preserved the executor's
    // exitCode (143 = SIGTERM). The queue keeps result intact when the
    // executor itself reported cancelled=true.
    expect(cancelled?.result?.exitCode).toBe(143);

    // artifactDir for the running build should NOT exist (preview-static
    // removes it on cancel).
    const buildsDir = path.join(staticRoot, "p", "builds");
    const remaining = await (await import("node:fs/promises")).readdir(
      buildsDir,
    );
    // Only the placeholder should remain.
    expect(remaining).toEqual(["placeholder"]);
  });

  it("re-enqueue while running cancels the running and promotes the new", async () => {
    const { exec, callCount } = cancelAwareSlowExecutor();
    provider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: exec,
    });
    await provider.create({ repoId: "p2", boilerplateVersion: "1.0.0" });

    queue = createInMemoryBuildQueue({
      runJob: async ({ job, signal }) =>
        provider.build({
          projectId: job.projectId,
          reason: job.reason,
          signal,
          buildId: `build-${job.jobId.slice(0, 8)}`,
        }),
    });
    const events: BuildEvent[] = [];
    queue.subscribe("p2", (e) => events.push(e));

    const a = await queue.enqueue({ projectId: "p2", reason: "manual" });
    expect(a.status).toBe("running");
    await new Promise((r) => setTimeout(r, 10));

    const b = await queue.enqueue({ projectId: "p2", reason: "manual" });
    expect(b.status).toBe("queued");

    await new Promise((r) => setTimeout(r, 30));

    // a was cancelled, b promoted to running.
    const aCancelled = events.find(
      (e) => e.jobId === a.jobId && e.status === "cancelled",
    );
    expect(aCancelled).toBeDefined();
    const bRunning = events.find(
      (e) => e.jobId === b.jobId && e.status === "running",
    );
    expect(bRunning).toBeDefined();
    expect(callCount()).toBe(2);

    // Cleanup: cancel b too so the test exits cleanly.
    await queue.cancel("p2");
    await new Promise((r) => setTimeout(r, 30));
  });
});
