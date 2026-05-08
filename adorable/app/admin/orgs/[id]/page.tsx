import Link from "next/link";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import {
  planOverrides,
  plans,
  subscriptions,
} from "@/lib/db/schema/billing";
import { OverrideForm } from "./override-form";

export default async function AdminOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgRow = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  const org = orgRow[0];
  if (!org) {
    return <div className="text-sm text-muted-foreground">Org не найдена.</div>;
  }
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
        eq(subscriptions.organizationId, org.id),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);
  const overrides = await db
    .select()
    .from(planOverrides)
    .where(
      and(
        eq(planOverrides.organizationId, org.id),
        or(
          isNull(planOverrides.expiresAt),
          gt(planOverrides.expiresAt, new Date()),
        ),
      ),
    );

  const planLimits = sub[0]?.planLimits ?? {};
  return (
    <div className="max-w-2xl">
      <Link
        href="/admin"
        className="mb-3 inline-block text-xs text-muted-foreground hover:text-foreground"
      >
        ← Admin
      </Link>
      <h1 className="mb-1 text-lg font-semibold">{org.name}</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        {org.slug} · type={org.type} · plan={sub[0]?.planSlug ?? "—"} ·
        period {sub[0]?.currentPeriodStart?.toISOString()?.slice(0, 10) ?? "—"}{" "}
        — {sub[0]?.currentPeriodEnd?.toISOString()?.slice(0, 10) ?? "—"}
      </p>

      <h2 className="mb-2 text-sm font-semibold">План: {sub[0]?.planName}</h2>
      <div className="mb-6 overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Ресурс</th>
              <th className="px-3 py-2">Лимит</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(planLimits).map(([k, v]) => (
              <tr key={k} className="border-t border-border/40">
                <td className="px-3 py-2 font-mono text-xs">{k}</td>
                <td className="px-3 py-2">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Активные overrides</h2>
      {overrides.length === 0 ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Нет активных overrides.
        </p>
      ) : (
        <div className="mb-4 rounded-md border border-border/40 p-3 text-sm">
          {overrides.map((o) => (
            <div key={o.id} className="border-t border-border/40 first:border-t-0 py-2">
              <div className="font-mono text-xs">
                {Object.entries(o.limits ?? {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")}
              </div>
              <div className="text-xs text-muted-foreground">
                {o.reason ? `«${o.reason}» · ` : ""}
                {o.expiresAt
                  ? `истекает ${o.expiresAt.toISOString().slice(0, 19)}`
                  : "без срока"}
              </div>
            </div>
          ))}
        </div>
      )}

      <OverrideForm orgId={org.id} />
    </div>
  );
}
