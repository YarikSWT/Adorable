// Тесты для in-memory BuildQueue (CONTRACTS §7, BUILD_PIPELINE §3).
//
// Используют deferred runJob — тестам нужен полный контроль над тем,
// когда running job завершается, чтобы протестировать переходы.

import { describe, expect, it } from "vitest";

import {
  createInMemoryBuildQueue,
  type RunJobInput,
} from "@/lib/preview/build-queue";
import type {
  BuildEvent,
  BuildJobStatus,
  BuildResult,
} from "@/lib/adapters/preview";

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

interface Deferred {
  promise: Promise<BuildResult>;
  resolve: (r: BuildResult) => void;
  signal: AbortSignal;
  jobId: string;
}

const makeDeferredRunJob = () => {
  const calls: Deferred[] = [];
  const runJob = (input: RunJobInput): Promise<BuildResult> => {
    let resolve!: (r: BuildResult) => void;
    const promise = new Promise<BuildResult>((r) => {
      resolve = r;
    });
    calls.push({
      promise,
      resolve,
      signal: input.signal,
      jobId: input.job.jobId,
    });
    return promise;
  };
  return { runJob, calls };
};

const collectEvents = (
  q: ReturnType<typeof createInMemoryBuildQueue>,
  projectId: string,
): { events: BuildEvent[]; unsubscribe: () => void } => {
  const events: BuildEvent[] = [];
  const unsubscribe = q.subscribe(projectId, (e) => events.push(e));
  return { events, unsubscribe };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("BuildQueue — empty → running", () => {
  it("enqueue on empty queue starts the job immediately and emits running", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const { events } = collectEvents(q, "p1");

    const res = await q.enqueue({ projectId: "p1", reason: "manual" });
    expect(res.status).toBe<BuildJobStatus>("running");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("running");
    expect(q.getActive("p1")?.jobId).toBe(res.jobId);
    expect(q.getQueued("p1")).toBeNull();

    // Cleanup
    calls[0].resolve(succeeded());
    await tick();
  });
});

describe("BuildQueue — running → cancel + queued", () => {
  it("enqueue while running cancels the running job and queues the new one", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const { events } = collectEvents(q, "p2");

    const a = await q.enqueue({ projectId: "p2", reason: "initial" });
    const b = await q.enqueue({ projectId: "p2", reason: "manual" });

    expect(a.status).toBe("running");
    expect(b.status).toBe("queued");
    expect(calls[0].signal.aborted).toBe(true);
    expect(q.getActive("p2")?.jobId).toBe(a.jobId);
    expect(q.getQueued("p2")?.jobId).toBe(b.jobId);

    // running's signal aborted → finishing it transitions to cancelled
    // (queue overrides status because signal.aborted) and promotes b.
    calls[0].resolve(succeeded()); // race: queue should override → cancelled.
    await tick();
    await tick();

    const cancelEvent = events.find(
      (e) => e.jobId === a.jobId && e.status === "cancelled",
    );
    expect(cancelEvent).toBeDefined();

    // b should now be running.
    const runningEvent = events.find(
      (e) => e.jobId === b.jobId && e.status === "running",
    );
    expect(runningEvent).toBeDefined();
    expect(q.getActive("p2")?.jobId).toBe(b.jobId);

    // Finish b cleanly.
    calls[1].resolve(succeeded());
    await tick();
  });
});

describe("BuildQueue — running + queued → superseded", () => {
  it("third enqueue emits superseded for the old queued job", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const { events } = collectEvents(q, "p3");

    const a = await q.enqueue({ projectId: "p3", reason: "initial" });
    const b = await q.enqueue({ projectId: "p3", reason: "manual" });
    const c = await q.enqueue({ projectId: "p3", reason: "manual" });

    expect(a.status).toBe("running");
    expect(b.status).toBe("queued");
    expect(c.status).toBe("queued");
    expect(q.getQueued("p3")?.jobId).toBe(c.jobId);

    const supersededEvent = events.find(
      (e) => e.jobId === b.jobId && e.status === "superseded",
    );
    expect(supersededEvent).toBeDefined();

    // Cleanup
    calls[0].resolve(succeeded());
    await tick();
    await tick();
    calls[1].resolve(succeeded());
    await tick();
  });
});

