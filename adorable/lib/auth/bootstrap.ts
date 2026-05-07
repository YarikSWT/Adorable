// Per-user bootstrap: persona-org + org_owner membership + free subscription.
//
// Runs once per user — wired into Better Auth's after.signUpEmail and the
// oauthCallback (the latter only fires for isNewUser=true). Idempotent on the
// org side via a slug uniqueness check; subscription side is guarded by the
// `subs_one_active_per_org` partial unique index.

import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db/client";
import { organizationMembers, organizations } from "@/lib/db/schema/organizations";
import { plans, subscriptions } from "@/lib/db/schema/billing";
import { roles } from "@/lib/db/schema/roles";

// We accept both the top-level db handle and a PgTransaction inside callbacks.
// Drizzle's tx parameter has a different concrete type than the root client,
// but both expose the same query/insert API surface we use here.
type DbOrTx = Parameters<Parameters<typeof defaultDb.transaction>[0]>[0] | typeof defaultDb;

export type BootstrapContext = {
  // Anything Better Auth's after-hook may want to forward (display name, email,
  // request metadata). Keep it as `unknown` — the bootstrap doesn't depend on
  // the exact ctx shape, only on what the caller passes through `userName`.
  userName?: string | null;
};

const SLUG_MAX_BASE = 24;

const slugify = (raw: string): string => {
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, SLUG_MAX_BASE) || "user";
};

const randomSuffix = (): string => {
  // 6 lowercase alphanumeric chars — small enough not to bloat the URL,
  // large enough that collisions are vanishingly rare for personal orgs.
  return Math.random().toString(36).slice(2, 8);
};

export const generateUniqueSlug = async (
  tx: DbOrTx,
  base: string,
): Promise<string> => {
  const baseSlug = slugify(base);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${randomSuffix()}`;
    const existing = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  // Last resort — append timestamp; effectively impossible to clash.
  return `${baseSlug}-${Date.now().toString(36)}`;
};

export const bootstrapNewUser = async (
  userId: string,
  ctx: BootstrapContext = {},
  database: DbOrTx = defaultDb,
): Promise<{ organizationId: string; subscriptionId: string }> => {
  return database.transaction(async (tx) => {
    // 1. resolve required reference data
    const ownerRole = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.scope, "organization"), eq(roles.slug, "owner")))
      .limit(1);
    if (!ownerRole[0]) {
      throw new Error(
        "[bootstrap] organization.owner role missing — run db:seed first",
      );
    }
    const orgOwnerRoleId = ownerRole[0].id;

    const freePlan = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.slug, "free"))
      .limit(1);
    if (!freePlan[0]) {
      throw new Error(
        "[bootstrap] free plan missing — run db:seed first",
      );
    }
    const freePlanId = freePlan[0].id;

    // 2. organization
    const baseName = ctx.userName?.trim() || "Personal";
    const slug = await generateUniqueSlug(tx, baseName);
    const [org] = await tx
      .insert(organizations)
      .values({
        type: "personal",
        slug,
        name: baseName,
        ownerUserId: userId,
      })
      .returning({ id: organizations.id });

    // 3. owner membership
    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId,
      roleId: orgOwnerRoleId,
    });

    // 4. free subscription, one month rolling period
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        organizationId: org.id,
        planId: freePlanId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        provider: "manual",
      })
      .returning({ id: subscriptions.id });

    return { organizationId: org.id, subscriptionId: sub.id };
  });
};

// Used by the after-hook: silently no-op if the user already has at least one
// org. This makes the hook idempotent against weird Better Auth retries and
// against re-runs when bootstrap is wired into oauthCallback (where the
// `isNewUser` guard could in theory be wrong).
export const bootstrapNewUserIfMissing = async (
  userId: string,
  ctx: BootstrapContext = {},
  database: DbOrTx = defaultDb,
): Promise<{ organizationId: string; subscriptionId: string } | null> => {
  const existing = await database
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);
  if (existing[0]) return null;
  return bootstrapNewUser(userId, ctx, database);
};

// Re-export sql so the test file can build raw filters without re-importing
// drizzle-orm directly when it only needs us as the bootstrap entry point.
export { sql };
