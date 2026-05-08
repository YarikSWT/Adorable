import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { GeneralSettingsForm } from "./general-form";

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      slug: projects.slug,
      previewSubdomainLocked: projects.previewSubdomainLocked,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  const project = rows[0];
  if (!project) return null;

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">General</h1>
      <GeneralSettingsForm
        projectId={project.id}
        initialName={project.name}
        initialDescription={project.description ?? ""}
        initialSlug={project.slug}
        slugLocked={project.previewSubdomainLocked}
      />
    </div>
  );
}
