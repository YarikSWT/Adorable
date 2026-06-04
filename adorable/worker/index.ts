// Worker entrypoint (спец v2.1 §5.1). Long-running pg-boss consumer that runs
// the real agent loop (handle-agent-run) over the project's Redis stream.
//
// The sandbox + codegen tools (createTools / resolveProjectSandbox) are wired in
// per deployment (they need the Docker sandbox); without them the loop still
// streams, persists the transcript, reconciles usage, and honours cancel. Set
// LLM_PROVIDER=mock for a deterministic worker in verification.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../lib/db/schema";
import Redis from "ioredis";
import { createLLM } from "../lib/adapters/llm";
import { createBoss, type AgentRunJob } from "../lib/agent-run/queue";
import { registerAgentRunWorker } from "../lib/agent-run/worker";
import { handleAgentRun } from "../lib/agent-run/handle-agent-run";
import { createStreamContext } from "../lib/agent-run/stream";
import { hasCancelFlag, clearCancelFlag } from "../lib/agent-run/cancel";
import {
  reconcileUsage,
  releaseReservation,
} from "../lib/agent-run/quota";
import { startHealthServer } from "../lib/agent-run/health";
import { createLogger } from "../lib/agent-run/logger";

const log = createLogger({ service: "platform-worker" });

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const sql = postgres(connectionString, { max: 10 });
  const db = drizzle(sql, { schema });
  const streamCtx = createStreamContext(redisUrl);
  const flagRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const boss = await createBoss({ connectionString, logger: log });
  let healthy = true;
  const health = startHealthServer(
    Number(process.env.WORKER_HEALTH_PORT ?? 8080),
    () => healthy,
  );

  const makeDeps = (job: AgentRunJob) => ({
    db,
    streamCtx: streamCtx.ctx,
    buildModel: () => createLLM({}).main,
    system: "You are a senior engineer working on the user's project.",
    cancelChecker: (runId: string) => hasCancelFlag(flagRedis, runId),
    onCancelClear: (runId: string) => clearCancelFlag(flagRedis, runId),
    recordUsage: async ({
      runId,
      usage,
    }: {
      runId: string;
      usage: { inputTokens: number; outputTokens: number };
    }) => {
      await reconcileUsage(
        db,
        {
          runId,
          organizationId: job.organizationId,
          userId: job.userId,
          projectId: job.projectId,
        },
        usage.inputTokens + usage.outputTokens,
      );
    },
    releaseReservation: async (runId: string) => {
      await releaseReservation(db, {
        runId,
        organizationId: job.organizationId,
      });
    },
    logger: log,
  });

  await registerAgentRunWorker(
    boss,
    async (job) => {
      await handleAgentRun(job, makeDeps(job));
    },
    { logger: log },
  );
  log.info("worker started (real agent loop)");

  const shutdown = async (signal: string): Promise<void> => {
    log.info("worker shutting down", { signal });
    healthy = false;
    await boss.stop({ graceful: true, timeout: 60_000 }).catch(() => {});
    await streamCtx.close().catch(() => {});
    flagRedis.disconnect();
    await sql.end({ timeout: 5 }).catch(() => {});
    await health.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker fatal", { err: String(err) });
  process.exit(1);
});
