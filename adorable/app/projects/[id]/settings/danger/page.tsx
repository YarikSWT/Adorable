import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { DangerZoneClient } from "./danger-client";

export default async function DangerZonePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  const project = rows[0];
  if (!project) return null;
  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">Danger Zone</h1>
      <DangerZoneClient projectId={project.id} projectName={project.name} />
    </div>
  );
}
