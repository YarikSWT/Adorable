import { NextResponse } from "next/server";
import { readConversationMessages } from "@/lib/repo-storage";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

type Params = { repoId: string; conversationId: string };

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  const repoId = decodeURIComponent(params.repoId);
  const conversationId = decodeURIComponent(params.conversationId);
  const project = await getProjectByGiteaWrapperId(repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.view", {
    projectId: project.id,
  });

  const messages = await readConversationMessages(repoId, conversationId);
  return NextResponse.json({ messages });
});
