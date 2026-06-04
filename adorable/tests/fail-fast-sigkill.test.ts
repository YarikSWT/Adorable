// Phase 4 §12.4.2 — fail-fast: a worker dying mid-run does NOT re-execute the
// job (retryLimit:0), so two non-deterministic generations are never spliced.
//
// A real SIGKILL is simulated by a handler that throws (the job ends abnormally
// without finalizing). With retryLimit:0 pg-boss must NOT redeliver it.
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type PgBoss from "pg-boss";
import {
  createBoss,
  enqueueAgentRun,
  type AgentRunJob,
} from "@/lib/agent-run/queue";
import { registerAgentRunWorker } from "@/lib/agent-run/worker";
import { startPostgres, type StartedPostgres } from "./_helpers/containers";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

const silent = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child() {
    return this;
  },
};

let pg: StartedPostgres;
let boss: PgBoss;

beforeAll(async () => {
  pg = await startPostgres();
  boss = await createBoss({ connectionString: pg.url, logger: silent });
}, 180_000);

afterAll(async () => {
  if (boss) await boss.stop({ graceful: false }).catch(() => undefined);
  if (pg) await pg.stop();
}, 60_000);

const job: AgentRunJob = {
  runId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  organizationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  projectId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  conversationId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  modelKey: "mock-main",
};

d("Phase 4 fail-fast (retryLimit:0)", () => {
  it("a crashing handler is NOT retried — job runs exactly once", async () => {
    let calls = 0;
    await registerAgentRunWorker(
      boss,
      async () => {
        calls++;
        throw new Error("simulated SIGKILL mid-run");
      },
      { logger: silent, workOptions: { pollingIntervalSeconds: 1 } },
    );

    await enqueueAgentRun(boss, job);

    // Wait well beyond any retry backoff window. With retryLimit:0 there is no
    // second delivery — two generations are never spliced.
    await new Promise((r) => setTimeout(r, 6000));
    expect(calls).toBe(1);
  }, 30_000);
});
