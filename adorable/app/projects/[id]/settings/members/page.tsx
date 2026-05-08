import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projectMembers, projects } from "@/lib/db/schema/projects";
import { organizationMembers } from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";
import { MembersAddStub } from "./members-add-stub";

type MemberRow = {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  origin: "explicit" | "organization";
};

export default async function ProjectMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await db
    .select({ id: projects.id, organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project[0]) return null;

  const explicit = await db
    .select({
      userId: projectMembers.userId,
      email: users.email,
      name: users.name,
      role: roles.slug,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(roles, eq(roles.id, projectMembers.roleId))
    .where(eq(projectMembers.projectId, project[0].id));

  const orgMembers = await db
    .select({
      userId: organizationMembers.userId,
      email: users.email,
      name: users.name,
      role: roles.slug,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(
      eq(organizationMembers.organizationId, project[0].organizationId),
    );

  const explicitIds = new Set(explicit.map((r) => r.userId));
  const rows: MemberRow[] = [
    ...explicit.map((r) => ({ ...r, origin: "explicit" as const })),
    ...orgMembers
      .filter((r) => !explicitIds.has(r.userId))
      .map((r) => ({ ...r, origin: "organization" as const })),
  ];

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Members</h1>
        <MembersAddStub />
      </div>
      <div className="overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Имя / email</th>
              <th className="px-3 py-2">Роль</th>
              <th className="px-3 py-2">Источник</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.userId}-${r.origin}`} className="border-t border-border/40">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.name ?? r.email ?? "—"}</div>
                  {r.name && r.email ? (
                    <div className="text-xs text-muted-foreground">
                      {r.email}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">
                    {r.role}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.origin === "explicit" ? "Явно" : "Через организацию"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

void and; // kept in case future filters need ANDed conditions.
