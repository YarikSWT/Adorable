import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projectMembers } from "@/lib/db/schema/projects";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

type Params = { repoId: string };

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  const project = await getProjectByGiteaWrapperId(params.repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.view", {
    projectId: project.id,
  });
  const rows = await db
    .select({
      userId: projectMembers.userId,
      email: users.email,
      name: users.name,
      role: roles.slug,
      joinedAt: projectMembers.joinedAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(roles, eq(roles.id, projectMembers.roleId))
    .where(eq(projectMembers.projectId, project.id));
  return NextResponse.json({ members: rows });
});
