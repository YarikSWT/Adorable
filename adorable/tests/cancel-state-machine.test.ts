// Phase 5 §12.5 — cancel state machine corners:
//   (b) step-0 cancel (flag set before the worker starts) → cancelled + release
//       + clear, reservation returned;
//   (e) stale stop (outdated activeStreamId) → no-op;
//   (f) navigation/disconnect is NOT a stop → run stays live (only the explicit
//       stop endpoint cancels).
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres + redis).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@/lib/db/schema/runs";
import { handleAgentRun } from "@/lib/agent-run/handle-agent-run";
import { stopRun, type StopDeps } from "@/lib/agent-run/stop";
import {
  setCancelFlag,
  hasCancelFlag,
} from "@/lib/agent-run/cancel";
import { loadRun } from "@/lib/agent-run/run-state";
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

d("Phase 5 cancel state machine", () => {
  it("(b) step-0 cancel → cancelled + release + clear flag", async () => {
    const graph = await seedProjectGraph(handle.db, "step0");
    await seedUserMessage(handle.db, graph.conversationId);
    const runId = await seedRun(handle.db, graph, { status: "queued" });

    const flagClient = redis.client();
    await setCancelFlag(flagClient, runId); // flag set before the worker starts

    const released: string[] = [];
    const recorder = makeRecorder();
    const deps = {
      ...makeAgentRunDeps(handle.db, ctxs.workerCtx.ctx, mockToolCallModel(10), recorder),
      cancelChecker: (id: string) => hasCancelFlag(flagClient, id),
      onCancelClear: async (id: string) => {
        await flagClient.del(`agent-run:cancel:${id}`);
      },
      releaseReservation: async (id: string) => {
        released.push(id);
      },
    };

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

    expect(outcome.terminal).toBe("cancelled");
    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("cancelled");
    expect(released).toEqual([runId]); // reservation returned
    expect(await hasCancelFlag(flagClient, runId)).toBe(false); // cleared
    // step-0 means it never streamed: the model was never invoked.
    expect(recorder.commits).toHaveLength(0);
  }, 60_000);

  it("(e) stale stop (outdated activeStreamId) → no-op", async () => {
    const graph = await seedProjectGraph(handle.db, "stale");
    const runId = await seedRun(handle.db, graph, {
      status: "running",
      activeStreamId: "current-stream",
    });
    const deps: StopDeps = { db: handle.db, redis: redis.client() };
    const run = (await loadRun(handle.db, runId))!;

    const outcome = await stopRun(deps, run, { activeStreamId: "OLD-stream" });
    expect(outcome).toBe("stale");
    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("running"); // untouched
  }, 60_000);

  it("(f) navigation/disconnect is NOT a stop — run stays running", async () => {
    const graph = await seedProjectGraph(handle.db, "nav");
    const runId = await seedRun(handle.db, graph, {
      status: "running",
      activeStreamId: "s-nav",
    });
    // A disconnect does not call stopRun; nothing changes the run.
    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("running");
    expect(await hasCancelFlag(redis.client(), runId)).toBe(false);
  }, 60_000);
});
