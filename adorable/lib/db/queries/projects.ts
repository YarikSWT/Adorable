// Project-scoped query helpers.
//
// URL contract (Doc 2 §7.4 + Appendix A): the `repoId` URL param under
// `/api/repos/:repoId/*` is the *Gitea wrapper repo id* — the one wrapper-repo
// metadata.json is stored in. We keep that contract here so existing client
// code keeps working; getProjectByGiteaWrapperId is the canonical lookup
// from URL → DB row.
//
// listProjectsForUser unions: persona-org membership (default project role
// from org-role) AND explicit project_members rows. Either path counts —
// dedup by project.id.

import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db/client";
import { projectMembers, projects } from "@/lib/db/schema/projects";
import { organizationMembers } from "@/lib/db/schema/organizations";

type DbOrTx = typeof defaultDb;

export type ProjectRow = typeof projects.$inferSelect;

export const getProjectByGiteaWrapperId = async (
  giteaWrapperRepoId: string,
  database: DbOrTx = defaultDb,
): Promise<ProjectRow | null> => {
  const rows = await database
    .select()
    .from(projects)
    .where(eq(projects.giteaWrapperRepoId, giteaWrapperRepoId))
    .limit(1);
  if (rows[0]) return rows[0];
  // Wrapper-less projects (after the metadata→Postgres migration) use their
  // project uuid as the external repoId token. Guard so a non-uuid token
  // (legacy wrapper id) can't error the uuid-typed query.
  if (!UUID_RE.test(giteaWrapperRepoId)) return null;
  const byId = await database
    .select()
    .from(projects)
    .where(eq(projects.id, giteaWrapperRepoId))
    .limit(1);
  return byId[0] ?? null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the external `repoId` URL token → project. Legacy projects use their
 * Gitea wrapper repo id; wrapper-less projects (after the metadata→Postgres
 * migration) use their project uuid directly. Tries the wrapper id first, then
 * the project uuid (guarded so a non-uuid token can't error the query).
 */
export const getProjectByExternalRepoId = async (
  repoId: string,
  database: DbOrTx = defaultDb,
): Promise<ProjectRow | null> => {
  const byWrapper = await getProjectByGiteaWrapperId(repoId, database);
  if (byWrapper) return byWrapper;
  if (!UUID_RE.test(repoId)) return null;
  const rows = await database
    .select()
    .from(projects)
    .where(eq(projects.id, repoId))
    .limit(1);
  return rows[0] ?? null;
};

export const getProjectByGiteaWrapperName = async (
  giteaWrapperRepoName: string,
  database: DbOrTx = defaultDb,
): Promise<ProjectRow | null> => {
  const rows = await database
    .select()
    .from(projects)
    .where(eq(projects.giteaWrapperRepoName, giteaWrapperRepoName))
    .limit(1);
  return rows[0] ?? null;
};

type ListProjectsOptions = {
  status?: "active" | "archived" | "deleted";
};

export const listProjectsForUser = async (
  userId: string,
  opts: ListProjectsOptions = {},
  database: DbOrTx = defaultDb,
): Promise<ProjectRow[]> => {
  const status = opts.status ?? "active";

  // Two independent paths — collect projectId sets and union them.
  const orgMembership = await database
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
  const orgIds = orgMembership.map((r) => r.organizationId);

  const explicit = await database
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  const explicitIds = explicit.map((r) => r.projectId);

  if (orgIds.length === 0 && explicitIds.length === 0) return [];

  const conditions = [];
  if (orgIds.length > 0) {
    conditions.push(inArray(projects.organizationId, orgIds));
  }
  if (explicitIds.length > 0) {
    conditions.push(inArray(projects.id, explicitIds));
  }
  const where =
    conditions.length === 1
      ? and(eq(projects.status, status), conditions[0])
      : and(eq(projects.status, status), or(...conditions));

  return database
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.updatedAt));
};
