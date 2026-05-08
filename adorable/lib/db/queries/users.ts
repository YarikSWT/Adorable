// User-scoped query helpers.
//
// `getDefaultPersonalOrgId` finds the persona-org Phase 4's bootstrap created
// for the user. When the body of /api/repos POST omits `organizationId`, this
// is what we fall back to.

import { and, eq } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db/client";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";

type DbOrTx = typeof defaultDb;

export const getDefaultPersonalOrgId = async (
  userId: string,
  database: DbOrTx = defaultDb,
): Promise<string | null> => {
  const rows = await database
    .select({ id: organizations.id })
    .from(organizations)
    .innerJoin(
      organizationMembers,
      eq(organizationMembers.organizationId, organizations.id),
    )
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizations.type, "personal"),
        eq(organizations.ownerUserId, userId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
};

export const getUserOrganizations = async (
  userId: string,
  database: DbOrTx = defaultDb,
): Promise<
  {
    id: string;
    type: "personal" | "team";
    slug: string;
    name: string;
    roleId: string;
  }[]
> => {
  const rows = await database
    .select({
      id: organizations.id,
      type: organizations.type,
      slug: organizations.slug,
      name: organizations.name,
      roleId: organizationMembers.roleId,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .where(eq(organizationMembers.userId, userId));
  return rows as {
    id: string;
    type: "personal" | "team";
    slug: string;
    name: string;
    roleId: string;
  }[];
};
