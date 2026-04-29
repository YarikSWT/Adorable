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

import { NextResponse } from "next/server";

import { getOrCreateIdentitySession } from "@/lib/identity-session";
import {
  validateUpload,
  type UploadValidationErr,
} from "@/lib/preview/upload-validator";

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const projectId = decodeURIComponent(rawId);

  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  if (!repositories.some((r) => r.id === projectId)) {
    return errorResponse(403, { error: "Forbidden" });
  }

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
}
