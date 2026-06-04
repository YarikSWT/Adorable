// HMR-safe singletons for the Next app side of the agent-loop (спец §4):
// the pg-boss client (to enqueue runs) and a resumable-stream context (to bridge
// / resume the worker's Redis stream). Same globalThis pattern as lib/db/client.

import type PgBoss from "pg-boss";
import { createBoss } from "./queue";
import { createStreamContext } from "./stream";

type Cache = {
  bossPromise?: Promise<PgBoss>;
  streamCtx?: ReturnType<typeof createStreamContext>;
};

const GLOBAL_KEY = "__adorableAgentLoopSingletons" as const;
const g = globalThis as unknown as Record<string, Cache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

/** pg-boss client for the Next app (enqueue + boss.cancel). */
export async function getBoss(): Promise<PgBoss> {
  if (!cache.bossPromise) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    cache.bossPromise = createBoss({ connectionString });
  }
  return cache.bossPromise;
}

/** Resumable-stream context for the Next bridge / GET reconnect. */
export function getStreamContext(): ReturnType<typeof createStreamContext> {
  if (!cache.streamCtx) {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    cache.streamCtx = createStreamContext(redisUrl);
  }
  return cache.streamCtx;
}
