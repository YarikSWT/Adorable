import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { snapshots } from "@/lib/db/schema/publication";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";
import { readRepoMetadata } from "@/lib/repo-storage";

type Params = { repoId: string };
type Body = {
  visibility?: string;
  commitHash?: string;
};

const ALLOWED_VISIBILITY = new Set(["private", "authenticated", "public"]);
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const generateSubdomain = (slug: string): string => {
  const base = (slug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const safe = SUBDOMAIN_RE.test(base) ? base : "site";
  // 6-char alnum suffix to avoid clashes between projects with the same slug
  // across different orgs. Subdomains are globally unique (UNIQUE on
  // projects.preview_subdomain); pre-checking on conflict happens below.
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safe}-${suffix}`;
};

// POST /api/repos/:repoId/promote — publishes the project per Doc 2 §7.7.
//   1. requirePermission(project.publish)
//   2. Ensure preview_subdomain is set + locked.
//   3. Insert a `snapshots` row (commit_hash from body or "HEAD" placeholder
//      until the build pipeline supplies the actual one).
//   4. Update projects: published_visibility, published_at,
//      published_snapshot_id, published_by.
//   5. audit_log entry.
export const POST = protectedRoute<Params>(async ({ req, params, session }) => {
  const decoded = decodeURIComponent(params.repoId);
  const project = await getProjectByGiteaWrapperId(decoded);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.publish", {
    projectId: project.id,
  });

  const body = (await req.json().catch(() => ({}))) as Body;
  const visibilityInput = (body.visibility ?? "private")
    .trim()
    .toLowerCase();
  if (!ALLOWED_VISIBILITY.has(visibilityInput)) {
    throw new HttpError(400, "validation.failed", "Invalid visibility");
  }

  // Subdomain assignment + lock (§7.7 step 4).
  let previewSubdomain = project.previewSubdomain;
  if (!previewSubdomain) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateSubdomain(project.slug);
      const conflict = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.previewSubdomain, candidate))
        .limit(1);
      if (!conflict[0]) {
        previewSubdomain = candidate;
        break;
      }
    }
    if (!previewSubdomain) {
      throw new Error("[promote] could not allocate a unique subdomain");
    }
  }

  // commit_hash: prefer body-supplied value (UI later wires the build
  // pipeline), otherwise fall back to "HEAD" so the snapshot row stays
  // valid. Once Phase 4 of preview-pipeline lands we can pull HEAD from
  // the git provider directly.
  const metadata = await readRepoMetadata(decoded).catch(() => null);
  const commitHash =
    (typeof body.commitHash === "string" && body.commitHash.trim()) ||
    metadata?.boilerplateVersion ||
    "HEAD";

  const result = await db.transaction(async (tx) => {
    const [snapshot] = await tx
      .insert(snapshots)
      .values({
        projectId: project.id,
        commitHash,
      })
      .returning({ id: snapshots.id });
    const now = new Date();
    const [updated] = await tx
      .update(projects)
      .set({
        publishedVisibility: visibilityInput as
          | "private"
          | "authenticated"
          | "public",
        publishedAt: now,
        publishedSnapshotId: snapshot.id,
        publishedBy: session.user.id,
        previewSubdomain,
        previewSubdomainLocked: true,
        updatedAt: now,
      })
      .where(eq(projects.id, project.id))
      .returning({
        id: projects.id,
        publishedVisibility: projects.publishedVisibility,
        publishedAt: projects.publishedAt,
        publishedSnapshotId: projects.publishedSnapshotId,
        previewSubdomain: projects.previewSubdomain,
      });
    return { snapshot, project: updated };
  });

  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.publish",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
    metadata: { visibility: visibilityInput, snapshotId: result.snapshot.id },
  });

  return NextResponse.json({
    project: result.project,
    snapshotId: result.snapshot.id,
  });
});