describe("BuildQueue — promotion after completion", () => {
  it("queued job becomes running after current finishes", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const { events } = collectEvents(q, "p4");

    const a = await q.enqueue({ projectId: "p4", reason: "initial" });
    const b = await q.enqueue({ projectId: "p4", reason: "manual" });
    expect(b.status).toBe("queued");

    // a.signal aborted; resolve — queue transitions a → cancelled, promotes b.
    calls[0].resolve(succeeded());
    await tick();
    await tick();

    expect(q.getActive("p4")?.jobId).toBe(b.jobId);
    expect(q.getQueued("p4")).toBeNull();
    expect(events.find((e) => e.status === "running" && e.jobId === b.jobId))
      .toBeDefined();

    calls[1].resolve(succeeded());
    await tick();
  });

  it("getActive returns null after a single job finishes naturally", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const a = await q.enqueue({ projectId: "p5", reason: "initial" });
    expect(a.status).toBe("running");

    calls[0].resolve(succeeded());
    await tick();
    expect(q.getActive("p5")).toBeNull();
  });
});

describe("BuildQueue — cancel(projectId)", () => {
  it("cancels both running and queued, emits superseded for queued", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const { events } = collectEvents(q, "p6");

    const a = await q.enqueue({ projectId: "p6", reason: "initial" });
    const b = await q.enqueue({ projectId: "p6", reason: "manual" });

    await q.cancel("p6");
    expect(calls[0].signal.aborted).toBe(true);
    expect(q.getQueued("p6")).toBeNull();

    const supersededB = events.find(
      (e) => e.jobId === b.jobId && e.status === "superseded",
    );
    expect(supersededB).toBeDefined();

    // Resolve a's runJob — queue transitions to cancelled, no promotion.
    calls[0].resolve(succeeded());
    await tick();
    expect(q.getActive("p6")).toBeNull();
    expect(events.find((e) => e.jobId === a.jobId && e.status === "cancelled"))
      .toBeDefined();
  });

  it("is a noop for unknown projectId", async () => {
    const { runJob } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    await q.cancel("never-existed");
  });
});

describe("BuildQueue — subscribe / unsubscribe", () => {
  it("multiple subscribers all receive events", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const events1: BuildEvent[] = [];
    const events2: BuildEvent[] = [];
    q.subscribe("p7", (e) => events1.push(e));
    q.subscribe("p7", (e) => events2.push(e));

    await q.enqueue({ projectId: "p7", reason: "initial" });
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);

    calls[0].resolve(succeeded());
    await tick();
  });

  it("unsubscribe stops further events for that listener", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const events: BuildEvent[] = [];
    const unsub = q.subscribe("p8", (e) => events.push(e));

    await q.enqueue({ projectId: "p8", reason: "initial" });
    expect(events).toHaveLength(1);
    unsub();

    calls[0].resolve(succeeded());
    await tick();
    expect(events).toHaveLength(1); // no new events
  });

  it("listener throws don't break the queue", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    q.subscribe("p9", () => {
      throw new Error("boom");
    });
    await q.enqueue({ projectId: "p9", reason: "initial" });
    calls[0].resolve(succeeded());
    await tick();
    // No throw at the test boundary.
    expect(q.getActive("p9")).toBeNull();
  });
});

describe("BuildQueue — final result is in the event", () => {
  it("succeeded event carries BuildResult", async () => {
    const { runJob, calls } = makeDeferredRunJob();
    const q = createInMemoryBuildQueue({ runJob });
    const { events } = collectEvents(q, "p10");
    await q.enqueue({ projectId: "p10", reason: "initial" });

    const r = succeeded();
    calls[0].resolve(r);
    await tick();
    const final = events.find((e) => e.status === "succeeded");
    expect(final?.result).toEqual(r);
  });
});

describe("BuildQueue — runJob throws", () => {
  it("turns into failed event with parsable error", async () => {
    let resolveDeferred!: (r: BuildResult) => void;
    let rejectDeferred!: (err: Error) => void;
    const runJob = (): Promise<BuildResult> =>
      new Promise<BuildResult>((res, rej) => {
        resolveDeferred = res;
        rejectDeferred = rej;
      });
    const q = createInMemoryBuildQueue({ runJob });
    const { events } = collectEvents(q, "p11");
    await q.enqueue({ projectId: "p11", reason: "initial" });

    rejectDeferred(new Error("crash"));
    await tick();
    const final = events.find((e) => e.status === "failed");
    expect(final).toBeDefined();
    expect(final?.result?.errors[0].message).toMatch(/runJob threw.*crash/);
    void resolveDeferred; // appease TS
  });
});
