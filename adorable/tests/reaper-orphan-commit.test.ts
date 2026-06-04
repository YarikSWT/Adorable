// Phase 4 §12.4.3 — reaper commits an orphaned sandbox. A run left `running`
// with a stale heartbeat + a live sandbox (worker crashed) is reaped: CAS→reaping,
// draft-commit the work, → failed, release reservation, clear stream. The work
// lands on a draft branch (not lost).
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@/lib/db/schema/runs";
import { sweepStuckRuns } from "@/lib/agent-run/reaper";
import {
  startPostgres,
  type StartedPostgres,
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
let handle: TestDbHandle;

beforeAll(async () => {
  pg = await startPostgres();
  handle = await connectAndMigrate(pg.url);
}, 180_000);

afterAll(async () => {
  if (handle) await handle.end();
  if (pg) await pg.stop();
}, 60_000);

d("Phase 4 reaper — orphaned running run", () => {
  it("draft-commits the work, → failed, releases reservation, clears stream", async () => {
    const graph = await seedProjectGraph(handle.db, "orphan");
    const staleHeartbeat = new Date(Date.now() - 5 * 60_000); // 5 min ago
    const runId = await seedRun(handle.db, graph, {
      status: "running",
      activeStreamId: "stream-orphan",
      startedAt: staleHeartbeat,
      heartbeatAt: staleHeartbeat,
    });

    const commits: Array<{ branch: string; runId: string }> = [];
    const released: string[] = [];

    const reaped = await sweepStuckRuns({
      db: handle.db,
      staleMs: 60_000,
      attachSandbox: async () => ({}), // a live sandbox is attached
      gitCommit: async ({ branch, runId }) => {
        commits.push({ branch, runId });
      },
      releaseReservation: async (id) => {
        released.push(id);
      },
    });

    expect(reaped).toHaveLength(1);
    expect(reaped[0].to).toBe("failed");
    expect(reaped[0].committed).toBe(true);

    // Draft-commit on a draft branch.
    expect(commits).toHaveLength(1);
    expect(commits[0].branch).toMatch(/^draft\/run-/);
    expect(commits[0].runId).toBe(runId);

    // Reservation released, stream cleared, status terminal.
    expect(released).toEqual([runId]);
    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("failed");
    expect(row.activeStreamId).toBeNull();
    expect(row.errorCode).toBe("orphaned");
  }, 60_000);

  it("does NOT commit when no live sandbox is attachable", async () => {
    const graph = await seedProjectGraph(handle.db, "orphan2");
    const stale = new Date(Date.now() - 5 * 60_000);
    const runId = await seedRun(handle.db, graph, {
      status: "running",
      startedAt: stale,
      heartbeatAt: stale,
    });
    const commits: string[] = [];
    const reaped = await sweepStuckRuns({
      db: handle.db,
      attachSandbox: async () => null, // sandbox gone
      gitCommit: async () => {
        commits.push("x");
      },
    });
    expect(reaped.find((r) => r.runId === runId)?.to).toBe("failed");
    expect(commits).toHaveLength(0); // nothing to commit, still finalized
    const [row] = await handle.db.select().from(runs).where(eq(runs.id, runId));
    expect(row.status).toBe("failed");
  }, 60_000);
});
