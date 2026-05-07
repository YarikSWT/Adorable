// Integration coverage for getProjectAccessContext / requirePermission.
// Gated on RUN_DB_TESTS=1; uses DATABASE_URL_TEST or DATABASE_URL.
//
// Each test creates fresh actors (random user, random org) so a single shared
// DB doesn't accumulate cross-test state. Cases mirror Doc 2 §9.2.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema/users";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { permissions, rolePermissions, roles } from "@/lib/db/schema/roles";
import { projectMembers, projects } from "@/lib/db/schema/projects";
import {
  getProjectAccessContext,
  requirePermission,
} from "@/lib/auth/authorization";

const enabled = process.env["RUN_DB_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

const url =
  process.env["DATABASE_URL_TEST"] ||
  process.env["DATABASE_URL"] ||
  "postgres://adorable:adorable_dev_password@localhost:5432/adorable";

const queryClient = enabled ? postgres(url, { max: 2 }) : null;
const db = enabled
  ? drizzle(queryClient!, { schema })
  : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);

afterAll(async () => {
  if (queryClient) await queryClient.end({ timeout: 5 });
});

const tagSuffix = () => Math.random().toString(36).slice(2, 8);

const insertUser = async (label: string): Promise<string> => {
  const tag = tagSuffix();
  const [u] = await db
    .insert(users)
    .values({
      email: `${label}-${tag}@example.com`,
      emailRaw: `${label}-${tag}@example.com`,
      emailVerified: true,
      name: `${label} ${tag}`,
    })
    .returning({ id: users.id });
  return u.id;
};

const getRoleId = async (
  scope: "organization" | "project" | "admin",
  slug: string,
): Promise<string> => {
  const r = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.scope, scope), eq(roles.slug, slug)))
    .limit(1);
  if (!r[0]) throw new Error(`role ${scope}.${slug} missing — seed first`);
  return r[0].id;
};

const insertOrg = async (
  ownerUserId: string,
  type: "personal" | "team" = "team",
): Promise<string> => {
  const tag = tagSuffix();
  const [o] = await db
    .insert(organizations)
    .values({
      type,
      slug: `authz-${type}-${tag}`,
      name: `Authz ${type} ${tag}`,
      ownerUserId,
    })
    .returning({ id: organizations.id });
  return o.id;
};

const insertOrgMember = async (
  organizationId: string,
  userId: string,
  roleSlug: "owner" | "admin" | "member",
): Promise<void> => {
  const roleId = await getRoleId("organization", roleSlug);
  await db
    .insert(organizationMembers)
    .values({ organizationId, userId, roleId });
};

const insertProject = async (
  organizationId: string,
  createdByUserId: string,
): Promise<string> => {
  const tag = tagSuffix();
  const [p] = await db
    .insert(projects)
    .values({
      organizationId,
      slug: `proj-${tag}`,
      name: `Project ${tag}`,
      createdByUserId,
    })
    .returning({ id: projects.id });
  return p.id;
};

const setExplicitProjectMember = async (
  projectId: string,
  userId: string,
  roleSlug: "viewer" | "editor" | "publisher" | "owner",
): Promise<void> => {
  const roleId = await getRoleId("project", roleSlug);
  await db.insert(projectMembers).values({ projectId, userId, roleId });
};

// Build a custom project-role with an arbitrary permission set, used for the
// "incomparable" case so we can guarantee neither role is a superset of the
// other.
const insertCustomProjectRole = async (
  slug: string,
  permSlugs: readonly string[],
): Promise<string> => {
  const tag = tagSuffix();
  const [role] = await db
    .insert(roles)
    .values({
      scope: "project",
      slug: `${slug}-${tag}`,
      name: slug,
      isSystem: false,
    })
    .returning({ id: roles.id });
  if (permSlugs.length > 0) {
    const permRows = await db
      .select({ id: permissions.id, slug: permissions.slug })
      .from(permissions);
    const wanted = permRows.filter((p) => permSlugs.includes(p.slug));
    if (wanted.length > 0) {
      await db
        .insert(rolePermissions)
        .values(wanted.map((p) => ({ roleId: role.id, permissionId: p.id })));
    }
  }
  return role.id;
};

