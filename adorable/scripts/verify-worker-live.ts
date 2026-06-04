// Drives the REAL production worker (worker/index.ts, running separately) by
// enqueueing an agent run, then asserts the worker processed it end-to-end
// (queued → completed, transcript persisted, usage reconciled).

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema/users";
import { organizations } from "@/lib/db/schema/organizations";
import { projects } from "@/lib/db/schema/projects";
import { conversations } from "@/lib/db/schema/conversations";
import { runs } from "@/lib/db/schema/runs";
import { messages } from "@/lib/db/schema/messages";
import { createBoss, enqueueAgentRun } from "@/lib/agent-run/queue";

const ok = (label: string, cond: boolean) =>
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);

async function main() {
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, { max: 4 });
  const db = drizzle(sql, { schema });

  const [u] = await db.insert(users).values({ email: `w-${Date.now()}@x.com` } as never).returning({ id: users.id });
  const [o] = await db.insert(organizations).values({ type: "personal", slug: `wo-${Date.now()}`, name: "W", ownerUserId: u.id } as never).returning({ id: organizations.id });
  const [p] = await db.insert(projects).values({ organizationId: o.id, slug: `wp-${Date.now()}`, name: "W", createdByUserId: u.id } as never).returning({ id: projects.id });
  const [c] = await db.insert(conversations).values({ projectId: p.id, userId: u.id }).returning({ id: conversations.id });
  await db.insert(messages).values({ conversationId: c.id, role: "user", uiMessage: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "build a counter" }] } as never });
  const runId = randomUUID();
  await db.insert(runs).values({ id: runId, userId: u.id, organizationId: o.id, projectId: p.id, conversationId: c.id, prompt: "build a counter", modelKey: "default", status: "queued" } as never);

  const boss = await createBoss({ connectionString: url });
  const jobId = await enqueueAgentRun(boss, { runId, userId: u.id, organizationId: o.id, projectId: p.id, conversationId: c.id, modelKey: "default", reservationId: runId });
  ok("enqueued run (jobId returned)", !!jobId);

  // Poll until the worker finalizes the run.
  let status = "queued";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const [r] = await db.select().from(runs).where(eq(runs.id, runId));
    status = r.status;
    if (["completed", "failed", "cancelled"].includes(status)) break;
    await new Promise((res) => setTimeout(res, 400));
  }
  ok(`worker processed run → completed (got '${status}')`, status === "completed");

  const [r] = await db.select().from(runs).where(eq(runs.id, runId));
  ok("run finalized: activeStreamId cleared", r.activeStreamId === null);
  ok("run has stepCount + tokenUsage", r.stepCount >= 1 && r.tokenUsage !== null);

  const asst = await db.select().from(messages).where(eq(messages.runId, runId));
  ok("exactly one assistant message persisted (uniq index)", asst.length === 1);
  ok("assistant message has content", (asst[0]?.uiMessage as { parts?: unknown[] })?.parts?.length! > 0);

  await boss.stop({ graceful: false }).catch(() => {});
  await sql.end({ timeout: 5 });
  console.log("DONE");
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
