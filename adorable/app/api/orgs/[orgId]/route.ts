import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema/organizations";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { HttpError } from "@/lib/auth/errors";

type Params = { orgId: string };

const loadOrg = async (orgId: string) => {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return rows[0] ?? null;
};

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  await requirePermission(session.user.id, "organization.view", {
    organizationId: params.orgId,
  });
  const org = await loadOrg(params.orgId);
  if (!org) throw new HttpError(404, "not_found", "Organization not found");
  return NextResponse.json({ organization: org });
});

type PatchBody = { name?: string; slug?: string };

export const PATCH = protectedRoute<Params>(async ({ req, params, session }) => {
  await requirePermission(session.user.id, "organization.update", {
    organizationId: params.orgId,
  });
  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new HttpError(400, "validation.failed", "Name must be 2..80 chars");
    }
    update.name = name;
  }
  if (typeof body.slug === "string") {
    const slug = body.slug.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
      throw new HttpError(400, "validation.failed", "Invalid slug");
    }
    update.slug = slug;
  }
  if (Object.keys(update).length === 0) {
    throw new HttpError(400, "validation.failed", "No editable fields");
  }
  update.updatedAt = new Date();
  const [updated] = await db
    .update(organizations)
    .set(update)
    .where(eq(organizations.id, params.orgId))
    .returning();
  if (!updated) throw new HttpError(404, "not_found", "Organization not found");
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "organization.update",
    targetType: "organization",
    targetId: params.orgId,
    organizationId: params.orgId,
    metadata: { fields: Object.keys(update).filter((k) => k !== "updatedAt") },
  });
  return NextResponse.json({ organization: updated });
});

export const DELETE = protectedRoute<Params>(async ({ params, session }) => {
  await requirePermission(session.user.id, "organization.delete", {
    organizationId: params.orgId,
  });
  const org = await loadOrg(params.orgId);
  if (!org) throw new HttpError(404, "not_found", "Organization not found");
  if (org.type === "personal") {
    throw new HttpError(
      403,
      "access.denied",
      "Personal organisations cannot be deleted",
    );
  }
  await db.delete(organizations).where(eq(organizations.id, params.orgId));
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "organization.delete",
    targetType: "organization",
    targetId: params.orgId,
    organizationId: params.orgId,
  });
  return NextResponse.json({ ok: true });
});
