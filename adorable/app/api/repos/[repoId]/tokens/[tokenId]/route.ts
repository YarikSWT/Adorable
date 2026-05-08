import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projectTokens } from "@/lib/db/schema/tokens";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

type Params = { repoId: string; tokenId: string };

// Revoke (= set revoked_at), never hard-delete — keeps audit trail intact.
export const DELETE = protectedRoute<Params>(async ({ params, session }) => {
  const project = await getProjectByGiteaWrapperId(params.repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.tokens.manage", {
    projectId: project.id,
  });
  const result = await db
    .update(projectTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(projectTokens.projectId, project.id),
        eq(projectTokens.id, params.tokenId),
      ),
    )
    .returning({ id: projectTokens.id });
  if (result.length === 0) {
    throw new HttpError(404, "not_found", "Token not found");
  }
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.token_revoke",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
    metadata: { tokenId: params.tokenId },
  });
  return NextResponse.json({ ok: true });
});
