import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/roles";
import { AdminUserActions } from "./user-actions";

export default async function AdminUserCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const u = rows[0];
  if (!u) {
    return (
      <div className="text-sm text-muted-foreground">Юзер не найден.</div>
    );
  }

  const orgRows = await db
    .select({
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      orgType: organizations.type,
      role: roles.slug,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(eq(organizationMembers.userId, id));

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/users"
        className="mb-3 inline-block text-xs text-muted-foreground hover:text-foreground"
      >
        ← Юзеры
      </Link>
      <h1 className="mb-1 text-lg font-semibold">{u.name ?? u.email}</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        {u.email} · status={u.status} · verified={u.emailVerified ? "yes" : "no"}
        {u.isAdmin ? " · admin" : ""}
      </p>

      <h2 className="mb-2 text-sm font-semibold">Организации</h2>
      <div className="mb-6 overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Имя</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Роль</th>
            </tr>
          </thead>
          <tbody>
            {orgRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-muted-foreground">
                  Нет организаций.
                </td>
              </tr>
            ) : (
              orgRows.map((o) => (
                <tr key={o.orgId} className="border-t border-border/40">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/orgs/${o.orgId}`}
                      className="text-primary hover:underline"
                    >
                      {o.orgName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{o.orgType}</td>
                  <td className="px-3 py-2 text-xs">{o.role}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AdminUserActions
        userId={u.id}
        currentEmail={u.email}
        currentStatus={u.status}
      />
    </div>
  );
}
