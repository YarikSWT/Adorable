// Integration test for bootstrapNewUser — gated on RUN_DB_TESTS=1 so it
// only runs against a real Postgres. Sets up its own postgres-js connection
// from DATABASE_URL_TEST (or DATABASE_URL fallback), drives bootstrap, then
// asserts the persona-org + org_owner membership + active free subscription
// have been written. No fixtures are reset — each test uses a fresh random
// userId so re-runs don't collide.

import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema/users";
import { organizationMembers, organizations } from "@/lib/db/schema/organizations";
import { plans, subscriptions } from "@/lib/db/schema/billing";
import { roles } from "@/lib/db/schema/roles";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";

const enabled = process.env["RUN_DB_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

const url =
  process.env["DATABASE_URL_TEST"] ||
  process.env["DATABASE_URL"] ||
  "postgres://adorable:adorable_dev_password@localhost:5432/adorable";

const queryClient = enabled ? postgres(url, { max: 2 }) : null;
const testDb = enabled
  ? drizzle(queryClient!, { schema })
  : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);

afterAll(async () => {
  if (queryClient) await queryClient.end({ timeout: 5 });
});

const insertTestUser = async (
  name: string,
  email: string,
): Promise<string> => {
  const [user] = await testDb
    .insert(users)
    .values({
      email,
      emailRaw: email,
      emailVerified: true,
      name,
    })
    .returning({ id: users.id });
  return user.id;
};

d("bootstrapNewUser", () => {
  it("creates org, owner membership and active free subscription", async () => {
    // Pre-conditions: seed data must be present.
    const seededOwnerRole = await testDb
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.scope, "organization"), eq(roles.slug, "owner")))
      .limit(1);
    expect(
      seededOwnerRole[0],
      "Run `npm run db:seed` before integration tests",
    ).toBeDefined();
    const seededFreePlan = await testDb
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.slug, "free"))
      .limit(1);
    expect(
      seededFreePlan[0],
      "Run `npm run db:seed` before integration tests",
    ).toBeDefined();

    const tag = Math.random().toString(36).slice(2, 8);
    const userId = await insertTestUser(
      `Bootstrap Test ${tag}`,
      `bootstrap-${tag}@example.com`,
    );

    const result = await bootstrapNewUser(
      userId,
      { userName: `Bootstrap Test ${tag}` },
      testDb,
    );
    expect(result.organizationId).toBeDefined();
    expect(result.subscriptionId).toBeDefined();

    const orgRows = await testDb
      .select()
      .from(organizations)
      .where(eq(organizations.id, result.organizationId));
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0].type).toBe("personal");
    expect(orgRows[0].ownerUserId).toBe(userId);
    expect(orgRows[0].slug).toMatch(/^bootstrap-test-/);

    const memberRows = await testDb
      .select({ roleId: organizationMembers.roleId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].roleId).toBe(seededOwnerRole[0]!.id);

    const subRows = await testDb
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, result.organizationId));
    expect(subRows).toHaveLength(1);
    expect(subRows[0].status).toBe("active");
    expect(subRows[0].planId).toBe(seededFreePlan[0]!.id);
    expect(subRows[0].provider).toBe("manual");
    // period_end is roughly +1 month from period_start; the +1-month bump
    // can land on different day-of-month boundaries, so just sanity-check
    // it's > start and < +35d.
    const periodMs =
      subRows[0].currentPeriodEnd.getTime() -
      subRows[0].currentPeriodStart.getTime();
    expect(periodMs).toBeGreaterThan(27 * 24 * 60 * 60 * 1000);
    expect(periodMs).toBeLessThan(35 * 24 * 60 * 60 * 1000);
  });
});
