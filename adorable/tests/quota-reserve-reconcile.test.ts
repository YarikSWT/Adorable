// Phase 6 §12.4.6 — quota reservation + usage reconcile.
//   (b) reserveQuota blocks (quota_exceeded → 429) when the estimate exceeds the
//       plan limit; the estimate is the multi-step ceiling;
//   (a) reconcile nets to the ACTUAL usage; orphan release nets to 0; both are
//       idempotent by runId (handler vs reaper).
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planOverrides } from "@/lib/db/schema/billing";
import {
  reserveQuota,
  reconcileUsage,
  releaseReservation,
  chargedTokens,
  ESTIMATED_TURN_TOKENS,
  MAX_TOTAL_STEPS,
} from "@/lib/agent-run/quota";
import { startPostgres, type StartedPostgres } from "./_helpers/containers";
import {
  connectAndMigrate,
  seedProjectGraph,
  type TestDbHandle,
  type SeededGraph,
} from "./_helpers/db";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let pg: StartedPostgres;
let handle: TestDbHandle;
let graph: SeededGraph;

async function setLimit(orgId: string, limit: number): Promise<void> {
  await handle.db
    .insert(planOverrides)
    .values({
      organizationId: orgId,
      limits: { "llm.tokens.monthly": limit },
    } as never);
}

beforeAll(async () => {
  pg = await startPostgres();
  handle = await connectAndMigrate(pg.url);
}, 180_000);

afterAll(async () => {
  if (handle) await handle.end();
  if (pg) await pg.stop();
}, 60_000);

d("Phase 6 quota reserve + reconcile", () => {
  it("ESTIMATED_TURN_TOKENS is the multi-step ceiling, not an average turn", () => {
    expect(ESTIMATED_TURN_TOKENS).toBeGreaterThanOrEqual(MAX_TOTAL_STEPS * 1000);
  });

  it("(b) reserveQuota blocks when the estimate exceeds the plan limit", async () => {
    graph = await seedProjectGraph(handle.db, "quota");
    await setLimit(graph.organizationId, 30_000);

    const ref = {
      runId: "run-b-1",
      organizationId: graph.organizationId,
      userId: graph.userId,
      projectId: graph.projectId,
    };
    const first = await reserveQuota(handle.db, ref, 20_000);
    expect(first.ok).toBe(true);
    expect(await chargedTokens(handle.db, ref.runId)).toBe(20_000);

    // Now 20k used; a 20k estimate would exceed the 30k limit → blocked.
    const blocked = await reserveQuota(
      handle.db,
      { ...ref, runId: "run-b-2" },
      20_000,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("quota_exceeded");
    expect(await chargedTokens(handle.db, "run-b-2")).toBe(0); // nothing charged
  }, 60_000);

  it("(a) reconcile nets to actual usage and is idempotent", async () => {
    const g = await seedProjectGraph(handle.db, "quota2");
    await setLimit(g.organizationId, 1_000_000);
    const ref = {
      runId: "run-a-1",
      organizationId: g.organizationId,
      userId: g.userId,
      projectId: g.projectId,
    };
    await reserveQuota(handle.db, ref, 20_000);
    expect(await chargedTokens(handle.db, ref.runId)).toBe(20_000);

    // Run used only 12k → net charge becomes 12k.
    await reconcileUsage(handle.db, ref, 12_000, 20_000);
    expect(await chargedTokens(handle.db, ref.runId)).toBe(12_000);

    // Idempotent: handler + reaper both reconcile → still 12k.
    await reconcileUsage(handle.db, ref, 12_000, 20_000);
    await reconcileUsage(handle.db, ref, 999, 20_000);
    expect(await chargedTokens(handle.db, ref.runId)).toBe(12_000);
  }, 60_000);

  it("(a) orphan release nets to 0 and is idempotent (and blocks a later reconcile)", async () => {
    const g = await seedProjectGraph(handle.db, "quota3");
    await setLimit(g.organizationId, 1_000_000);
    const ref = {
      runId: "run-a-2",
      organizationId: g.organizationId,
      userId: g.userId,
      projectId: g.projectId,
    };
    await reserveQuota(handle.db, ref, 20_000);
    expect(await chargedTokens(handle.db, ref.runId)).toBe(20_000);

    // Orphan (hard crash, no usage) → release returns the whole reservation.
    await releaseReservation(handle.db, ref, 20_000);
    expect(await chargedTokens(handle.db, ref.runId)).toBe(0);

    // Idempotent + reconcile after release is a no-op.
    await releaseReservation(handle.db, ref, 20_000);
    await reconcileUsage(handle.db, ref, 5_000, 20_000);
    expect(await chargedTokens(handle.db, ref.runId)).toBe(0);
  }, 60_000);
});
