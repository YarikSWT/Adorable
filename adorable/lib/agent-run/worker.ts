// Agent-run worker registration (спец v2.1 §5).
//
// Phase 1 = skeleton: register a pg-boss handler that receives jobs and hands
// each off to a run handler. The real agent loop (streamText → toUIMessageStream
// → resumable-stream publish, onFinish persistence, heartbeat) lands in Phase 3/4.

import type PgBoss from "pg-boss";
import { AGENT_RUN_QUEUE, type AgentRunJob } from "./queue";
import { createLogger, type Logger } from "./logger";

export type AgentRunHandler = (job: AgentRunJob) => Promise<void>;

export interface RegisterWorkerOptions {
  logger?: Logger;
  /** pg-boss work options (batchSize, pollingIntervalSeconds, …). */
  workOptions?: Record<string, unknown>;
}

/**
 * Register the agent-run worker. pg-boss v10 delivers a batch (array) of jobs;
 * we process them sequentially. Returns the work id.
 */
export async function registerAgentRunWorker(
  boss: PgBoss,
  handler: AgentRunHandler,
  opts: RegisterWorkerOptions = {},
): Promise<string> {
  const log = opts.logger ?? createLogger({ service: "agent-worker" });
  const work = boss.work.bind(boss) as (
    name: string,
    options: Record<string, unknown>,
    cb: (jobs: Array<{ id: string; data: AgentRunJob }>) => Promise<void>,
  ) => Promise<string>;

  return work(
    AGENT_RUN_QUEUE,
    { batchSize: 1, ...(opts.workOptions ?? {}) },
    async (jobs) => {
      for (const job of jobs) {
        log.info("agent-run job received", {
          jobId: job.id,
          runId: job.data.runId,
          projectId: job.data.projectId,
        });
        await handler(job.data);
      }
    },
  );
}
