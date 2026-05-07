// Authorization helpers — single source of truth for "what can this user do
// to this project / organization?"
//
// Effective project role rule (Doc 2 §5.2 + Правка 1):
//   1. Default project role = the org-role's `defaultProjectRoleId`.
//   2. Explicit project role = `project_members` row, if any.
//   3. If only one is present, take it.
//   4. If both are present and one is a permission-superset of the other,
//      take the superset (so explicit can upgrade default but not downgrade).
//   5. If neither is a superset (incomparable sets), the EXPLICIT role wins —
//      it's an admin's deliberate decision and we never silently union
//      permissions across roles.
//
// requirePermission throws HttpError(403) on failure. Callers should pass
// `{ projectId }` for project-scoped checks and `{ organizationId }` for
// org-scoped ones; admin-scope uses the dedicated requireAdminPermission.

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db/client";
import { permissions, rolePermissions, roles } from "@/lib/db/schema/roles";
import {
  adminRoleAssignments,
  organizationMembers,
} from "@/lib/db/schema/organizations";
import { projectMembers, projects } from "@/lib/db/schema/projects";
import { users } from "@/lib/db/schema/users";
import { HttpError } from "./errors";

type DbOrTx = typeof defaultDb;

export type ProjectAccessContext = {
  projectId: string;
  organizationId: string;
  effectiveRoleId: string;
  permissions: Set<string>;
};

export type OrganizationAccessContext = {
  organizationId: string;
  roleId: string;
  permissions: Set<string>;
};

export const isSuperset = <T>(a: Set<T>, b: Set<T>): boolean => {
  if (a.size < b.size) return false;
  for (const x of b) if (!a.has(x)) return false;
  return true;
};

export const loadRolePermissions = async (
  roleIds: readonly string[],
  database: DbOrTx = defaultDb,
): Promise<Map<string, Set<string>>> => {
  const out = new Map<string, Set<string>>();
  if (roleIds.length === 0) return out;
  const rows = await database
    .select({
      roleId: rolePermissions.roleId,
      slug: permissions.slug,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, [...roleIds]));
  for (const id of roleIds) out.set(id, new Set<string>());
  for (const row of rows) {
    const set = out.get(row.roleId);
    if (set) set.add(row.slug);
  }
  return out;
};

export const getProjectAccessContext = async (
  userId: string,
  projectId: string,
  database: DbOrTx = defaultDb,
): Promise<ProjectAccessContext | null> => {
  const project = await database
    .select({ id: projects.id, organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project[0]) return null;

  const orgMember = await database
    .select({ roleId: organizationMembers.roleId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, project[0].organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!orgMember[0]) return null;

  const orgRole = await database
    .select({ defaultProjectRoleId: roles.defaultProjectRoleId })
    .from(roles)
    .where(eq(roles.id, orgMember[0].roleId))
    .limit(1);
  const defaultProjectRoleId = orgRole[0]?.defaultProjectRoleId ?? null;

  const explicit = await database
    .select({ roleId: projectMembers.roleId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);

  const candidateRoleIds = [
    defaultProjectRoleId,
    explicit[0]?.roleId ?? null,
  ].filter((id): id is string => Boolean(id));
  if (candidateRoleIds.length === 0) return null;

  const permsByRole = await loadRolePermissions(candidateRoleIds, database);

  let bestRoleId: string;
  let bestPerms: Set<string>;

  if (candidateRoleIds.length === 1) {
    bestRoleId = candidateRoleIds[0];
    bestPerms = permsByRole.get(bestRoleId) ?? new Set();
  } else {
    const defaultId = defaultProjectRoleId!;
    const explicitId = explicit[0]!.roleId;
    const defaultPerms = permsByRole.get(defaultId) ?? new Set<string>();
    const explicitPerms = permsByRole.get(explicitId) ?? new Set<string>();

    if (isSuperset(explicitPerms, defaultPerms)) {
      bestRoleId = explicitId;
      bestPerms = explicitPerms;
    } else if (isSuperset(defaultPerms, explicitPerms)) {
      bestRoleId = defaultId;
      bestPerms = defaultPerms;
    } else {
      // Incomparable — admin's explicit pick wins.
      bestRoleId = explicitId;
      bestPerms = explicitPerms;
    }
  }

  return {
    projectId,
    organizationId: project[0].organizationId,
    effectiveRoleId: bestRoleId,
    permissions: bestPerms,
  };
};

export const getOrganizationAccessContext = async (
  userId: string,
  organizationId: string,
  database: DbOrTx = defaultDb,
): Promise<OrganizationAccessContext | null> => {
  const member = await database
    .select({ roleId: organizationMembers.roleId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!member[0]) return null;
  const perms = await loadRolePermissions([member[0].roleId], database);
  return {
    organizationId,
    roleId: member[0].roleId,
    permissions: perms.get(member[0].roleId) ?? new Set<string>(),
  };
};

type RequirePermissionCtx = {
  projectId?: string;
  organizationId?: string;
};

export async function requirePermission(
  userId: string,
  permissionSlug: string,
  ctx: { projectId: string },
  database?: DbOrTx,
): Promise<ProjectAccessContext>;
export async function requirePermission(
  userId: string,
  permissionSlug: string,
  ctx: { organizationId: string },
  database?: DbOrTx,
): Promise<OrganizationAccessContext>;
export async function requirePermission(
  userId: string,
  permissionSlug: string,
  ctx: RequirePermissionCtx,
  database: DbOrTx = defaultDb,
): Promise<ProjectAccessContext | OrganizationAccessContext> {
  if (ctx.projectId) {
    const access = await getProjectAccessContext(userId, ctx.projectId, database);
    if (!access) {
      // 404 not 403 — avoid leaking project existence to non-members.
      throw new HttpError(404, "not_found", "Project not found");
    }
    if (!access.permissions.has(permissionSlug)) {
      throw new HttpError(
        403,
        "access.denied",
        `Missing permission ${permissionSlug}`,
      );
    }
    return access;
  }
  if (ctx.organizationId) {
    const access = await getOrganizationAccessContext(
      userId,
      ctx.organizationId,
      database,
    );
    if (!access) {
      throw new HttpError(404, "not_found", "Organization not found");
    }
    if (!access.permissions.has(permissionSlug)) {
      throw new HttpError(
        403,
        "access.denied",
        `Missing permission ${permissionSlug}`,
      );
    }
    return access;
  }
  throw new Error("requirePermission needs project or org context");
}

export const requireAdminPermission = async (
  userId: string,
  permissionSlug: string,
  database: DbOrTx = defaultDb,
): Promise<void> => {
  const u = await database
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u[0]?.isAdmin) {
    throw new HttpError(403, "access.denied", "Admin access required");
  }
  const adminRoles = await database
    .select({ roleId: adminRoleAssignments.roleId })
    .from(adminRoleAssignments)
    .where(
      and(
        eq(adminRoleAssignments.userId, userId),
        or(
          isNull(adminRoleAssignments.expiresAt),
          gt(adminRoleAssignments.expiresAt, new Date()),
        ),
      ),
    );
  if (adminRoles.length === 0) {
    throw new HttpError(403, "access.denied", "No active admin role");
  }
  const perms = await loadRolePermissions(
    adminRoles.map((r) => r.roleId),
    database,
  );
  for (const set of perms.values()) {
    if (set.has(permissionSlug)) return;
  }
  throw new HttpError(
    403,
    "access.denied",
    `Missing admin permission ${permissionSlug}`,
  );
};
