import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/roles";
import { plans, subscriptions } from "@/lib/db/schema/billing";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { HttpError } from "@/lib/auth/errors";

export const GET = protectedRoute(async ({ session }) => {
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isAdmin: users.isAdmin,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const u = userRows[0];
  if (!u) {
    throw new HttpError(404, "not_found", "User not found");
  }

  // Per-org rows joined with role slug + active subscription. We grab plan
  // slug + period_end so the UI can render "free until <date>" without a
  // second round-trip to /api/orgs/:id/billing.
  const orgRows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      type: organizations.type,
      roleSlug: roles.slug,
      planSlug: plans.slug,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .leftJoin(
      subscriptions,
      and(
        eq(subscriptions.organizationId, organizations.id),
        eq(subscriptions.status, "active"),
      ),
    )
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(organizationMembers.userId, session.user.id))
    .orderBy(desc(organizations.createdAt));

  return NextResponse.json({
    user: u,
    organizations: orgRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      type: row.type,
      role: row.roleSlug,
      subscription: row.planSlug
        ? {
            planSlug: row.planSlug,
            currentPeriodEnd: row.currentPeriodEnd,
          }
        : null,
    })),
  });
});

type PatchPayload = { name?: string; avatarUrl?: string };

export const PATCH = protectedRoute(async ({ req, session }) => {
  const payload = (await req.json().catch(() => ({}))) as PatchPayload;
  const update: Record<string, string | null> = {};
  if (typeof payload.name === "string") {
    const name = payload.name.trim();
    if (name) update.name = name;
  }
  if (typeof payload.avatarUrl === "string") {
    const url = payload.avatarUrl.trim();
    update.avatarUrl = url || null;
  }
  if (Object.keys(update).length === 0) {
    throw new HttpError(
      400,
      "validation.failed",
      "No editable fields supplied (expected name and/or avatarUrl)",
    );
  }
  const [updated] = await db
    .update(users)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
    });
  return NextResponse.json({ user: updated });
});
