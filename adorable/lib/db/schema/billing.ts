import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";
import { projects } from "./projects";

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  limits: jsonb("limits").$type<Record<string, number>>().notNull(),
  features: jsonb("features").$type<Record<string, unknown>>(),
  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    status: text("status", {
      enum: ["active", "past_due", "canceled", "expired"],
    }).notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),
    provider: text("provider").notNull().default("manual"),
    providerSubscriptionId: text("provider_subscription_id"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqActive: uniqueIndex("subs_one_active_per_org")
      .on(t.organizationId)
      .where(sql`${t.status} = 'active'`),
  }),
);

export const planOverrides = pgTable(
  "plan_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    limits: jsonb("limits").$type<Record<string, number>>().notNull(),
    reason: text("reason"),
    grantedBy: uuid("granted_by").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byOrg: index("plan_overrides_org_idx").on(t.organizationId),
  }),
);

export const usageEvents = pgTable(
  "usage_events",
  {
    // UUID v7 — generated in code via uuidv7(), not defaultRandom().
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    projectId: uuid("project_id").references(() => projects.id),
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    unit: text("unit").notNull(),
    costCents: integer("cost_cents"),
    model: text("model"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byOrgKindTs: index("usage_events_org_kind_ts_idx").on(
      t.organizationId,
      t.kind,
      t.createdAt,
    ),
  }),
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    kind: text("kind").notNull(),
    used: numeric("used", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.periodStart, t.kind] }),
  }),
);
