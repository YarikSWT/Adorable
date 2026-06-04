// Phase 3 §12.4.1 — worker happy path. enqueue→completed; the persisted
// assistant UIMessage carries TOOL-PARTS (not flat text); code committed to
// main; exactly one assistant row per run; result.usage resolves (regression).
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine + redis:7-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@/lib/db/schema/runs";
import { messages } from "@/lib/db/schema/messages";
import {
  handleAgentRun,
  type AgentRunDeps,
} from "@/lib/agent-run/handle-agent-run";
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
  type SeededGraph,
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

d("Phase 3 worker happy path", () => {
  it("completes; assistant message has tool-parts, code in main, one row, usage resolves", async () => {
    const graph: SeededGraph = await seedProjectGraph(handle.db);
    await seedUserMessage(handle.db, graph.conversationId);
    const runId = await seedRun(handle.db, graph);
    const recorder = makeRecorder();
    const deps: AgentRunDeps = makeAgentRunDeps(
      handle.db,
      ctxs.workerCtx.ctx,
      mockToolCallModel(20),
      recorder,
    );

    const outcome = await handleAgentRun(
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

    // (b) result.usage RESOLVED (did not hang — v2.0 regression). Reaching
    // "completed" requires the handler's `await result.usage` to return; the
    // value is then recorded. (Mock token counts don't propagate through the
    // SDK in v6, so we assert resolution + recording, not magnitude.)
    expect(outcome.terminal).toBe("completed");
    expect(outcome.usage).toBeDefined();
    expect(recorder.usages).toHaveLength(1);

    // run row finalized completed with tokenUsage + stepCount.
    const [runRow] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(runRow.status).toBe("completed");
    expect(runRow.activeStreamId).toBeNull();
    expect(runRow.tokenUsage).toBeTruthy();
    expect(runRow.stepCount).toBeGreaterThanOrEqual(1);

    // (f) persisted assistant UIMessage carries a tool-part (structured, not flat).
    const transcript = await loadConversationUIMessages(handle.db, graph.conversationId);
    const assistant = transcript.find((m) => m.role === "assistant")!;
    expect(assistant).toBeTruthy();
    const toolPart = assistant.parts.find((p) =>
      String((p as { type?: string }).type).startsWith("tool-"),
    );
    expect(toolPart).toBeTruthy();

    // (f) code committed to main on completed.
    expect(recorder.commits).toHaveLength(1);
    expect(recorder.commits[0].branch).toBe("main");

    // (g) exactly one assistant row for this run (uniq index).
    const rows = await handle.db.select().from(messages).where(eq(messages.runId, runId));
    expect(rows).toHaveLength(1);
  }, 60_000);
});
