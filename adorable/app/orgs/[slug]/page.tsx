import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { plans, subscriptions } from "@/lib/db/schema/billing";
import { projects } from "@/lib/db/schema/projects";
import { getRequestSession } from "@/lib/auth/session";
import { getOrganizationAccessContext } from "@/lib/auth/authorization";

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getRequestSession();
  if (!session) redirect(`/login?from=/orgs/${slug}`);
  const orgRows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  const org = orgRows[0];
  if (!org) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Организация не найдена.
      </div>
    );
  }
  if (org.type === "personal") {
    // Doc 3 §7.1: personal-org has no overview / settings / members surface.
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Эта страница доступна только для team-организаций. Личные проекты —
        на главной.
      </div>
    );
  }
  const access = await getOrganizationAccessContext(session.user.id, org.id);
  if (!access) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Организация не найдена.
      </div>
    );
  }

  const projectCountRow = await db
    .select({ n: count() })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, org.id),
        eq(projects.status, "active"),
      ),
    );
  const memberCountRow = await db
    .select({ n: count() })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, org.id));
  const subRow = await db
    .select({ planSlug: plans.slug })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.organizationId, org.id),
        eq(subscriptions.status, "active"),
      ),
    )
    .limit(1);

  const recentProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      updatedAt: projects.updatedAt,
      giteaWrapperRepoId: projects.giteaWrapperRepoId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, org.id),
        eq(projects.status, "active"),
      ),
    )
    .orderBy(desc(projects.updatedAt))
    .limit(5);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{org.name}</h1>
        <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">
          team
        </span>
        <span className="text-xs text-muted-foreground">{org.slug}</span>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/orgs/${org.slug}/members`}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            Members
          </Link>
          <Link
            href={`/orgs/${org.slug}/settings`}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            Settings
          </Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Проекты" value={String(projectCountRow[0]?.n ?? 0)} />
        <Stat label="Участники" value={String(memberCountRow[0]?.n ?? 0)} />
        <Stat label="План" value={subRow[0]?.planSlug ?? "—"} />
      </div>

      <h2 className="mb-2 text-sm font-semibold">Последние проекты</h2>
      <div className="overflow-hidden rounded-md border border-border/40">
        {recentProjects.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            Пока нет проектов.
          </div>
        ) : (
          <ul>
            {recentProjects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between border-b border-border/40 px-3 py-2 text-sm last:border-b-0"
              >
                <span>{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(p.updatedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
