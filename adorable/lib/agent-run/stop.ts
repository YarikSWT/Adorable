// POST /api/chat/:id/stop logic (спец v2.1 §4.3) — explicit stop only (never
// from navigation/cleanup). Branches by status to AVOID the cancelling deadlock:
//   - queued  → boss.cancel removed the job, so nobody would ever drive
//     cancelling→cancelled; finalize straight to `cancelled` here (+release),
//     freeing the project from the one_active_run_per_project index;
//   - running → `cancelling` + a Redis cancel flag; the worker finishes within
//     ~5s (polls the flag, aborts) and finalizes itself.
// Stale stop (an outdated activeStreamId) is a no-op success.

import type Redis from "ioredis";
import type { UIMessage } from "ai";
import {
  finalizeRunCAS,
  clearActiveStreamIfMatches,
  type RunDB,
} from "./run-state";
import { setCancelFlag, clearCancelFlag } from "./cancel";
import type { Run } from "@/lib/db/schema/runs";

export type StopOutcome = "cancelled" | "cancelling" | "stale";

export interface StopDeps {
  db: RunDB;
  redis: Redis;
  /** pg-boss cancel for a still-queued job. */
  boss?: { cancel: (jobId: string) => Promise<unknown> };
  /** Release the quota reservation (idempotent by runId). */
  releaseReservation?: (runId: string) => Promise<void>;
  /** Persist the front's partial assistant snapshot (onFinish stays authoritative). */
  upsertSnapshot?: (args: {
    conversationId: string;
    runId: string;
    uiMessage: UIMessage;
  }) => Promise<void>;
}

export interface StopBody {
  activeStreamId?: string;
  assistantMessage?: UIMessage;
}

export async function stopRun(
  deps: StopDeps,
  run: Run,
  body: StopBody = {},
): Promise<StopOutcome> {
  // Ignore a stale stop (arrived after a newer stream started).
  if (
    body.activeStreamId &&
    run.activeStreamId &&
    body.activeStreamId !== run.activeStreamId
  ) {
    return "stale";
  }

  // Optional partial snapshot from the front (worker onFinish overwrites it).
  if (body.assistantMessage && deps.upsertSnapshot) {
    await deps
      .upsertSnapshot({
        conversationId: run.conversationId,
        runId: run.id,
        uiMessage: body.assistantMessage,
      })
      .catch(() => undefined);
  }

  // Remove the job if it's still queued (so the worker never picks it up).
  if (run.jobId && deps.boss) {
    await deps.boss.cancel(run.jobId).catch(() => undefined);
  }

  // Queued path: finalize straight to cancelled (no cancelling deadlock).
  const finalizedQueued = await finalizeRunCAS(deps.db, run.id, {
    expectStatusIn: ["queued"],
    status: "cancelled",
    finishedAt: new Date(),
  });
  if (finalizedQueued) {
    if (deps.releaseReservation) {
      await deps.releaseReservation(run.id).catch(() => undefined);
    }
    await clearCancelFlag(deps.redis, run.id);
    await clearActiveStreamIfMatches(deps.db, run.id, run.activeStreamId);
    return "cancelled";
  }

  // Running path: mark cancelling + set the flag; the worker finalizes ≤5s.
  await finalizeRunCAS(deps.db, run.id, {
    expectStatusIn: ["running"],
    status: "cancelling",
  });
  await setCancelFlag(deps.redis, run.id);
  await clearActiveStreamIfMatches(deps.db, run.id, run.activeStreamId);
  return "cancelling";
}
