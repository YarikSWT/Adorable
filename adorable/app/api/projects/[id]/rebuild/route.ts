// POST /api/projects/[id]/rebuild
//
// Контракт: docs/preview-provider/CONTRACTS.md §17.
//
//   Body: {} (пусто)
//   Response 200: { jobId: "uuid", status: "queued" | "running" }
//   Response 403: project.edit отсутствует.
//   Response 403: { error: "manualRebuild not supported" } — provider
//     с capabilities.manualRebuild=false (sandbox-режим).
//   Response 404: project не найден.
//
// `:id` — это projects.id (UUID) ИЛИ giteaWrapperRepoId — UI исторически
// передавала wrapper-id; принимаем оба варианта.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import {
  getBuildQueue,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import {
  getProjectByGiteaWrapperId,
  type ProjectRow,
} from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

type Params = { id: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resolveProject = async (raw: string): Promise<ProjectRow | null> => {
  const decoded = decodeURIComponent(raw);
  if (UUID_RE.test(decoded)) {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, decoded))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  return getProjectByGiteaWrapperId(decoded);
};

export const POST = protectedRoute<Params>(async ({ params, session }) => {
  const project = await resolveProject(params.id);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.edit", {
    projectId: project.id,
  });

  const provider = await getPreviewProvider();
  if (!provider.capabilities.manualRebuild) {
    throw new HttpError(
      403,
      "access.denied",
      "manualRebuild not supported by provider",
    );
  }

  // The build queue keys on sourceRepoId — that's the projectId the
  // PreviewProvider.create() handed back when this project was set up.
  const queue = getBuildQueue();
  const buildProjectId =
    project.giteaRepoId ?? project.giteaWrapperRepoId ?? project.id;
  const result = await queue.enqueue({
    projectId: buildProjectId,
    reason: "manual",
  });
  return NextResponse.json(result);
});
