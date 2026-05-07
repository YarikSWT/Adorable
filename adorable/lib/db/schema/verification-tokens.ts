import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const verificationTokens = pgTable("verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Better Auth-required columns. `identifier` is the principal (typically the
  // email being verified or the user_id), `value` is the opaque token Better
  // Auth issues. These are the fields the adapter actually reads/writes.
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  // Domain-side metadata kept from spec §2.2; Better Auth ignores these but we
  // can use them in admin tooling once verification tokens are in flight.
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["email_verify", "password_reset"] }),
  tokenHash: text("token_hash").unique(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
