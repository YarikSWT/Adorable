import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";

export const auditLog = pgTable(
  "audit_log",
  {
    // UUID v7 — generated in code via uuidv7().
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    organizationId: uuid("organization_id").references(() => organizations.id),
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byActor: index("audit_actor_ts_idx").on(t.actorUserId, t.createdAt),
    byTarget: index("audit_target_ts_idx").on(
      t.targetType,
      t.targetId,
      t.createdAt,
    ),
    byOrg: index("audit_org_ts_idx").on(t.organizationId, t.createdAt),
  }),
);
