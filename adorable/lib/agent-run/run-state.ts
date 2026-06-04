// Run lifecycle state transitions (спец v2.1 §5.2 / §7.1).
//
// All transitions go through CAS (compare-and-set on status) so handler and
// reaper never flip a terminal status. projects.currentRunId is maintained with
// explicit UPDATEs (queued→running sets it; a terminal status clears it),
// keeping the "one active run per project" invariant visible in code.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import {
  runs,
  type Run,
  type RunStatus,
  ACTIVE_RUN_STATUSES,
} from "@/lib/db/schema/runs";
import { projects } from "@/lib/db/schema/projects";

export type RunDB = PostgresJsDatabase<typeof schema>;

const TERMINAL: RunStatus[] = ["completed", "failed", "cancelled"];

/**
 * CAS transition `from` → `to`. Returns the updated row, or null if the run was
 * not in `from` (someone else moved it). On queued→running, sets
 * projects.currentRunId; on a terminal `to`, clears it (if it points at us).
 */
export async function transitionRun(
  db: RunDB,
  runId: string,
  from: RunStatus,
  to: RunStatus,
  set: Partial<typeof runs.$inferInsert> = {},
): Promise<Run | null> {
  const [row] = await db
    .update(runs)
    .set({ status: to, ...set })
    .where(and(eq(runs.id, runId), eq(runs.status, from)))
    .returning();
  if (!row) return null;
  await syncProjectCurrentRun(db, row, to);
  return row;
}

/**
 * Finalize via CAS: set `status` (+ fields) only if the run is still in one of
 * `expectStatusIn`. Returns true if it changed a row. Clears activeStreamId is
 * the caller's job; we clear projects.currentRunId on terminal here.
 */
export async function finalizeRunCAS(
  db: RunDB,
  runId: string,
  opts: {
    expectStatusIn: RunStatus[];
    status: RunStatus;
    finishedAt?: Date;
    tokenUsage?: Run["tokenUsage"];
    stepCount?: number;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<boolean> {
  const set: Partial<typeof runs.$inferInsert> = { status: opts.status };
  if (opts.finishedAt) set.finishedAt = opts.finishedAt;
  if (opts.tokenUsage) set.tokenUsage = opts.tokenUsage;
  if (opts.stepCount != null) set.stepCount = opts.stepCount;
  if (opts.errorCode) set.errorCode = opts.errorCode;
  if (opts.errorMessage) set.errorMessage = opts.errorMessage;

  const [row] = await db
    .update(runs)
    .set(set)
    .where(and(eq(runs.id, runId), inArray(runs.status, opts.expectStatusIn)))
    .returning();
  if (!row) return false;
  await syncProjectCurrentRun(db, row, opts.status);
  return true;
}

async function syncProjectCurrentRun(
  db: RunDB,
  run: Run,
  to: RunStatus,
): Promise<void> {
  if (to === "running") {
    await db
      .update(projects)
      .set({ currentRunId: run.id })
      .where(eq(projects.id, run.projectId));
  } else if (TERMINAL.includes(to)) {
    await db
      .update(projects)
      .set({ currentRunId: null })
      .where(
        and(eq(projects.id, run.projectId), eq(projects.currentRunId, run.id)),
      );
  }
}

/** Bump heartbeat (liveness for the reaper). */
export async function touchHeartbeat(db: RunDB, runId: string): Promise<void> {
  await db
    .update(runs)
    .set({ heartbeatAt: sql`now()` })
    .where(eq(runs.id, runId));
}

export async function setActiveStream(
  db: RunDB,
  runId: string,
  streamId: string,
): Promise<void> {
  await db.update(runs).set({ activeStreamId: streamId }).where(eq(runs.id, runId));
}

export async function clearActiveStream(db: RunDB, runId: string): Promise<void> {
  await db.update(runs).set({ activeStreamId: null }).where(eq(runs.id, runId));
}

/** Clear activeStreamId only if it still matches `streamId` (stale-stop safe). */
export async function clearActiveStreamIfMatches(
  db: RunDB,
  runId: string,
  streamId: string | null,
): Promise<void> {
  if (!streamId) return;
  await db
    .update(runs)
    .set({ activeStreamId: null })
    .where(and(eq(runs.id, runId), eq(runs.activeStreamId, streamId)));
}

export async function loadRun(db: RunDB, runId: string): Promise<Run | null> {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId));
  return row ?? null;
}

/** Latest run for a conversation (for GET /:id/stream + GET /:id). */
export async function loadLatestRunForConversation(
  db: RunDB,
  conversationId: string,
): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(eq(runs.conversationId, conversationId))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return row ?? null;
}

export function isActiveStatus(status: RunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}
