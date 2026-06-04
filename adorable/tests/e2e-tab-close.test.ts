// Phase 3 §12.7 — the headline invariant: "closed the tab — didn't lose it".
// POST → connect to the stream → DISCONNECT mid-flight (tab close / navigation)
// → the worker still completes (disconnect ≠ stop) → reload → transcript intact
// with tool-parts, code committed to main, usage recorded; resume-GET → 204.
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres + redis).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@/lib/db/schema/runs";
import { messages } from "@/lib/db/schema/messages";
import { handleAgentRun } from "@/lib/agent-run/handle-agent-run";
import {
  bridgeFirstStream,
  resumeRunStream,
} from "@/lib/agent-run/stream";
import { loadConversationUIMessages } from "@/lib/db/queries/transcript";
import {
  startPostgres,
  startRedis,
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

d("Phase 3 e2e — close tab, don't lose the run", () => {
  it("disconnect mid-stream → worker completes; transcript+code+usage persisted", async () => {
    const graph = await seedProjectGraph(handle.db, "tab");
    await seedUserMessage(handle.db, graph.conversationId);
    const runId = await seedRun(handle.db, graph);
    const recorder = makeRecorder();
    const deps = makeAgentRunDeps(
      handle.db,
      ctxs.workerCtx.ctx,
      mockToolCallModel(80),
      recorder,
    );

    const handlerPromise = handleAgentRun(
      {
        runId,
        userId: graph.userId,
        organizationId: graph.organizationId,
        projectId: graph.projectId,
        conversationId: graph.conversationId,
        modelKey: "mock-main",
      },
      deps,
    );

    // 1. Connect to the bridge stream, read a chunk.
    const stream = await bridgeFirstStream(ctxs.bridgeCtx.ctx, handle.db, runId, {
      timeoutMs: 20_000,
    });
    expect(stream).toBeTruthy();
    const reader = stream!.getReader();
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);

    // 2. DISCONNECT mid-flight (tab close). This must NOT cancel the run.
    await reader.cancel();

    // 3. Wait for the worker to finish on its own.
    const outcome = await handlerPromise;
    expect(outcome.terminal).toBe("completed"); // disconnect ≠ stop

    // 4. Reload: transcript intact with tool-parts.
    const transcript = await loadConversationUIMessages(handle.db, graph.conversationId);
    const assistant = transcript.find((m) => m.role === "assistant")!;
    expect(assistant).toBeTruthy();
    expect(
      assistant.parts.some((p) =>
        String((p as { type?: string }).type).startsWith("tool-"),
      ),
    ).toBe(true);

    // 5. Run finalized; exactly one assistant row; code in main; usage recorded.
    const [runRow] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(runRow.status).toBe("completed");
    expect(runRow.activeStreamId).toBeNull();
    const rows = await handle.db.select().from(messages).where(eq(messages.runId, runId));
    expect(rows).toHaveLength(1);
    expect(recorder.commits[0]?.branch).toBe("main");
    expect(recorder.usages).toHaveLength(1);

    // 6. resume-GET → 204 (no active stream; front loads from Postgres).
    const resume = await resumeRunStream(
      ctxs.bridgeCtx.ctx,
      handle.db,
      graph.conversationId,
    );
    expect(resume.kind).toBe("204");
  }, 60_000);
});
