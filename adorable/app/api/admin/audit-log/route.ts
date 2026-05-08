import { NextResponse } from "next/server";
import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema/audit";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireAdminPermission } from "@/lib/auth/authorization";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const GET = protectedRoute(async ({ req, session }) => {
  await requireAdminPermission(session.user.id, "admin.audit.read");
  const url = new URL(req.url);
  const filters: SQL[] = [];
  const actor = url.searchParams.get("actorUserId");
  if (actor) filters.push(eq(auditLog.actorUserId, actor));
  const action = url.searchParams.get("action");
  if (action) filters.push(eq(auditLog.action, action));
  const targetType = url.searchParams.get("targetType");
  if (targetType) filters.push(eq(auditLog.targetType, targetType));
  const targetId = url.searchParams.get("targetId");
  if (targetId) filters.push(eq(auditLog.targetId, targetId));
  const orgId = url.searchParams.get("organizationId");
  if (orgId) filters.push(eq(auditLog.organizationId, orgId));
  const sinceParam = url.searchParams.get("since");
  if (sinceParam) {
    const since = new Date(sinceParam);
    if (!Number.isNaN(since.getTime())) {
      filters.push(gte(auditLog.createdAt, since));
    }
  }
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
  );

  const baseQuery = db
    .select({
      id: auditLog.id,
      actorUserId: auditLog.actorUserId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      organizationId: auditLog.organizationId,
      metadata: auditLog.metadata,
      ipAddress: auditLog.ipAddress,
      userAgent: auditLog.userAgent,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  const items =
    filters.length > 0
      ? await baseQuery.where(and(...filters))
      : await baseQuery;

  return NextResponse.json({ items, limit });
});
