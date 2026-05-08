import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";
import { roles } from "./roles";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    // Gitea bindings — both source repo and wrapper repo IDs/names. Wrapper
    // continues to hold metadata/conversations (see ADR-016) while ownership
    // and access live in this table.
    //
    // Spec §2.5 sketched these as bigint; our Gitea adapter actually returns
    // string IDs of the form `<owner>/<name>` (existing fork behaviour), so
    // the columns are text() and store that opaque token. URL routing keeps
    // working because the same string round-trips through the encoded URL
    // segment.
    giteaRepoId: text("gitea_repo_id"),
    giteaRepoName: text("gitea_repo_name"),
    giteaWrapperRepoId: text("gitea_wrapper_repo_id"),
    giteaWrapperRepoName: text("gitea_wrapper_repo_name"),

    previewSubdomain: text("preview_subdomain").unique(),
    previewSubdomainLocked: boolean("preview_subdomain_locked")
      .notNull()
      .default(false),
    memory: text("memory").notNull().default(""),
    dataBackend: jsonb("data_backend"),
    status: text("status", { enum: ["active", "archived", "deleted"] })
      .notNull()
      .default("active"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    // Publication fields (see publication.ts for snapshot reference). FK on
    // publishedSnapshotId is added through a separate ALTER migration to
    // avoid the projects ↔ snapshots circular import.
    publishedVisibility: text("published_visibility", {
      enum: ["private", "authenticated", "public"],
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedSnapshotId: uuid("published_snapshot_id"),
    publishedBy: uuid("published_by").references(() => users.id),
    customDomain: text("custom_domain"),
    customDomainStatus: text("custom_domain_status", {
      enum: ["pending", "verified", "live", "failed"],
    }),
    customDomainVerifiedAt: timestamp("custom_domain_verified_at", {
      withTimezone: true,
    }),
  },
  (t) => ({
    uniqOrgSlug: uniqueIndex("projects_org_slug_uq").on(
      t.organizationId,
      t.slug,
    ),
    byOrgStatus: index("projects_org_status_idx").on(
      t.organizationId,
      t.status,
    ),
  }),
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    invitedBy: uuid("invited_by").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
    byUser: index("project_members_user_idx").on(t.userId),
  }),
);
