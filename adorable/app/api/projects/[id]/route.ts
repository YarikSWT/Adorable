import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { HttpError } from "@/lib/auth/errors";

type Params = { id: string };

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

const loadProject = async (id: string) => {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return rows[0] ?? null;
};

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  const project = await loadProject(params.id);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.view", {
    projectId: project.id,
  });
  return NextResponse.json({ project });
});

type PatchBody = {
  name?: string;
  description?: string;
  slug?: string;
};

export const PATCH = protectedRoute<Params>(async ({ req, params, session }) => {
  const project = await loadProject(params.id);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.edit", {
    projectId: project.id,
  });
  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw new HttpError(400, "validation.failed", "Name must be 1..80 chars");
    }
    update.name = name;
  }
  if (typeof body.description === "string") {
    const desc = body.description.trim();
    if (desc.length > 500) {
      throw new HttpError(400, "validation.failed", "Description too long");
    }
    update.description = desc || null;
  }
  if (typeof body.slug === "string") {
    if (project.previewSubdomainLocked) {
      throw new HttpError(
        409,
        "conflict.slug_locked",
        "Slug is locked after first publication",
      );
    }
    const slug = body.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw new HttpError(400, "validation.failed", "Invalid slug");
    }
    update.slug = slug;
  }
  if (Object.keys(update).length === 0) {
    throw new HttpError(400, "validation.failed", "No editable fields");
  }
  update.updatedAt = new Date();
  const [updated] = await db
    .update(projects)
    .set(update)
    .where(eq(projects.id, project.id))
    .returning();
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.update",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
    metadata: { fields: Object.keys(update).filter((k) => k !== "updatedAt") },
  });
  return NextResponse.json({ project: updated });
});

type DeleteParams = { confirm?: string; archive?: boolean };

export const DELETE = protectedRoute<Params>(async ({ req, params, session }) => {
  const project = await loadProject(params.id);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.delete", {
    projectId: project.id,
  });
  // The body is optional; the UI sends `{archive: true}` for the soft path.
  const body = (await req.json().catch(() => ({}))) as DeleteParams;

  if (body.archive) {
    await db
      .update(projects)
      .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    await writeAuditLog({
      actorUserId: session.user.id,
      action: "project.archive",
      targetType: "project",
      targetId: project.id,
      organizationId: project.organizationId,
    });
    return NextResponse.json({ ok: true, archived: true });
  }

  // Hard delete: switch to status=deleted (preserves row for audit; cascade
  // policies on the schema handle the dependent project_members /
  // projectTokens entries when the row eventually gets purged).
  await db
    .update(projects)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(projects.id, project.id));
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.delete",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
  });
  return NextResponse.json({ ok: true, deleted: true });
});
