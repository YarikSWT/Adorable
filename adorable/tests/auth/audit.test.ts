// Integration: writeAuditLog persists rows and the audit_actor_ts_idx index
// is wired correctly (we sanity-check by querying through actorUserId).
// Gated on RUN_DB_TESTS=1.

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { auditLog } from "@/lib/db/schema/audit";
import { users } from "@/lib/db/schema/users";
import { writeAuditLog } from "@/lib/auth/audit";

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

const insertUser = async (): Promise<string> => {
  const tag = Math.random().toString(36).slice(2, 8);
  const [u] = await db
    .insert(users)
    .values({
      email: `audit-${tag}@example.com`,
      emailRaw: `audit-${tag}@example.com`,
      emailVerified: true,
      name: `Audit ${tag}`,
    })
    .returning({ id: users.id });
  return u.id;
};

d("writeAuditLog", () => {
  it("persists an entry with all metadata fields", async () => {
    const actorId = await insertUser();
    const targetId = await insertUser();
    const action = `audit.test.${Math.random().toString(36).slice(2, 8)}`;

    await writeAuditLog(
      {
        actorUserId: actorId,
        action,
        targetType: "user",
        targetId,
        organizationId: null,
        metadata: { reason: "integration-test", before: { foo: 1 } },
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      },
      db,
    );

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, action));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe(actorId);
    expect(rows[0].targetType).toBe("user");
    expect(rows[0].targetId).toBe(targetId);
    expect(rows[0].ipAddress).toBe("127.0.0.1");
    expect(rows[0].userAgent).toBe("vitest");
    expect(rows[0].metadata).toMatchObject({ reason: "integration-test" });
    expect(rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("does not throw when the underlying write fails", async () => {
    // Pass a "database" that throws — writeAuditLog must swallow it.
    const fakeDb = {
      insert: () => {
        throw new Error("simulated DB outage");
      },
    } as unknown as typeof db;
    await expect(
      writeAuditLog({ action: "audit.test.error" }, fakeDb),
    ).resolves.toBeUndefined();
  });

  it("supports lookup by actor (audit_actor_ts_idx is the relevant index)", async () => {
    const actorId = await insertUser();
    const baseAction = `audit.test.byActor.${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    await writeAuditLog({ actorUserId: actorId, action: `${baseAction}.a` }, db);
    await writeAuditLog({ actorUserId: actorId, action: `${baseAction}.b` }, db);

    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.actorUserId, actorId));
    expect(rows.map((r) => r.action).sort()).toEqual([
      `${baseAction}.a`,
      `${baseAction}.b`,
    ]);
  });
});
