import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { getRequestSession } from "@/lib/auth/session";
import { getProjectAccessContext } from "@/lib/auth/authorization";
import { ProjectSettingsSidebar } from "./sidebar";

export default async function ProjectSettingsLayout({
  children,
  params,
}: LayoutProps<"/projects/[id]/settings">) {
  const { id } = await params;
  const session = await getRequestSession();
  if (!session) redirect(`/login?from=/projects/${id}/settings/general`);

  const rows = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  const project = rows[0];
  if (!project) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Project not found.
      </div>
    );
  }
  const access = await getProjectAccessContext(session.user.id, project.id);
  if (!access) {
    // Same body whether the project doesn't exist or the user has no access —
    // avoids leaking project existence (Doc 2 §9.4).
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ←
        </Link>
        <span className="text-sm font-semibold">{project.name}</span>
        <span className="text-xs text-muted-foreground">/ Settings</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-56 shrink-0 border-r border-border/40">
          <ProjectSettingsSidebar projectId={project.id} />
        </aside>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
