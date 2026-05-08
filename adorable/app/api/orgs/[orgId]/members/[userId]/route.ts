import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/roles";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { getRoleId } from "@/lib/auth/role-cache";
import { HttpError } from "@/lib/auth/errors";

type Params = { orgId: string; userId: string };

const ALLOWED_ROLES = new Set(["owner", "admin", "member"]);

export const PATCH = protectedRoute<Params>(async ({ req, params, session }) => {
  await requirePermission(session.user.id, "organization.members.manage", {
    organizationId: params.orgId,
  });
  const body = (await req.json().catch(() => ({}))) as { role?: string };
  const role = (body.role ?? "").trim().toLowerCase();
  if (!ALLOWED_ROLES.has(role)) {
    throw new HttpError(
      400,
      "validation.failed",
      `role must be one of ${[...ALLOWED_ROLES].join(", ")}`,
    );
  }
  const newRoleId = await getRoleId("organization", role);

  // Prevent stripping the last owner — leaves the org orphaned otherwise.
  if (role !== "owner") {
    const ownerRoleId = await getRoleId("organization", "owner");
    const owners = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, params.orgId),
          eq(organizationMembers.roleId, ownerRoleId),
        ),
      );
    if (
      owners.length === 1 &&
      owners[0]?.userId === params.userId
    ) {
      throw new HttpError(
        409,
        "conflict.last_owner",
        "Cannot demote the last owner of an organisation",
      );
    }
  }

  const [updated] = await db
    .update(organizationMembers)
    .set({ roleId: newRoleId })
    .where(
      and(
        eq(organizationMembers.organizationId, params.orgId),
        eq(organizationMembers.userId, params.userId),
      ),
    )
    .returning();
  if (!updated) {
    throw new HttpError(404, "not_found", "Membership not found");
  }
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "organization.member_update",
    targetType: "user",
    targetId: params.userId,
    organizationId: params.orgId,
    metadata: { role },
  });
  return NextResponse.json({ ok: true, role });
});

export const DELETE = protectedRoute<Params>(async ({ params, session }) => {
  await requirePermission(session.user.id, "organization.members.manage", {
    organizationId: params.orgId,
  });
  // Same last-owner guard as PATCH.
  const ownerRoleId = await getRoleId("organization", "owner");
  const target = await db
    .select({ roleId: organizationMembers.roleId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, params.orgId),
        eq(organizationMembers.userId, params.userId),
      ),
    )
    .limit(1);
  if (!target[0]) {
    throw new HttpError(404, "not_found", "Membership not found");
  }
  if (target[0].roleId === ownerRoleId) {
    const owners = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, params.orgId),
          eq(organizationMembers.roleId, ownerRoleId),
        ),
      );
    if (owners.length === 1) {
      throw new HttpError(
        409,
        "conflict.last_owner",
        "Cannot remove the last owner",
      );
    }
  }

  await db
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, params.orgId),
        eq(organizationMembers.userId, params.userId),
      ),
    );
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "organization.member_remove",
    targetType: "user",
    targetId: params.userId,
    organizationId: params.orgId,
  });
  return NextResponse.json({ ok: true });
});

// Re-export so unused imports don't break TS — these are organisations of
// reference for future enhancements (org settings, billing).
void organizations;
void roles;