d("authorization", () => {
  beforeAll(async () => {
    // Sanity: need seed data to exist.
    const owner = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.scope, "organization"), eq(roles.slug, "owner")))
      .limit(1);
    expect(owner[0], "Run npm run db:seed first").toBeDefined();
  });

  it("org-owner becomes effective project-owner on every project of own org", async () => {
    const ownerId = await insertUser("orgowner");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    const projectId = await insertProject(orgId, ownerId);

    const access = await getProjectAccessContext(ownerId, projectId, db);
    expect(access).not.toBeNull();
    const projectOwnerRoleId = await getRoleId("project", "owner");
    expect(access!.effectiveRoleId).toBe(projectOwnerRoleId);
    expect(access!.permissions.has("project.edit")).toBe(true);
    expect(access!.permissions.has("project.delete")).toBe(true);
    expect(access!.permissions.has("project.publish")).toBe(true);
  });

  it("org-member without explicit project role gets default project-viewer", async () => {
    const ownerId = await insertUser("orgowner");
    const memberId = await insertUser("orgmember");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    await insertOrgMember(orgId, memberId, "member");
    const projectId = await insertProject(orgId, ownerId);

    const access = await getProjectAccessContext(memberId, projectId, db);
    expect(access).not.toBeNull();
    const viewerId = await getRoleId("project", "viewer");
    expect(access!.effectiveRoleId).toBe(viewerId);
    expect([...access!.permissions]).toEqual(["project.view"]);
  });

  it("explicit project-publisher upgrades an org-member above the default viewer", async () => {
    const ownerId = await insertUser("orgowner");
    const memberId = await insertUser("orgmember");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    await insertOrgMember(orgId, memberId, "member");
    const projectId = await insertProject(orgId, ownerId);
    await setExplicitProjectMember(projectId, memberId, "publisher");

    const access = await getProjectAccessContext(memberId, projectId, db);
    expect(access).not.toBeNull();
    const publisherId = await getRoleId("project", "publisher");
    expect(access!.effectiveRoleId).toBe(publisherId);
    expect(access!.permissions.has("project.publish")).toBe(true);
  });

  it("explicit project-viewer cannot downgrade an org-owner (default-from-org wins)", async () => {
    const ownerId = await insertUser("orgowner");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    const projectId = await insertProject(orgId, ownerId);
    await setExplicitProjectMember(projectId, ownerId, "viewer");

    const access = await getProjectAccessContext(ownerId, projectId, db);
    expect(access).not.toBeNull();
    const projectOwnerRoleId = await getRoleId("project", "owner");
    expect(access!.effectiveRoleId).toBe(projectOwnerRoleId);
  });

  it("user outside org has no access to its projects", async () => {
    const ownerId = await insertUser("orgowner");
    const outsiderId = await insertUser("outsider");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    const projectId = await insertProject(orgId, ownerId);

    const access = await getProjectAccessContext(outsiderId, projectId, db);
    expect(access).toBeNull();
  });

  it("incomparable roles → explicit project role wins (no permission union)", async () => {
    const ownerId = await insertUser("orgowner");
    const memberId = await insertUser("orgmember");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    await insertOrgMember(orgId, memberId, "member");
    const projectId = await insertProject(orgId, ownerId);

    // Default-from-org for "member" is project.viewer → has project.view.
    // Custom explicit role: "data-only" with project.data.manage but NOT
    // project.view. Neither is a superset of the other.
    const customRoleId = await insertCustomProjectRole("data-only", [
      "project.data.manage",
    ]);
    await db
      .insert(projectMembers)
      .values({ projectId, userId: memberId, roleId: customRoleId });

    const access = await getProjectAccessContext(memberId, projectId, db);
    expect(access).not.toBeNull();
    expect(access!.effectiveRoleId).toBe(customRoleId);
    // Explicit perms only — no union with viewer's project.view.
    expect(access!.permissions.has("project.data.manage")).toBe(true);
    expect(access!.permissions.has("project.view")).toBe(false);
  });

  it("requirePermission returns access when granted, throws 403 otherwise", async () => {
    const ownerId = await insertUser("orgowner");
    const memberId = await insertUser("orgmember");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    await insertOrgMember(orgId, memberId, "member");
    const projectId = await insertProject(orgId, ownerId);

    const ok = await requirePermission(
      memberId,
      "project.view",
      { projectId },
      db,
    );
    expect(ok.permissions.has("project.view")).toBe(true);

    await expect(
      requirePermission(memberId, "project.delete", { projectId }, db),
    ).rejects.toMatchObject({ status: 403, code: "access.denied" });
  });

  it("requirePermission throws 404 (not 403) when user is not a member of the org", async () => {
    const ownerId = await insertUser("orgowner");
    const outsiderId = await insertUser("outsider");
    const orgId = await insertOrg(ownerId, "team");
    await insertOrgMember(orgId, ownerId, "owner");
    const projectId = await insertProject(orgId, ownerId);

    await expect(
      requirePermission(outsiderId, "project.view", { projectId }, db),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});
