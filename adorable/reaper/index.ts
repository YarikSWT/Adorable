// Reaper entrypoint (спец v2.1 §7). Single-instance sweeper (advisory-lock).
//
// Phase 1 = skeleton: tick on an interval under the singleton advisory lock,
// expose /health, graceful shutdown. The full sweep lands in Phase 4.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../lib/db/schema";
import { reaperTick } from "../lib/agent-run/reaper";
import { startHealthServer } from "../lib/agent-run/health";
import { createLogger } from "../lib/agent-run/logger";

const log = createLogger({ service: "platform-reaper" });

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  // Pinned single connection so the session-level advisory lock stays put.
  const sql = postgres(connectionString, { max: 1 });
  // Separate pool for the sweep queries (drizzle).
  const sweepClient = postgres(connectionString, { max: 4 });
  const db = drizzle(sweepClient, { schema });
  let healthy = true;
  const health = startHealthServer(
    Number(process.env.REAPER_HEALTH_PORT ?? 8080),
    () => healthy,
  );

  const intervalMs = Number(process.env.REAPER_INTERVAL_MS ?? 15_000);
  let stopped = false;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        // gitCommit/attachSandbox (draft-commit of orphaned work) are wired at
        // deploy time with the real sandbox provider; without them the sweep
        // still finalizes stuck runs and frees the project.
        await reaperTick({
          sql,
          logger: log,
          sweepDeps: { db, staleMs: 60_000, logger: log },
        });
      } catch (err) {
        log.error("reaper tick error", { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  log.info("reaper started", { intervalMs });

  const shutdown = async (signal: string): Promise<void> => {
    log.info("reaper shutting down", { signal });
    healthy = false;
    stopped = true;
    await sql.end({ timeout: 5 }).catch(() => {});
    await sweepClient.end({ timeout: 5 }).catch(() => {});
    await health.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("reaper fatal", { err: String(err) });
  process.exit(1);
});
