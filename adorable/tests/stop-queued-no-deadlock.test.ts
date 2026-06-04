// Phase 5 §12.5.1+7 — queued-cancel must NOT lock the project (deadlock
// regression): stop while `queued` → boss.cancel + CAS straight to `cancelled`
// (not stuck in `cancelling`), reservation returned, project freed so a new run
// can start (re-enqueue).
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres + redis).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@/lib/db/schema/runs";
import { stopRun, type StopDeps } from "@/lib/agent-run/stop";
import { hasCancelFlag } from "@/lib/agent-run/cancel";
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
  type TestDbHandle,
} from "./_helpers/db";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let pg: StartedPostgres;
let redis: StartedRedis;
let handle: TestDbHandle;

beforeAll(async () => {
  [pg, redis] = await Promise.all([startPostgres(), startRedis()]);
  handle = await connectAndMigrate(pg.url);
}, 180_000);

afterAll(async () => {
  if (handle) await handle.end();
  await Promise.all([pg?.stop(), redis?.stop()]);
}, 60_000);

d("Phase 5 stop — queued-cancel, no deadlock", () => {
  it("queued stop → cancelled (not cancelling); reservation returned; project freed; re-enqueue works", async () => {
    const graph = await seedProjectGraph(handle.db, "qstop");
    const runId = await seedRun(handle.db, graph, {
      status: "queued",
      jobId: "job-q",
      activeStreamId: null,
    });

    // While queued the project is locked — a second active run can't be inserted.
    let lockedThrew = false;
    try {
      await seedRun(handle.db, graph, { status: "queued" });
    } catch {
      lockedThrew = true;
    }
    expect(lockedThrew).toBe(true); // one_active_run_per_project held

    const released: string[] = [];
    const cancelledJobs: string[] = [];
    const deps: StopDeps = {
      db: handle.db,
      redis: redis.client(),
      boss: {
        cancel: async (jobId) => {
          cancelledJobs.push(jobId);
        },
      },
      releaseReservation: async (id) => {
        released.push(id);
      },
    };

    const run = (await loadRun(handle.db, runId))!;
    const outcome = await stopRun(deps, run, {});
    expect(outcome).toBe("cancelled"); // NOT "cancelling"

    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("cancelled");
    expect(cancelledJobs).toEqual(["job-q"]); // job removed from queue
    expect(released).toEqual([runId]); // reservation returned
    expect(await hasCancelFlag(deps.redis, runId)).toBe(false); // flag cleared

    // (d) project is now free → a new run inserts (re-enqueue).
    const newRunId = await seedRun(handle.db, graph, { status: "queued" });
    expect(newRunId).toBeTruthy();
  }, 60_000);
});
