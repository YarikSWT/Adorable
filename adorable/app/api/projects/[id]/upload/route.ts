// POST /api/projects/[id]/upload
//
// Контракт: docs/preview-provider/CONTRACTS.md §16, ADR-007.
//
// multipart/form-data с одним полем "file". Server валидирует
// (size + extension whitelist + magic-bytes match) и пишет в
// /data/projects/<id>/public/<safeName>.
//
// Response 200: {path, size, mime}
// Response 400: {error, details}
// Response 403: {error}

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import {
  getProjectByGiteaWrapperId,
  type ProjectRow,
} from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";
import {
  validateUpload,
  type UploadValidationErr,
} from "@/lib/preview/upload-validator";
import { getSharedAuditLogger } from "@/lib/sandbox/audit-log";

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

const DEFAULT_PROJECTS_ROOT = "/data/projects";
const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const resolveProjectsRoot = (): string =>
  process.env["PROJECTS_ROOT"] ?? DEFAULT_PROJECTS_ROOT;

const resolveUploadMax = (): number => {
  const raw = process.env["UPLOAD_MAX_BYTES"];
  if (!raw) return DEFAULT_UPLOAD_MAX_BYTES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_UPLOAD_MAX_BYTES;
};

const errorResponse = (
  status: number,
  err: UploadValidationErr | { error: string; details?: string },
): NextResponse =>
  NextResponse.json(
    "ok" in err
      ? { error: err.error, details: err.details }
      : { error: err.error, details: err.details ?? "" },
    { status },
  );

export const POST = protectedRoute<{ id: string }>(async ({ req, params, session }) => {
  const project = await resolveProject(params.id);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.edit", {
    projectId: project.id,
  });
  // Build/upload pipelines key on sourceRepoId — that's giteaRepoId or
  // (legacy) the wrapper id if source isn't tracked yet.
  const projectId =
    project.giteaRepoId ?? project.giteaWrapperRepoId ?? project.id;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(400, {
      error: "invalid-name",
      details: "Body is not multipart/form-data.",
    });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return errorResponse(400, {
      error: "invalid-name",
      details: 'Form field "file" is missing or not a file.',
    });
  }
  const blob = file as File;
  const buf = new Uint8Array(await blob.arrayBuffer());

  const result = validateUpload({
    filename: blob.name || "upload",
    content: buf,
    sizeLimitBytes: resolveUploadMax(),
  });
  if (!result.ok) {
    // SECURITY.md §6: log every rejected upload so operators can spot
    // probing patterns. Fire-and-forget — the rejection response goes
    // out either way.
    void getSharedAuditLogger()
      .log({
        event: "upload_rejected",
        projectId,
        filename: blob.name || "upload",
        size: buf.byteLength,
        reason: result.error,
      })
      .catch(() => undefined);
    return errorResponse(400, result);
  }

  // Persist to /data/projects/<id>/public/<safeName>.
  const root = resolveProjectsRoot();
  const dest = path.join(root, projectId, "public", result.safeName);
  try {
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buf);
  } catch (err) {
    return errorResponse(500, {
      error: "io",
      details: `Failed to write upload: ${(err as Error).message}`,
    });
  }

  return NextResponse.json({
    path: `/${result.safeName}`,
    size: result.size,
    mime: result.mime,
  });
});
