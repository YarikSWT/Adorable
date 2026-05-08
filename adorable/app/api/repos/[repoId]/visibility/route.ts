import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

type Params = { repoId: string };

const ALLOWED_VISIBILITY = new Set(["private", "authenticated", "public"]);

type PatchBody = { visibility?: string };

export const PATCH = protectedRoute<Params>(async ({ req, params, session }) => {
  const project = await getProjectByGiteaWrapperId(params.repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.publish", {
    projectId: project.id,
  });
  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const visibility = (body.visibility ?? "").trim().toLowerCase();
  if (!ALLOWED_VISIBILITY.has(visibility)) {
    throw new HttpError(
      400,
      "validation.failed",
      `visibility must be one of ${[...ALLOWED_VISIBILITY].join(", ")}`,
    );
  }
  await db
    .update(projects)
    .set({
      publishedVisibility: visibility as "private" | "authenticated" | "public",
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id));
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.visibility_update",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
    metadata: { visibility },
  });
  return NextResponse.json({ ok: true, visibility });
});
