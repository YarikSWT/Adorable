import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { snapshots } from "@/lib/db/schema/publication";
import { PublicationClient } from "./publication-client";

export default async function PublicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rows = await db
    .select({
      id: projects.id,
      giteaWrapperRepoId: projects.giteaWrapperRepoId,
      previewSubdomain: projects.previewSubdomain,
      publishedVisibility: projects.publishedVisibility,
      publishedAt: projects.publishedAt,
      publishedSnapshotId: projects.publishedSnapshotId,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  const project = rows[0];
  if (!project) return null;

  let snapshotCommit: string | null = null;
  if (project.publishedSnapshotId) {
    const snap = await db
      .select({ commitHash: snapshots.commitHash })
      .from(snapshots)
      .where(eq(snapshots.id, project.publishedSnapshotId))
      .limit(1);
    snapshotCommit = snap[0]?.commitHash ?? null;
  }

  const wrapperId = project.giteaWrapperRepoId ?? project.id;
  const previewHost = process.env["PREVIEW_DOMAIN_SUFFIX"] ?? "preview.localhost";
  const previewPort = process.env["PREVIEW_PUBLIC_PORT"] ??
    process.env["CADDY_HTTP_PORT"] ??
    "";
  const previewUrl = project.previewSubdomain
    ? `http://${project.previewSubdomain}.${previewHost}${previewPort ? `:${previewPort}` : ""}`
    : null;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Публикация</h1>
      <PublicationClient
        repoId={wrapperId}
        published={Boolean(project.publishedSnapshotId)}
        visibility={project.publishedVisibility ?? null}
        publishedAt={
          project.publishedAt ? project.publishedAt.toISOString() : null
        }
        commitHash={snapshotCommit}
        previewUrl={previewUrl}
      />
      <div className="mt-6 rounded-md border border-border/40 p-4 text-xs text-muted-foreground">
        <strong>Уровни видимости:</strong>{" "}
        <code>authenticated</code> и <code>private</code> требуют от
        посетителей подтверждённого email; <code>public</code> доступен всем.
      </div>
    </div>
  );
}
