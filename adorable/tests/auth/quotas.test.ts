// Integration tests for quotas.ts. Gated on RUN_DB_TESTS=1.
//
// Cases mirror Doc 2 §9.2:
//   - free-plan limit on llm.tokens.monthly
//   - override increases / overrides plan
//   - expired override is ignored
//   - absolute projects.max counted via count(*), not usage_counters

import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema/users";
import {
  organizationMembers,
  organizations,
} from "@/lib/db/schema/organizations";
import { roles } from "@/lib/db/schema/roles";
import { plans, planOverrides, subscriptions } from "@/lib/db/schema/billing";
import { projects } from "@/lib/db/schema/projects";
import {
  currentPeriodStartUTC,
  recordUsage,
  requireQuota,
  resolveLimit,
} from "@/lib/auth/quotas";

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

const tag = () => Math.random().toString(36).slice(2, 8);

const insertUser = async (): Promise<string> => {
  const t = tag();
  const [u] = await db
    .insert(users)
    .values({
      email: `quota-${t}@example.com`,
      emailRaw: `quota-${t}@example.com`,
      emailVerified: true,
      name: `Quota ${t}`,
    })
    .returning({ id: users.id });
  return u.id;
};

// Build a fresh org with active free subscription. Returns orgId.
const insertOrgWithFreeSub = async (ownerUserId: string): Promise<string> => {
  const t = tag();
  const freePlan = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.slug, "free"))
    .limit(1);
  if (!freePlan[0]) throw new Error("seed `free` plan first");

  const [org] = await db
    .insert(organizations)
    .values({
      type: "team",
      slug: `quota-org-${t}`,
      name: `Quota Org ${t}`,
      ownerUserId,
    })
    .returning({ id: organizations.id });

  const orgOwner = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.scope, "organization"), eq(roles.slug, "owner")))
    .limit(1);
  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: ownerUserId,
    roleId: orgOwner[0]!.id,
  });

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  await db.insert(subscriptions).values({
    organizationId: org.id,
    planId: freePlan[0].id,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    provider: "manual",
  });

  return org.id;
};

const insertActiveProject = async (
  orgId: string,
  createdByUserId: string,
): Promise<string> => {
  const t = tag();
  const [p] = await db
    .insert(projects)
    .values({
      organizationId: orgId,
      slug: `q-proj-${t}`,
      name: `Quota Project ${t}`,
      createdByUserId,
      status: "active",
    })
    .returning({ id: projects.id });
  return p.id;
};

d("quotas", () => {
  it("free plan limits llm.tokens.monthly to 100k", async () => {
    const userId = await insertUser();
    const orgId = await insertOrgWithFreeSub(userId);

    const limit = await resolveLimit(orgId, "llm.tokens.monthly", db);
    expect(limit).toBe(100_000);

    // Just under the limit — passes.
    await recordUsage(
      {
        organizationId: orgId,
        userId,
        kind: "llm.tokens.monthly",
        amount: 99_999,
        unit: "tokens",
      },
      db,
    );
    await expect(
      requireQuota(orgId, "llm.tokens.monthly", 1, db),
    ).resolves.toEqual(expect.objectContaining({ remaining: 0 }));

    // One more token — over.
    await expect(
      requireQuota(orgId, "llm.tokens.monthly", 2, db),
    ).rejects.toMatchObject({ status: 402, code: "quota.exceeded" });
  });

  it("override raises the limit and is observed by requireQuota", async () => {
    const userId = await insertUser();
    const orgId = await insertOrgWithFreeSub(userId);
    await db.insert(planOverrides).values({
      organizationId: orgId,
      limits: { "llm.tokens.monthly": 1_000_000 },
      reason: "test override",
    });

    const limit = await resolveLimit(orgId, "llm.tokens.monthly", db);
    expect(limit).toBe(1_000_000);
    await expect(
      requireQuota(orgId, "llm.tokens.monthly", 500_000, db),
    ).resolves.toEqual(expect.objectContaining({ remaining: 500_000 }));
  });

  it("expired override is ignored", async () => {
    const userId = await insertUser();
    const orgId = await insertOrgWithFreeSub(userId);
    await db.insert(planOverrides).values({
      organizationId: orgId,
      limits: { "llm.tokens.monthly": 5_000_000 },
      reason: "expired override",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const limit = await resolveLimit(orgId, "llm.tokens.monthly", db);
    expect(limit).toBe(100_000);
  });

  it("projects.max is enforced absolutely via count(*) of active projects", async () => {
    const userId = await insertUser();
    const orgId = await insertOrgWithFreeSub(userId);

    // Free plan: projects.max = 1. With 0 projects, requireQuota allows +1.
    await expect(
      requireQuota(orgId, "projects.max", 1, db),
    ).resolves.toEqual(expect.objectContaining({ remaining: 0 }));

    // Insert one project — now at the limit.
    await insertActiveProject(orgId, userId);
    await expect(
      requireQuota(orgId, "projects.max", 1, db),
    ).rejects.toMatchObject({ status: 402, code: "quota.exceeded" });

    // Bumping override to 5 — allowed again.
    await db.insert(planOverrides).values({
      organizationId: orgId,
      limits: { "projects.max": 5 },
      reason: "absolute override",
    });
    await expect(
      requireQuota(orgId, "projects.max", 1, db),
    ).resolves.toEqual(expect.objectContaining({ remaining: 3 }));
  });

  it("currentPeriodStartUTC returns the first-of-month UTC timestamp", () => {
    const start = currentPeriodStartUTC(new Date("2026-05-07T12:34:56Z"));
    expect(start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});
