import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const snapshots = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  commitHash: text("commit_hash").notNull(),
  lastMessageId: uuid("last_message_id"),
  title: text("title"),
  isMilestone: boolean("is_milestone").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
