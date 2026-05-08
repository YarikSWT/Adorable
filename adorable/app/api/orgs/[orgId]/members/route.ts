import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  organizationMembers,
} from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";

type Params = { orgId: string };

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  await requirePermission(session.user.id, "organization.view", {
    organizationId: params.orgId,
  });
  const rows = await db
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
    .where(eq(organizationMembers.organizationId, params.orgId))
    .orderBy(asc(organizationMembers.joinedAt));
  return NextResponse.json({ members: rows });
});
