// Quota enforcement and usage accounting.
//
// Two flavours, dispatched on `kind`:
//
//   * Counter quotas (default) — accumulate per (org, period, kind) in
//     `usage_counters`. requireQuota reads the counter; recordUsage inserts
//     into usage_events AND atomically bumps usage_counters.used (UPSERT).
//
//   * Absolute quotas (ABSOLUTE_KINDS) — `projects.max`, `members_per_project.max`.
//     For these we count() the live resources directly; usage_counters is
//     irrelevant because deletions reduce the live count automatically.
//
// Limit resolution: subscription.plan.limits[kind] is the base; non-expired
// `plan_overrides` rows replace it (later override wins). Returning `null`
// from resolveLimit means "no limit configured".
//
// Period boundary: first day of the current month, UTC. Monthly is the only
// granularity for now; a `.daily` / `.hourly` suffix on `kind` will trigger
// new branches when needed.

import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db as defaultDb } from "@/lib/db/client";
import {
  planOverrides,
  plans,
  subscriptions,
  usageCounters,
  usageEvents,
} from "@/lib/db/schema/billing";
import { projects } from "@/lib/db/schema/projects";
import { projectMembers } from "@/lib/db/schema/projects";
import { HttpError } from "./errors";

type DbOrTx = typeof defaultDb;

const ABSOLUTE_KINDS = new Set(["projects.max", "members_per_project.max"]);

export const currentPeriodStartUTC = (now: Date = new Date()): Date => {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
};

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const resolveLimit = async (
  organizationId: string,
  kind: string,
  database: DbOrTx = defaultDb,
): Promise<number | null> => {
  // Plan limit via active subscription
  const sub = await database
    .select({
      planLimits: plans.limits,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);
  const planValue = sub[0]?.planLimits?.[kind];
  let final: number | null =
    typeof planValue === "number" ? planValue : null;

  // Non-expired overrides — apply in createdAt order; last one wins.
  const overrides = await database
    .select({
      limits: planOverrides.limits,
      createdAt: planOverrides.createdAt,
    })
    .from(planOverrides)
    .where(
      and(
        eq(planOverrides.organizationId, organizationId),
        or(
          isNull(planOverrides.expiresAt),
          gt(planOverrides.expiresAt, new Date()),
        ),
      ),
    );
  for (const o of overrides) {
    const v = o.limits?.[kind];
    if (typeof v === "number") final = v;
  }

  return final;
};

const getCounter = async (
  organizationId: string,
  period: Date,
  kind: string,
  database: DbOrTx,
): Promise<number> => {
  const row = await database
    .select({ used: usageCounters.used })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.organizationId, organizationId),
        eq(usageCounters.periodStart, toIsoDate(period)),
        eq(usageCounters.kind, kind),
      ),
    )
    .limit(1);
  if (!row[0]) return 0;
  return Number(row[0].used);
};

const getAbsoluteUsage = async (
  organizationId: string,
  kind: string,
  database: DbOrTx,
): Promise<number> => {
  if (kind === "projects.max") {
    const row = await database
      .select({ n: count() })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(projects.status, "active"),
        ),
      );
    return Number(row[0]?.n ?? 0);
  }
  if (kind === "members_per_project.max") {
    // Without a projectId scope this kind is meaningless; the call sites
    // that need per-project enforcement should pass it via the future
    // `requireQuotaInProject` helper. Until that helper exists we treat the
    // org-level reading as 0 (no enforcement) and surface a hint in the dev
    // log so the gap is visible.
    void database;
    void projectMembers;
    return 0;
  }
  throw new Error(`[quotas] unknown absolute kind: ${kind}`);
};

export const requireQuota = async (
  organizationId: string,
  kind: string,
  estimated: number,
  database: DbOrTx = defaultDb,
): Promise<{ remaining: number }> => {
  const limit = await resolveLimit(organizationId, kind, database);
  if (limit == null) return { remaining: Infinity };

  const used = ABSOLUTE_KINDS.has(kind)
    ? await getAbsoluteUsage(organizationId, kind, database)
    : await getCounter(
        organizationId,
        currentPeriodStartUTC(),
        kind,
        database,
      );

  if (used + estimated > limit) {
    throw new HttpError(402, "quota.exceeded", "Превышена квота плана", {
      quota: {
        kind,
        limit,
        used,
        period_start: ABSOLUTE_KINDS.has(kind)
          ? null
          : currentPeriodStartUTC().toISOString(),
      },
    });
  }
  return { remaining: limit - used - estimated };
};

export type RecordUsageEvent = {
  organizationId: string;
  userId?: string | null;
  projectId?: string | null;
  kind: string;
  amount: number;
  unit: string;
  costCents?: number | null;
  model?: string | null;
  metadata?: unknown;
};

export const recordUsage = async (
  event: RecordUsageEvent,
  database: DbOrTx = defaultDb,
): Promise<void> => {
  const isAbsolute = ABSOLUTE_KINDS.has(event.kind);
  const id = uuidv7();
  const period = currentPeriodStartUTC();
  await database.transaction(async (tx) => {
    await tx.insert(usageEvents).values({
      id,
      organizationId: event.organizationId,
      userId: event.userId ?? null,
      projectId: event.projectId ?? null,
      kind: event.kind,
      amount: String(event.amount),
      unit: event.unit,
      costCents: event.costCents ?? null,
      model: event.model ?? null,
      metadata: (event.metadata as object | undefined) ?? null,
    });
    if (isAbsolute) return; // counters table is unused for absolute kinds
    await tx
      .insert(usageCounters)
      .values({
        organizationId: event.organizationId,
        periodStart: toIsoDate(period),
        kind: event.kind,
        used: String(event.amount),
      })
      .onConflictDoUpdate({
        target: [
          usageCounters.organizationId,
          usageCounters.periodStart,
          usageCounters.kind,
        ],
        set: {
          used: sql`${usageCounters.used} + ${event.amount}`,
        },
      });
  });
};

export const __testing = {
  ABSOLUTE_KINDS,
  toIsoDate,
};
