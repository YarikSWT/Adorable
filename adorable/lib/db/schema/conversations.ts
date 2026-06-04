// conversations — транскрипт переезжает из Gitea meta-репо в Postgres (спец v2.1 §3.2).
// Одна строка на цепочку чата проекта. Сообщения — в messages.ts.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byProject: index("conversations_project_idx").on(t.projectId, t.createdAt),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
