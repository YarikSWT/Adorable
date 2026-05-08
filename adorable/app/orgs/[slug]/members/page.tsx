import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";
import { getRequestSession } from "@/lib/auth/session";
import { getOrganizationAccessContext } from "@/lib/auth/authorization";
import { OrgMembersClient } from "./members-client";

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getRequestSession();
  if (!session) redirect(`/login?from=/orgs/${slug}/members`);
  const orgRow = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  const org = orgRow[0];
  if (!org || org.type === "personal") {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Организация не найдена.
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
  const canManage = access.permissions.has("organization.members.manage");

  const memberRows = await db
    .select({
      userId: organizationMembers.userId,
      email: users.email,
      name: users.name,
      role: roles.slug,
      joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(eq(organizationMembers.organizationId, org.id));

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Members — {org.name}</h1>
      <OrgMembersClient
        orgId={org.id}
        initialMembers={memberRows.map((m) => ({
          userId: m.userId,
          email: m.email ?? null,
          name: m.name ?? null,
          role: m.role,
          joinedAt: m.joinedAt.toISOString(),
        }))}
        currentUserId={session.user.id}
        canManage={canManage}
      />
    </div>
  );
}
