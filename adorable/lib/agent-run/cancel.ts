// Redis cancel flag (спец v2.1 §4.3/§5.4). The stop endpoint sets it; the worker
// polls it (every 5s) and aborts streamText. TTL-bounded so a missed clear can't
// leak forever.

import type Redis from "ioredis";

const CANCEL_TTL_SECONDS = 3600; // 1h
const cancelKey = (runId: string): string => `agent-run:cancel:${runId}`;

export async function setCancelFlag(redis: Redis, runId: string): Promise<void> {
  await redis.set(cancelKey(runId), "1", "EX", CANCEL_TTL_SECONDS);
}

export async function hasCancelFlag(
  redis: Redis,
  runId: string,
): Promise<boolean> {
  return (await redis.exists(cancelKey(runId))) === 1;
}

export async function clearCancelFlag(
  redis: Redis,
  runId: string,
): Promise<void> {
  await redis.del(cancelKey(runId));
}
