import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projectMembers } from "@/lib/db/schema/projects";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { getRoleId } from "@/lib/auth/role-cache";
import { HttpError } from "@/lib/auth/errors";

type Params = { repoId: string; userId: string };

const ALLOWED_ROLES = new Set(["viewer", "editor", "publisher", "owner"]);

export const PATCH = protectedRoute<Params>(async ({ req, params, session }) => {
  const project = await getProjectByGiteaWrapperId(params.repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.members.manage", {
    projectId: project.id,
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
  const newRoleId = await getRoleId("project", role);
  const [updated] = await db
    .update(projectMembers)
    .set({ roleId: newRoleId })
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.userId, params.userId),
      ),
    )
    .returning();
  if (!updated) throw new HttpError(404, "not_found", "Member not found");
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.member_update",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
    metadata: { userId: params.userId, role },
  });
  return NextResponse.json({ ok: true, role });
});

export const DELETE = protectedRoute<Params>(async ({ params, session }) => {
  const project = await getProjectByGiteaWrapperId(params.repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.members.manage", {
    projectId: project.id,
  });
  const result = await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.userId, params.userId),
      ),
    )
    .returning({ userId: projectMembers.userId });
  if (result.length === 0) {
    throw new HttpError(404, "not_found", "Member not found");
  }
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.member_remove",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
    metadata: { userId: params.userId },
  });
  return NextResponse.json({ ok: true });
});
