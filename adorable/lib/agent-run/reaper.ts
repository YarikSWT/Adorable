// Reaper — sweeps stuck runs (спец v2.1 §7).
//
// Phase 1 = skeleton: prove the reaper runs as a strict singleton under a
// Postgres session-level advisory lock (a second instance can NOT acquire it),
// and that a tick executes. The full sweep (running-crash draft-commit,
// stuck-cancelling, lost-queued, per-run CAS→reaping) lands in Phase 4.

import { and, eq, lt, sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { runs, type Run, type RunStatus } from "@/lib/db/schema/runs";
import {
  finalizeRunCAS,
  clearActiveStream,
  type RunDB,
} from "./run-state";
import { createLogger, type Logger } from "./logger";

// Stable application-defined key for the singleton reaper advisory lock.
// Arbitrary but fixed so every reaper process contends on the same key. Plain
// number (fits in a safe JS integer; postgres.js sends it to the bigint param)
// to avoid an ES2020 BigInt literal under the app's tsconfig target.
export const REAPER_ADVISORY_LOCK_KEY = 4400100237;

/**
 * Try to acquire the session-level advisory lock for the reaper. Returns true
 * only if THIS session now holds it. A second reaper process (separate session)
 * gets false while the first holds it → strict singleton.
 *
 * The caller MUST use a client with a single, pinned connection (e.g.
 * postgres(url, { max: 1 })) so the lock stays tied to one session.
 */
export async function tryAcquireReaperLock(sql: Sql): Promise<boolean> {
  const rows = await sql<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${REAPER_ADVISORY_LOCK_KEY}) AS locked
  `;
  return rows[0]?.locked === true;
}

/** Release the reaper advisory lock held by this session. */
export async function releaseReaperLock(sql: Sql): Promise<void> {
  await sql`SELECT pg_advisory_unlock(${REAPER_ADVISORY_LOCK_KEY})`;
}

export interface ReaperTickResult {
  /** Whether this process held the lock and actually ran the sweep. */
  ran: boolean;
  /** Number of runs swept this tick (always 0 in the Phase 1 skeleton). */
  swept: number;
}

export interface ReaperTickDeps {
  sql: Sql;
  logger?: Logger;
  /** When provided, the tick runs the full sweep under the advisory lock. */
  sweepDeps?: ReaperSweepDeps;
}

/**
 * Run one reaper tick under the advisory lock. If the lock is already held by
 * another instance, this is a no-op (ran:false). Phase 1 sweeps nothing yet.
 */
export async function reaperTick(deps: ReaperTickDeps): Promise<ReaperTickResult> {
  const log = deps.logger ?? createLogger({ service: "agent-reaper" });
  const got = await tryAcquireReaperLock(deps.sql);
  if (!got) {
    log.info("reaper tick skipped — lock held by another instance");
    return { ran: false, swept: 0 };
  }
  try {
    // Phase 4: the actual sweep runs here when the caller wires sweepDeps.
    let swept = 0;
    if (deps.sweepDeps) {
      const reaped = await sweepStuckRuns(deps.sweepDeps);
      swept = reaped.length;
    }
    log.info("reaper tick ran", { swept });
    return { ran: true, swept };
  } finally {
    await releaseReaperLock(deps.sql);
  }
}

// ──────────────────────────── Phase 4: the sweep ────────────────────────────

export const STALE_MS = 60_000;

/** Minimal sandbox the reaper draft-commits (fake in tests). */
export interface ReaperSandbox {
  /* marker only — the gitCommit dep does the work */
}

export interface ReaperSweepDeps {
  db: RunDB;
  /** Heartbeat staleness threshold (default 60s). */
  staleMs?: number;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
  /** Draft-commit the orphaned work (NOT create a new sandbox). */
  gitCommit?: (args: {
    branch: string;
    message: string;
    runId: string;
    projectId: string;
  }) => Promise<void>;
  /** Attach to an EXISTING sandbox (null = none alive → nothing to commit). */
  attachSandbox?: (projectId: string) => Promise<ReaperSandbox | null>;
  /** Release the quota reservation (idempotent by runId). */
  releaseReservation?: (runId: string) => Promise<void>;
  /** Does the pg-boss job still exist in the queue? (lost-job detection) */
  jobExistsInQueue?: (jobId: string | null) => Promise<boolean>;
  /** Clear the Redis cancel flag (Phase 5). */
  clearCancelFlag?: (runId: string) => Promise<void>;
  logger?: Logger;
}

export interface ReapedRun {
  runId: string;
  from: RunStatus;
  to: RunStatus;
  code: string;
  committed: boolean;
}

/**
 * Sweep ALL non-terminal stuck runs to a terminal status (спец §7), so a stuck
 * run never locks its project forever and crash work is never lost:
 *   A) running + stale heartbeat  → failed   (orphaned crash; draft-commit)
 *   B) cancelling + stale         → cancelled (stuck-cancelling)
 *   C) queued + old + no job      → failed    (lost-job)
 * Each goes through CAS→reaping first, so it never races a live handler-commit.
 */
export async function sweepStuckRuns(
  deps: ReaperSweepDeps,
): Promise<ReapedRun[]> {
  const staleMs = deps.staleMs ?? STALE_MS;
  const now = deps.now?.() ?? new Date();
  const staleAt = new Date(now.getTime() - staleMs);
  const queuedAt = new Date(now.getTime() - staleMs * 3);
  const reaped: ReapedRun[] = [];

  // A) orphaned running (crash) — heartbeat stale.
  const orphans = await deps.db
    .select()
    .from(runs)
    .where(and(eq(runs.status, "running"), lt(runs.heartbeatAt, staleAt)));
  for (const run of orphans) {
    const r = await reapOne(deps, run, "failed", "orphaned", now);
    if (r) reaped.push(r);
  }

  // B) stuck cancelling — heartbeat (or startedAt/createdAt) stale.
  const stuckCancelling = await deps.db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.status, "cancelling"),
        sql`coalesce(${runs.heartbeatAt}, ${runs.startedAt}, ${runs.createdAt}) < ${staleAt.toISOString()}`,
      ),
    );
  for (const run of stuckCancelling) {
    const r = await reapOne(deps, run, "cancelled", "stuck-cancelling", now);
    if (r) reaped.push(r);
  }

  // C) lost queued — old and its pg-boss job is gone.
  const stuckQueued = await deps.db
    .select()
    .from(runs)
    .where(and(eq(runs.status, "queued"), lt(runs.createdAt, queuedAt)));
  for (const run of stuckQueued) {
    const exists = deps.jobExistsInQueue
      ? await deps.jobExistsInQueue(run.jobId)
      : false;
    if (!exists) {
      const r = await reapOne(deps, run, "failed", "lost-job", now);
      if (r) reaped.push(r);
    }
  }

  return reaped;
}

/**
 * Reap one run. CAS its current status → `reaping` FIRST (exclusive claim on the
 * git ops); if that fails a live handler/another reaper owns it → no-op (no
 * double commit, no status flip). Then draft-commit (failed crash only),
 * finalize to `terminal`, release reservation, clear stream.
 */
export async function reapOne(
  deps: ReaperSweepDeps,
  run: Run,
  terminal: "failed" | "cancelled",
  code: string,
  now: Date = new Date(),
): Promise<ReapedRun | null> {
  const log = deps.logger ?? createLogger({ service: "agent-reaper" });

  // CAS claim: only if still in the status we saw (handler/other reaper races).
  const claimed = await finalizeRunCAS(deps.db, run.id, {
    expectStatusIn: [run.status],
    status: "reaping",
  });
  if (!claimed) return null; // someone got there first — no-op.

  let committed = false;
  if (terminal === "failed" && deps.attachSandbox && deps.gitCommit) {
    try {
      const vm = await deps.attachSandbox(run.projectId);
      if (vm) {
        await deps.gitCommit({
          branch: `draft/run-${run.id.slice(0, 8)}`,
          message: `${code}: run ${run.id.slice(0, 8)}`,
          runId: run.id,
          projectId: run.projectId,
        });
        committed = true;
      }
    } catch (e) {
      log.warn("reaper draft-commit failed", {
        runId: run.id,
        err: String(e),
      });
    }
  }

  // reaping → terminal: we own the run, always passes.
  await finalizeRunCAS(deps.db, run.id, {
    expectStatusIn: ["reaping"],
    status: terminal,
    finishedAt: now,
    ...(terminal === "failed"
      ? { errorCode: code, errorMessage: `Reaped: ${code}` }
      : {}),
  });

  if (deps.releaseReservation) {
    await deps.releaseReservation(run.id).catch(() => undefined);
  }
  await clearActiveStream(deps.db, run.id);
  if (deps.clearCancelFlag) {
    await deps.clearCancelFlag(run.id).catch(() => undefined);
  }

  return { runId: run.id, from: run.status, to: terminal, code, committed };
}
