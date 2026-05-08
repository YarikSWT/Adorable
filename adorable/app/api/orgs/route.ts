import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { plans, subscriptions } from "@/lib/db/schema/billing";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireEmailVerified } from "@/lib/auth/session";
import { getRoleId } from "@/lib/auth/role-cache";
import { writeAuditLog } from "@/lib/auth/audit";
import { HttpError } from "@/lib/auth/errors";

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

type CreateOrgBody = {
  name?: string;
  slug?: string;
};

// POST /api/orgs — anyone with a verified email can create a team-org.
// Personal-orgs are only ever created by the bootstrap hook (Phase 4); the
// route refuses requests that try to spoof type=personal.
export const POST = protectedRoute(async ({ req, session }) => {
  requireEmailVerified(session);
  const body = (await req.json().catch(() => ({}))) as CreateOrgBody;
  const name = (body.name ?? "").trim();
  const slug = (body.slug ?? "").trim().toLowerCase();
  if (!name || name.length < 2 || name.length > 80) {
    throw new HttpError(400, "validation.failed", "Name must be 2..80 chars");
  }
  if (!SLUG_RE.test(slug)) {
    throw new HttpError(
      400,
      "validation.failed",
      "Slug must be 3..32 chars, lowercase letters/digits/hyphens, start with a letter",
    );
  }

  const ownerRoleId = await getRoleId("organization", "owner");
  const freePlan = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.slug, "free"))
    .limit(1);
  if (!freePlan[0]) {
    throw new Error("[orgs] free plan missing — run db:seed");
  }
  const planId = freePlan[0].id;

  const result = await db.transaction(async (tx) => {
    // Slug uniqueness — declarative on the column, but pre-checking gives a
    // clean 409 instead of a raw constraint violation.
    const conflict = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (conflict[0]) {
      throw new HttpError(
        409,
        "conflict.slug_taken",
        "Slug is already in use",
      );
    }
    const [org] = await tx
      .insert(organizations)
      .values({
        type: "team",
        slug,
        name,
        ownerUserId: session.user.id,
      })
      .returning();
    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId: session.user.id,
      roleId: ownerRoleId,
    });
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    await tx.insert(subscriptions).values({
      organizationId: org.id,
      planId,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      provider: "manual",
    });
    return org;
  });

  await writeAuditLog({
    actorUserId: session.user.id,
    action: "organization.create",
    targetType: "organization",
    targetId: result.id,
    organizationId: result.id,
  });

  return NextResponse.json({ organization: result }, { status: 200 });
});
