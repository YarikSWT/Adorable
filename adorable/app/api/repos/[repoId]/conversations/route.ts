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

// Idempotent — invariant "one conversation per project". If the project
// already has a conversation, return that one verbatim; only on the very
// first call (e.g. immediately after POST /api/repos creates the project +
// initial conversation in one transaction, or for legacy projects where
// metadata.conversations got cleared) we mint a new id.
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

  const existing = metadata.conversations[0];
  if (existing) {
    return NextResponse.json({
      conversationId: existing.id,
      conversations: metadata.conversations,
      reused: true,
    });
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
