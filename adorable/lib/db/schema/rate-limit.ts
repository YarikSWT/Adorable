// Better Auth's rate-limit storage backing table. Used when the auth instance
// is configured with `rateLimit.storage: "database"` (prod). Schema matches
// what Better Auth's adapter writes — a string `key` + integer `count` +
// timestamp `lastRequest`.

import { bigint, pgTable, text } from "drizzle-orm/pg-core";

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  count: bigint("count", { mode: "number" }).notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
