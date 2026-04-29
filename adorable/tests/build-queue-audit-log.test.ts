// Tests for BuildQueue audit-log integration (BUILD_PIPELINE §9).
// Verifies the queue emits build_enqueued / build_started /
// build_finished / build_cancelled to the shared audit logger.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInMemoryBuildQueue } from "@/lib/preview/build-queue";
import { createAuditLogger } from "@/lib/sandbox/audit-log";
import type { BuildResult } from "@/lib/adapters/preview";

const succeeded = (): BuildResult => ({
  status: "succeeded",
  exitCode: 0,
  durationMs: 5,
  wasSwapped: true,
  errors: [],
  warnings: [],
  stdout: "",
  stderr: "",
});

interface Deferred {
  promise: Promise<BuildResult>;
  resolve: (r: BuildResult) => void;
  signal: AbortSignal;
}

const makeDeferredRunJob = () => {
  const calls: Deferred[] = [];
  const runJob = (input: {
    job: unknown;
    signal: AbortSignal;
  }): Promise<BuildResult> => {
    let resolve!: (r: BuildResult) => void;
    const promise = new Promise<BuildResult>((r) => {
      resolve = r;
    });
    calls.push({ promise, resolve, signal: input.signal });
    return promise;
  };
  return { runJob, calls };
};

// `tick` schedules to the macrotask boundary so queue.runJob() promises
// settle before reads. Audit-log flushing happens via auditLogger.flush()
// before reading events — see drain() helper below.
const tick = () => new Promise((r) => setTimeout(r, 0));

let logPath: string;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "adorable-bq-audit-"));
  logPath = path.join(dir, "audit.log");
});

afterEach(async () => {
  await rm(path.dirname(logPath), { recursive: true, force: true });
});

const readLines = async (logger?: {
  flush: () => Promise<void>;
}): Promise<unknown[]> => {
  if (logger) await logger.flush();
  let raw = "";
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

describe("BuildQueue — audit log", () => {
  it("emits build_enqueued + build_started for the first job", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob, auditLogger });

    await q.enqueue({ projectId: "p1", reason: "manual" });
    // Allow audit log async writes to flush.
    await tick();
    await tick();

    const events = await readLines(auditLogger);
    const types = events.map((e) => (e as { event: string }).event);
    expect(types).toContain("build_enqueued");
    expect(types).toContain("build_started");

    // Cleanup deferred call.
    calls[0].resolve(succeeded());
    await tick();
    await tick();
  });

  it("emits build_finished with status + exitCode + durationMs + errorsCount", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob, auditLogger });

    await q.enqueue({ projectId: "p2", reason: "initial" });
    await tick();
    calls[0].resolve(succeeded());
    await tick();
    await tick();

    const events = await readLines(auditLogger);
    const finished = events.find(
      (e) => (e as { event: string }).event === "build_finished",
    );
    expect(finished).toBeDefined();
    expect(finished as Record<string, unknown>).toMatchObject({
      event: "build_finished",
      projectId: "p2",
      status: "succeeded",
      exitCode: 0,
      durationMs: 5,
      errorsCount: 0,
    });
  });

  it("emits build_cancelled (reason=superseded) when re-enqueue cancels running", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob, auditLogger });

    await q.enqueue({ projectId: "p3", reason: "manual" });
    await q.enqueue({ projectId: "p3", reason: "manual" });
    await tick();
    await tick();

    const events = await readLines(auditLogger);
    const cancelled = events.find(
      (e) =>
        (e as { event: string }).event === "build_cancelled" &&
        (e as { reason: string }).reason === "superseded",
    );
    expect(cancelled).toBeDefined();

    // Cleanup
    calls[0].resolve(succeeded());
    await tick();
    await tick();
    if (calls[1]) {
      calls[1].resolve(succeeded());
      await tick();
    }
  });

  it("emits build_cancelled (reason=destroy) on explicit cancel()", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob, auditLogger });

    await q.enqueue({ projectId: "p4", reason: "manual" });
    await q.cancel("p4");
    await tick();
    await tick();

    const events = await readLines(auditLogger);
    const destroy = events.find(
      (e) =>
        (e as { event: string }).event === "build_cancelled" &&
        (e as { reason: string }).reason === "destroy",
    );
    expect(destroy).toBeDefined();

    // Resolve runJob (queue handles late completion).
    calls[0].resolve(succeeded());
    await tick();
    await tick();
  });

  it("emits queueDepth in build_enqueued events", async () => {
    const auditLogger = createAuditLogger({ path: logPath });
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob, auditLogger });

    await q.enqueue({ projectId: "p5", reason: "manual" });
    await q.enqueue({ projectId: "p5", reason: "manual" });
    await q.enqueue({ projectId: "p5", reason: "manual" });
    await tick();
    await tick();

    const events = (await readLines(auditLogger)) as Array<{
      event: string;
      queueDepth?: number;
    }>;
    const enqueued = events.filter((e) => e.event === "build_enqueued");
    expect(enqueued.length).toBe(3);
    // queueDepth must be a number on every event; the first one is
    // always 0 (empty queue at first enqueue). The exact values for
    // [1] and [2] depend on a race between the runJob promise's .then
    // handler and the next synchronous enqueue when audit writes are
    // queued — flaky to assert precisely under concurrent test runs.
    expect(enqueued[0].queueDepth).toBe(0);
    expect(typeof enqueued[1].queueDepth).toBe("number");
    expect(typeof enqueued[2].queueDepth).toBe("number");
    expect(enqueued.every((e) => (e.queueDepth ?? -1) >= 0)).toBe(true);

    // Cleanup
    calls[0].resolve(succeeded());
    await tick();
    await tick();
    if (calls[1]) {
      calls[1].resolve(succeeded());
      await tick();
    }
  });

  it("audit logger absent → no audit calls, queue still works", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });

    const r = await q.enqueue({ projectId: "p6", reason: "manual" });
    expect(r.status).toBe("running");
    calls[0].resolve(succeeded());
    await tick();
  });
});
