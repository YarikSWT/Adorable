import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createConversationInRepo, readRepoMetadata } from "@/lib/repo-storage";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

type Params = { repoId: string };

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  const repoId = decodeURIComponent(params.repoId);
  const project = await getProjectByGiteaWrapperId(repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.view", {
    projectId: project.id,
  });

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    throw new HttpError(404, "not_found", "Repository metadata not found");
  }

  return NextResponse.json({ conversations: metadata.conversations });
});

export const POST = protectedRoute<Params>(async ({ req, params, session }) => {
  const repoId = decodeURIComponent(params.repoId);
  const project = await getProjectByGiteaWrapperId(repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.edit", {
    projectId: project.id,
  });

  let requestedTitle: string | undefined;
  try {
    const payload = (await req.json()) as { title?: string };
    const nextTitle = payload?.title?.trim();
    requestedTitle = nextTitle ? nextTitle : undefined;
  } catch {
    requestedTitle = undefined;
  }

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    throw new HttpError(404, "not_found", "Repository metadata not found");
  }

  const conversationId = randomUUID();
  const next = await createConversationInRepo(
    repoId,
    metadata,
    conversationId,
    requestedTitle,
  );

  return NextResponse.json({
    conversationId,
    conversations: next.conversations,
  });
});
