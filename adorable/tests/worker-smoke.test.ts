// Phase 1 smoke (спец v2.1 §11.1.5 / §12.4-tick): the queue + worker + reaper
// skeleton actually runs.
//
//   - enqueue → worker picks the job up and the handler sees it;
//   - the reaper runs as a STRICT singleton under a Postgres advisory lock —
//     a second instance can NOT acquire the lock while the first holds it.
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type PgBoss from "pg-boss";
import {
  createBoss,
  enqueueAgentRun,
  type AgentRunJob,
} from "@/lib/agent-run/queue";
import { registerAgentRunWorker } from "@/lib/agent-run/worker";
import {
  reaperTick,
  tryAcquireReaperLock,
  releaseReaperLock,
} from "@/lib/agent-run/reaper";
import { startPostgres, type StartedPostgres } from "./_helpers/containers";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let pg: StartedPostgres;
let boss: PgBoss;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child() {
    return this;
  },
};

beforeAll(async () => {
  pg = await startPostgres();
  boss = await createBoss({
    connectionString: pg.url,
    logger: silentLogger,
  });
}, 180_000);

afterAll(async () => {
  if (boss) await boss.stop({ graceful: false }).catch(() => undefined);
  if (pg) await pg.stop();
}, 60_000);

d("Phase 1 worker-smoke", () => {
  it("enqueue → worker picks up the job", async () => {
    let seen: AgentRunJob | null = null;
    let resolveSeen!: () => void;
    const handled = new Promise<void>((r) => (resolveSeen = r));

    await registerAgentRunWorker(
      boss,
      async (job) => {
        seen = job;
        resolveSeen();
      },
      { logger: silentLogger, workOptions: { pollingIntervalSeconds: 1 } },
    );

    const job: AgentRunJob = {
      runId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      organizationId: "33333333-3333-3333-3333-333333333333",
      projectId: "44444444-4444-4444-4444-444444444444",
      conversationId: "55555555-5555-5555-5555-555555555555",
      modelKey: "mock-main",
    };
    const jobId = await enqueueAgentRun(boss, job);
    expect(jobId).toBeTruthy();

    await Promise.race([
      handled,
      new Promise((_r, rej) =>
        setTimeout(() => rej(new Error("worker never saw job")), 30_000),
      ),
    ]);
    expect(seen).not.toBeNull();
    expect(seen!.runId).toBe(job.runId);
    expect(seen!.projectId).toBe(job.projectId);
  }, 60_000);

  it("reaper advisory lock — second instance does NOT get the lock", async () => {
    // Two independent reaper "instances" = two pinned single-connection sessions.
    const sqlA = postgres(pg.url, { max: 1 });
    const sqlB = postgres(pg.url, { max: 1 });
    try {
      // Instance A acquires the singleton lock.
      expect(await tryAcquireReaperLock(sqlA)).toBe(true);
      // Instance B is locked out while A holds it.
      expect(await tryAcquireReaperLock(sqlB)).toBe(false);

      // A releases → B can now acquire.
      await releaseReaperLock(sqlA);
      expect(await tryAcquireReaperLock(sqlB)).toBe(true);
      await releaseReaperLock(sqlB);
    } finally {
      await sqlA.end({ timeout: 5 });
      await sqlB.end({ timeout: 5 });
    }
  }, 60_000);

  it("reaperTick runs under the lock when free, no-ops when held elsewhere", async () => {
    const sqlTick = postgres(pg.url, { max: 1 });
    const sqlHolder = postgres(pg.url, { max: 1 });
    try {
      // Lock is free → tick runs.
      const ranFree = await reaperTick({ sql: sqlTick, logger: silentLogger });
      expect(ranFree.ran).toBe(true);
      expect(ranFree.swept).toBe(0);

      // Another instance holds the lock → tick is a no-op.
      expect(await tryAcquireReaperLock(sqlHolder)).toBe(true);
      const ranHeld = await reaperTick({ sql: sqlTick, logger: silentLogger });
      expect(ranHeld.ran).toBe(false);
      await releaseReaperLock(sqlHolder);
    } finally {
      await sqlTick.end({ timeout: 5 });
      await sqlHolder.end({ timeout: 5 });
    }
  }, 60_000);
});
