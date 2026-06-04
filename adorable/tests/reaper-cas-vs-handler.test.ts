// Phase 4 §12.5.4-6 — reaper CAS vs live handler + the other stuck statuses:
//   (c) a live handler that finalized first → reaper CAS→reaping fails → no-op
//       (one git-commit, no status flip);
//   (d) stuck `cancelling` (stale heartbeat) → cancelled, project freed;
//   (e) lost `queued` (job gone from the queue) → failed.
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@/lib/db/schema/runs";
import { projects } from "@/lib/db/schema/projects";
import { sweepStuckRuns, reapOne } from "@/lib/agent-run/reaper";
import { finalizeRunCAS, loadRun } from "@/lib/agent-run/run-state";
import { startPostgres, type StartedPostgres } from "./_helpers/containers";
import {
  connectAndMigrate,
  seedProjectGraph,
  seedRun,
  type TestDbHandle,
} from "./_helpers/db";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let pg: StartedPostgres;
let handle: TestDbHandle;

beforeAll(async () => {
  pg = await startPostgres();
  handle = await connectAndMigrate(pg.url);
}, 180_000);

afterAll(async () => {
  if (handle) await handle.end();
  if (pg) await pg.stop();
}, 60_000);

d("Phase 4 reaper — CAS race + stuck statuses", () => {
  it("(c) reaper CAS fails when the handler already finalized — no double commit, no flip", async () => {
    const graph = await seedProjectGraph(handle.db, "cas");
    const stale = new Date(Date.now() - 5 * 60_000);
    const runId = await seedRun(handle.db, graph, {
      status: "running",
      startedAt: stale,
      heartbeatAt: stale,
    });
    const staleRun = (await loadRun(handle.db, runId))!;

    // The live handler wins the race: finalizes running → completed (one commit).
    const handlerWon = await finalizeRunCAS(handle.db, runId, {
      expectStatusIn: ["running"],
      status: "completed",
      finishedAt: new Date(),
    });
    expect(handlerWon).toBe(true);

    // Reaper now tries to claim the (stale) snapshot it had read.
    const commits: string[] = [];
    const result = await reapOne(
      {
        db: handle.db,
        attachSandbox: async () => ({}),
        gitCommit: async () => {
          commits.push("reaper-commit");
        },
      },
      staleRun,
      "failed",
      "orphaned",
    );

    expect(result).toBeNull(); // CAS→reaping failed → no-op
    expect(commits).toHaveLength(0); // no second commit
    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("completed"); // no flip completed→failed
  }, 60_000);

  it("(d) stuck cancelling → cancelled, project freed", async () => {
    const graph = await seedProjectGraph(handle.db, "cancelling");
    const stale = new Date(Date.now() - 5 * 60_000);
    const runId = await seedRun(handle.db, graph, {
      status: "cancelling",
      startedAt: stale,
      heartbeatAt: stale,
    });
    // Mark the project as occupied by this run.
    await handle.db
      .update(projects)
      .set({ currentRunId: runId })
      .where(eq(projects.id, graph.projectId));

    const reaped = await sweepStuckRuns({ db: handle.db, staleMs: 60_000 });
    expect(reaped.find((r) => r.runId === runId)?.to).toBe("cancelled");

    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("cancelled");
    // Project no longer locked (currentRunId cleared).
    const [proj] = await handle.db
      .select()
      .from(projects)
      .where(eq(projects.id, graph.projectId));
    expect(proj.currentRunId).toBeNull();
  }, 60_000);

  it("(e) lost queued (job gone) → failed", async () => {
    const graph = await seedProjectGraph(handle.db, "lost");
    const old = new Date(Date.now() - 10 * 60_000); // older than 3×stale
    const runId = await seedRun(handle.db, graph, {
      status: "queued",
      jobId: "missing-job",
      createdAt: old,
    });

    const reaped = await sweepStuckRuns({
      db: handle.db,
      staleMs: 60_000,
      jobExistsInQueue: async () => false, // job is gone
    });
    expect(reaped.find((r) => r.runId === runId)?.to).toBe("failed");

    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("lost-job");
  }, 60_000);

  it("(e') queued whose job still exists is left alone", async () => {
    const graph = await seedProjectGraph(handle.db, "alive");
    const old = new Date(Date.now() - 10 * 60_000);
    const runId = await seedRun(handle.db, graph, {
      status: "queued",
      jobId: "live-job",
      createdAt: old,
    });
    const reaped = await sweepStuckRuns({
      db: handle.db,
      jobExistsInQueue: async () => true, // job still queued
    });
    expect(reaped.find((r) => r.runId === runId)).toBeUndefined();
    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("queued"); // untouched
  }, 60_000);
});
