import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { planOverrides } from "@/lib/db/schema/billing";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireAdminPermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { HttpError } from "@/lib/auth/errors";

type Params = { orgId: string };

type Body = {
  limits?: Record<string, number>;
  reason?: string;
  expiresAt?: string | null;
};

export const POST = protectedRoute<Params>(async ({ req, params, session }) => {
  await requireAdminPermission(session.user.id, "admin.plan_overrides.manage");
  const body = (await req.json().catch(() => ({}))) as Body;
  const limits = body.limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new HttpError(400, "validation.failed", "limits must be an object");
  }
  const cleaned: Record<string, number> = {};
  for (const [k, v] of Object.entries(limits)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      cleaned[k] = v;
    }
  }
  if (Object.keys(cleaned).length === 0) {
    throw new HttpError(400, "validation.failed", "limits must have at least one numeric entry");
  }
  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) {
      throw new HttpError(400, "validation.failed", "Invalid expiresAt");
    }
    expiresAt = d;
  }
  const [created] = await db
    .insert(planOverrides)
    .values({
      organizationId: params.orgId,
      limits: cleaned,
      reason: body.reason?.trim() || null,
      grantedBy: session.user.id,
      expiresAt: expiresAt ?? undefined,
    })
    .returning();
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "admin.plan_override.create",
    targetType: "organization",
    targetId: params.orgId,
    organizationId: params.orgId,
    metadata: { limits: cleaned, reason: body.reason ?? null },
  });
  return NextResponse.json({ override: created });
});
