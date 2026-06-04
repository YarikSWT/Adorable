// Phase 3 §12.3 — server-side bridge + resumable stream.
//   (a) first chunk comes from the POST bridge BEFORE the run completes;
//   (c) reconnect via GET returns the remainder; 204+Retry-After in the
//       activeStreamId=null window;
//   (d) multiple subscribers each get the full stream;
//   (e) completed run → messages from Postgres; resume-GET → 204.
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres + redis).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleAgentRun } from "@/lib/agent-run/handle-agent-run";
import {
  bridgeFirstStream,
  resumeRunStream,
  waitForActiveStream,
  createStreamContext,
} from "@/lib/agent-run/stream";
import { loadConversationUIMessages } from "@/lib/db/queries/transcript";
import {
  startPostgres,
  startRedis,
  parseSseChunks,
  type StartedPostgres,
  type StartedRedis,
} from "./_helpers/containers";
import {
  connectAndMigrate,
  seedProjectGraph,
  seedRun,
  seedUserMessage,
  type TestDbHandle,
} from "./_helpers/db";
import {
  makeAgentRunDeps,
  makeContexts,
  makeRecorder,
  mockToolCallModel,
} from "./_helpers/agent-run";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let pg: StartedPostgres;
let redis: StartedRedis;
let handle: TestDbHandle;
let ctxs: ReturnType<typeof makeContexts>;

beforeAll(async () => {
  [pg, redis] = await Promise.all([startPostgres(), startRedis()]);
  handle = await connectAndMigrate(pg.url);
  ctxs = makeContexts(redis.url);
}, 180_000);

afterAll(async () => {
  if (ctxs) await ctxs.close();
  if (handle) await handle.end();
  await Promise.all([pg?.stop(), redis?.stop()]);
}, 60_000);

async function startRun(suffix: string, stepDelayMs = 80) {
  const graph = await seedProjectGraph(handle.db, suffix);
  await seedUserMessage(handle.db, graph.conversationId);
  const runId = await seedRun(handle.db, graph);
  const recorder = makeRecorder();
  const deps = makeAgentRunDeps(
    handle.db,
    ctxs.workerCtx.ctx,
    mockToolCallModel(stepDelayMs),
    recorder,
  );
  let done = false;
  const promise = handleAgentRun(
    {
      runId,
      userId: graph.userId,
      organizationId: graph.organizationId,
      projectId: graph.projectId,
      conversationId: graph.conversationId,
      modelKey: "mock-main",
    },
    deps,
  ).then((r) => {
    done = true;
    return r;
  });
  return { graph, runId, recorder, promise, isDone: () => done };
}

d("Phase 3 bridge + resumable stream", () => {
  it("(a) bridge yields a first chunk before the run completes; (d) two subscribers get the full stream", async () => {
    const run = await startRun("a", 90);

    // (a) bridge attaches and reads the first chunk while the run is in-flight.
    const s1 = await bridgeFirstStream(ctxs.bridgeCtx.ctx, handle.db, run.runId, {
      timeoutMs: 20_000,
    });
    expect(s1).toBeTruthy();
    const r1 = s1!.getReader();
    const first = await r1.read();
    expect(first.done).toBe(false);
    expect(first.value).toContain("data:"); // a live SSE chunk
    expect(run.isDone()).toBe(false); // run still streaming

    // (d) a second subscriber attaches (still live) and gets the WHOLE stream.
    const streamId = await waitForActiveStream(handle.db, run.runId);
    const extra = createStreamContext(redis.url);
    try {
      const s2 = await extra.ctx.resumeExistingStream(streamId!);
      expect(s2).toBeTruthy();

      // drain both fully.
      let raw1 = first.value ?? "";
      for (;;) {
        const { done, value } = await r1.read();
        if (done) break;
        if (value) raw1 += value;
      }
      let raw2 = "";
      const r2 = (s2 as ReadableStream<string>).getReader();
      for (;;) {
        const { done, value } = await r2.read();
        if (done) break;
        if (value) raw2 += value;
      }

      await run.promise;

      for (const raw of [raw1, raw2]) {
        const parts = parseSseChunks(raw);
        const types = parts.map((p) => p["type"]);
        expect(types).toContain("finish");
        expect(types.some((t) => String(t).startsWith("tool-"))).toBe(true);
      }
    } finally {
      await extra.close();
    }
  }, 60_000);

  it("(c) reconnect via GET resumes the remainder; 204+Retry-After in the activeStreamId=null window", async () => {
    // 204 + Retry-After window: queued run, no active stream yet.
    const g0 = await seedProjectGraph(handle.db, "c0");
    await seedUserMessage(handle.db, g0.conversationId);
    await seedRun(handle.db, g0, { status: "queued" });
    const windowRes = await resumeRunStream(
      ctxs.bridgeCtx.ctx,
      handle.db,
      g0.conversationId,
    );
    expect(windowRes.kind).toBe("204");
    if (windowRes.kind === "204") expect(windowRes.retryAfter).toBe(1);

    // Live reconnect: start a run, attach + read a bit, "disconnect", then GET-resume.
    const run = await startRun("c", 90);
    const s1 = await bridgeFirstStream(ctxs.bridgeCtx.ctx, handle.db, run.runId, {
      timeoutMs: 20_000,
    });
    const r1 = s1!.getReader();
    await r1.read(); // partial
    await r1.cancel(); // disconnect (navigation/tab close)

    const resume = await resumeRunStream(
      ctxs.bridgeCtx.ctx,
      handle.db,
      run.graph.conversationId,
    );
    // Either still streaming (kind 'stream') or it finished between read+resume.
    if (resume.kind === "stream") {
      let raw = "";
      const rr = resume.stream.getReader();
      for (;;) {
        const { done, value } = await rr.read();
        if (done) break;
        if (value) raw += value;
      }
      const types = parseSseChunks(raw).map((p) => p["type"]);
      expect(types).toContain("finish"); // remainder included the finish
    }
    await run.promise;

    // After completion: resume-GET → 204 (load from Postgres).
    const after = await resumeRunStream(
      ctxs.bridgeCtx.ctx,
      handle.db,
      run.graph.conversationId,
    );
    expect(after.kind).toBe("204");
  }, 60_000);

  it("(e) completed run → transcript from Postgres; resume-GET → 204", async () => {
    const run = await startRun("e", 10);
    const outcome = await run.promise;
    expect(outcome.terminal).toBe("completed");

    const transcript = await loadConversationUIMessages(
      handle.db,
      run.graph.conversationId,
    );
    const assistant = transcript.find((m) => m.role === "assistant")!;
    expect(assistant).toBeTruthy();
    expect(
      assistant.parts.some((p) =>
        String((p as { type?: string }).type).startsWith("tool-"),
      ),
    ).toBe(true);

    const resume = await resumeRunStream(
      ctxs.bridgeCtx.ctx,
      handle.db,
      run.graph.conversationId,
    );
    expect(resume.kind).toBe("204"); // no active stream — front loads history
  }, 60_000);
});
