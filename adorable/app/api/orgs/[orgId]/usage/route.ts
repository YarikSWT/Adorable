import { NextResponse } from "next/server";
import { and, count, desc, eq, gt, isNull, max, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  planOverrides,
  plans,
  subscriptions,
  usageCounters,
  usageEvents,
} from "@/lib/db/schema/billing";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { currentPeriodStartUTC, readUsage } from "@/lib/auth/quotas";
import { HttpError } from "@/lib/auth/errors";

type Params = { orgId: string };

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  await requirePermission(session.user.id, "organization.billing.view", {
    organizationId: params.orgId,
  });

  const sub = await db
    .select({
      planSlug: plans.slug,
      planName: plans.name,
      planLimits: plans.limits,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.organizationId, params.orgId),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);

  if (!sub[0]) {
    throw new HttpError(404, "not_found", "Active subscription not found");
  }

  const overrides = await db
    .select({
      limits: planOverrides.limits,
      reason: planOverrides.reason,
      grantedBy: planOverrides.grantedBy,
      expiresAt: planOverrides.expiresAt,
      createdAt: planOverrides.createdAt,
    })
    .from(planOverrides)
    .where(
      and(
        eq(planOverrides.organizationId, params.orgId),
        or(
          isNull(planOverrides.expiresAt),
          gt(planOverrides.expiresAt, new Date()),
        ),
      ),
    );

  const period = currentPeriodStartUTC();
  const counters = await db
    .select({
      kind: usageCounters.kind,
      used: usageCounters.used,
    })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.organizationId, params.orgId),
        eq(usageCounters.periodStart, isoDate(period)),
      ),
    );

  // Effective limits = plan + last-wins override layering (matches
  // resolveLimit in lib/auth/quotas.ts).
  const effective: Record<string, number> = { ...(sub[0].planLimits ?? {}) };
  for (const o of overrides) {
    for (const [k, v] of Object.entries(o.limits ?? {})) {
      if (typeof v === "number") effective[k] = v;
    }
  }

  // Per-kind used. Counter-based kinds come straight from usage_counters;
  // absolute kinds (projects.max, members_per_project.max) are computed
  // live via readUsage so the billing UI matches what requireQuota sees.
  const used: Record<string, number> = {};
  for (const c of counters) used[c.kind] = Number(c.used);
  await Promise.all(
    Object.keys(effective).map(async (kind) => {
      if (used[kind] === undefined) {
        used[kind] = await readUsage(params.orgId, kind);
      }
    }),
  );

  const eventsCountRow = await db
    .select({ n: count(), latest: max(usageEvents.createdAt) })
    .from(usageEvents)
    .where(eq(usageEvents.organizationId, params.orgId));

  const recentEvents = await db
    .select({
      id: usageEvents.id,
      kind: usageEvents.kind,
      amount: usageEvents.amount,
      unit: usageEvents.unit,
      model: usageEvents.model,
      projectId: usageEvents.projectId,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(eq(usageEvents.organizationId, params.orgId))
    .orderBy(desc(usageEvents.createdAt))
    .limit(50);

  return NextResponse.json({
    plan: {
      slug: sub[0].planSlug,
      name: sub[0].planName,
      limits: sub[0].planLimits ?? {},
    },
    period: {
      start: sub[0].currentPeriodStart,
      end: sub[0].currentPeriodEnd,
    },
    limits: effective,
    used,
    overrides: overrides.map((o) => ({
      limits: o.limits,
      reason: o.reason,
      expiresAt: o.expiresAt,
      createdAt: o.createdAt,
    })),
    events: {
      total: Number(eventsCountRow[0]?.n ?? 0),
      lastEventAt: eventsCountRow[0]?.latest ?? null,
      items: recentEvents,
    },
  });
});
