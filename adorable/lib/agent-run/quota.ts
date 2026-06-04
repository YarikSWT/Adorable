// Quota RESERVATION (спец v2.1 §4.1/§4.6) — reserve at POST, reconcile at every
// terminal branch. No schema change (§3.4): reservation state rides on
// usageEvents.metadata ({runId, phase}) so it is idempotent by runId (handler vs
// reaper never double-count).
//
//   reserve(+E)            at POST           — optimistic charge of the estimate
//   reconcile(actual − E)  at terminal       — net charge becomes the ACTUAL usage
//   release(−E)            at orphan         — net charge becomes 0
//
// reconcile XOR release per run (whichever fires first wins; the other no-ops).

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { usageEvents } from "@/lib/db/schema/billing";
import { requireQuota, recordUsage } from "@/lib/auth/quotas";
import type { DB } from "@/lib/db/client";

// Accept the broad drizzle type; the auth/quotas helpers want the concrete app
// DB (carries $client). Both the app singleton and the test drizzle instance
// satisfy it at runtime, so we bridge the annotation gap with a single cast.
export type QuotaDB = PostgresJsDatabase<typeof schema>;
const asDB = (db: QuotaDB): DB => db as unknown as DB;

export const LLM_TOKENS_KIND = "llm.tokens.monthly";

// A multi-step run's worst case, NOT an average turn. Sizing the reservation to
// the average leaves the overshoot (actual − estimate) at the limit unbounded,
// making the quota decorative (ревью v2.1-2 §4). MAX_TOTAL_STEPS × per-step
// context is the honest ceiling.
export const MAX_TOTAL_STEPS = 10;
export const PER_STEP_TOKEN_ESTIMATE = 8_000;
export const ESTIMATED_TURN_TOKENS = MAX_TOTAL_STEPS * PER_STEP_TOKEN_ESTIMATE;

interface RunRef {
  runId: string;
  organizationId: string;
  userId?: string;
  projectId?: string;
}

async function hasPhaseEvent(
  db: QuotaDB,
  runId: string,
  phase: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.kind, LLM_TOKENS_KIND),
        sql`${usageEvents.metadata}->>'runId' = ${runId}`,
        sql`${usageEvents.metadata}->>'phase' = ${phase}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function writeUsage(
  db: QuotaDB,
  ref: RunRef,
  phase: string,
  amount: number,
): Promise<void> {
  await recordUsage(
    {
      organizationId: ref.organizationId,
      userId: ref.userId,
      projectId: ref.projectId,
      kind: LLM_TOKENS_KIND,
      amount,
      unit: "tokens",
      metadata: { runId: ref.runId, phase },
    },
    asDB(db),
  );
}

export interface ReserveResult {
  ok: boolean;
  code?: "quota_exceeded";
  reservedTokens: number;
}

/**
 * Reserve quota for a run. Blocks (ok:false, quota_exceeded → 429) if the
 * estimate would exceed the plan limit. Idempotent by runId.
 */
export async function reserveQuota(
  db: QuotaDB,
  ref: RunRef,
  estimatedTokens: number = ESTIMATED_TURN_TOKENS,
): Promise<ReserveResult> {
  // Already reserved (retry/dup POST) → succeed without double-charging.
  if (await hasPhaseEvent(db, ref.runId, "reserve")) {
    return { ok: true, reservedTokens: estimatedTokens };
  }
  try {
    await requireQuota(ref.organizationId, LLM_TOKENS_KIND, estimatedTokens, asDB(db));
  } catch {
    return { ok: false, code: "quota_exceeded", reservedTokens: 0 };
  }
  await writeUsage(db, ref, "reserve", estimatedTokens);
  return { ok: true, reservedTokens: estimatedTokens };
}

/**
 * Reconcile a finished run: net charge becomes the actual usage. Idempotent —
 * skips if the run was already reconciled or released.
 */
export async function reconcileUsage(
  db: QuotaDB,
  ref: RunRef,
  actualTokens: number,
  reservedTokens: number = ESTIMATED_TURN_TOKENS,
): Promise<void> {
  if (await hasPhaseEvent(db, ref.runId, "reconcile")) return;
  if (await hasPhaseEvent(db, ref.runId, "release")) return;
  await writeUsage(db, ref, "reconcile", actualTokens - reservedTokens);
}

/**
 * Release a reservation for an orphaned run (no actual usage): net charge → 0.
 * Idempotent; no-op if already reconciled or released.
 */
export async function releaseReservation(
  db: QuotaDB,
  ref: RunRef,
  reservedTokens: number = ESTIMATED_TURN_TOKENS,
): Promise<void> {
  if (await hasPhaseEvent(db, ref.runId, "reconcile")) return;
  if (await hasPhaseEvent(db, ref.runId, "release")) return;
  await writeUsage(db, ref, "release", -reservedTokens);
}

/** Current charged total (period counter) for a kind — for assertions/UX. */
export async function chargedTokens(
  db: QuotaDB,
  runId: string,
): Promise<number> {
  const rows = await db
    .select({ amount: usageEvents.amount })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.kind, LLM_TOKENS_KIND),
        sql`${usageEvents.metadata}->>'runId' = ${runId}`,
      ),
    );
  return rows.reduce((sum, r) => sum + Number(r.amount), 0);
}
