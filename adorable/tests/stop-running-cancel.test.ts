// Phase 5 §12.5.3 — running-cancel: stop while `running` → `cancelling` + Redis
// cancel flag; the worker polls the flag, aborts streamText, and finalizes to
// `cancelled` (within the poll window). A partial assistant snapshot survives.
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres + redis).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@/lib/db/schema/runs";
import { handleAgentRun } from "@/lib/agent-run/handle-agent-run";
import { stopRun, type StopDeps } from "@/lib/agent-run/stop";
import { hasCancelFlag } from "@/lib/agent-run/cancel";
import { loadRun, type RunDB } from "@/lib/agent-run/run-state";
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

async function waitForStatus(
  db: RunDB,
  runId: string,
  status: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await loadRun(db, runId);
    if (run?.status === status) return;
    if (Date.now() >= deadline) throw new Error(`run never reached ${status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

d("Phase 5 stop — running-cancel", () => {
  it("running stop → cancelling+flag → worker aborts → cancelled", async () => {
    const graph = await seedProjectGraph(handle.db, "rcancel");
    await seedUserMessage(handle.db, graph.conversationId);
    const runId = await seedRun(handle.db, graph, { status: "queued" });

    const flagClient = redis.client();
    const recorder = makeRecorder();
    const deps = {
      ...makeAgentRunDeps(
        handle.db,
        ctxs.workerCtx.ctx,
        // Long per-step delay so the run is still streaming when stop arrives.
        mockToolCallModel(800),
        recorder,
      ),
      cancelChecker: (id: string) => hasCancelFlag(flagClient, id),
      cancelPollMs: 150,
      onCancelClear: async (id: string) => {
        await flagClient.del(`agent-run:cancel:${id}`);
      },
      releaseReservation: async () => undefined,
    };

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

    // Wait until the worker is running, then issue an explicit stop.
    await waitForStatus(handle.db, runId, "running");
    const run = (await loadRun(handle.db, runId))!;
    const stopDeps: StopDeps = { db: handle.db, redis: redis.client() };
    const outcome = await stopRun(stopDeps, run, {
      activeStreamId: run.activeStreamId ?? undefined,
    });
    expect(outcome).toBe("cancelling"); // running path

    // The worker polls the flag, aborts, finalizes cancelled.
    const result = await handlerPromise;
    expect(result.terminal).toBe("cancelled");

    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("cancelled");
    expect(row.activeStreamId).toBeNull();
    expect(await hasCancelFlag(flagClient, runId)).toBe(false);
  }, 60_000);
});
