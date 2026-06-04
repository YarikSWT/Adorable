// pg-boss bootstrap for the agent-run queue (спец v2.1 §2.1/§5.1).
//
// pg-boss lives inside the existing Postgres — no new infra. Fail-fast:
// retryLimit:0 (a crashed run is NOT re-executed; the reaper finalizes it).
// jobId is returned from send() and persisted on the run so stop can cancel it.

import PgBoss from "pg-boss";
import { createLogger, type Logger } from "./logger";

export const AGENT_RUN_QUEUE = "agent-run";

/** Payload enqueued for one agent run. */
export interface AgentRunJob {
  runId: string;
  userId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
  modelKey: string;
  reservationId?: string;
}

export interface CreateBossOptions {
  connectionString: string;
  schema?: string;
  logger?: Logger;
}

/**
 * Create + start a pg-boss instance and ensure the agent-run queue exists with
 * fail-fast retry policy. Caller owns the lifecycle (must boss.stop()).
 */
export async function createBoss(opts: CreateBossOptions): Promise<PgBoss> {
  const log = opts.logger ?? createLogger({ service: "agent-worker" });
  const boss = new PgBoss({
    connectionString: opts.connectionString,
    schema: opts.schema ?? "pgboss",
  });
  boss.on("error", (err) =>
    log.error("pg-boss error", { err: String(err) }),
  );
  await boss.start();
  // Fail-fast at the queue level too; per-send reinforces it (§4.1 / §11.4.16).
  await boss.createQueue(AGENT_RUN_QUEUE, { retryLimit: 0 } as never);
  return boss;
}

/**
 * Enqueue an agent run. Returns the pg-boss jobId (to persist on runs.jobId so
 * stop can boss.cancel(jobId)) or null if the job was deduplicated/dropped.
 *
 * expireInHours is deliberately large (23h — pg-boss v10 caps strictly below
 * 24h): job-expiration is NOT the liveness signal — heartbeat + reaper are
 * (§4.1). retryLimit:0 = no re-execution.
 */
export async function enqueueAgentRun(
  boss: PgBoss,
  job: AgentRunJob,
): Promise<string | null> {
  return boss.send(AGENT_RUN_QUEUE, job, {
    retryLimit: 0,
    expireInHours: 23,
  });
}
