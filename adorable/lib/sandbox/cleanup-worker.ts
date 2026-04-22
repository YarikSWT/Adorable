// Cleanup-воркер для sandbox-контейнеров.
//
// Запускается при старте билдера (один раз). Периодически (раз в
// `SANDBOX_CLEANUP_INTERVAL_SEC`) пробегает по `SandboxProvider.list()` и
// уничтожает sandbox'ы которые:
//   - превысили MAX_LIFETIME (absolute cap от createdAt), или
//   - идлят дольше IDLE_TIMEOUT (нет активности).
//
// Активность регистрируется внешним кодом через `touch(sandboxId)` — это
// вызывается из API-хендлеров когда приходит exec / fs / chat-запрос.
//
// Каскад: если задан `proxyProvider` — при destroy воркер удаляет
// соответствующие роуты. Иначе только destroy sandbox + audit.
//
// Воркер опциональный — в тестах его можно не стартовать. В проде
// вызывается единожды из instrumentation.ts или server init.

import type { SandboxProvider } from "../adapters/sandbox";
import {
  createAuditLogger,
  getSharedAuditLogger,
  type AuditLogger,
} from "./audit-log";

export interface ProxyUnregister {
  /** Remove any proxy routes associated with this sandbox. */
  removeSandboxRoutes: (sandboxId: string) => Promise<void>;
}

export interface CleanupWorkerOptions {
  provider: SandboxProvider;
  proxyProvider?: ProxyUnregister;
  auditLogger?: AuditLogger;
  /** Override env SANDBOX_MAX_LIFETIME_MIN (default 120 min). */
  maxLifetimeMin?: number;
  /** Override env SANDBOX_IDLE_TIMEOUT_MIN (default 30 min). */
  idleTimeoutMin?: number;
  /** Override env SANDBOX_CLEANUP_INTERVAL_SEC (default 60 s). */
  intervalSec?: number;
  /**
   * Inject a clock for deterministic tests. Returns current epoch ms.
   */
  now?: () => number;
}

export interface CleanupWorker {
  /** Start the periodic sweep loop. No-op if already started. */
  start: () => void;
  /** Stop the loop. Safe to call multiple times. */
  stop: () => void;
  /** Register activity for a sandbox (resets idle timer). */
  touch: (sandboxId: string) => void;
  /**
   * Run a single sweep synchronously. Returns number of sandboxes
   * destroyed. Exposed for tests and manual triggers.
   */
  sweepOnce: () => Promise<number>;
  /** True if start() has been called and stop() hasn't. */
  readonly running: boolean;
}

const parseIntEnv = (
  key: string,
  fallback: number,
): number => {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const createCleanupWorker = (
  options: CleanupWorkerOptions,
): CleanupWorker => {
  const provider = options.provider;
  const proxy = options.proxyProvider;
  const auditLogger = options.auditLogger ?? getSharedAuditLogger();
  const maxLifetimeMin =
    options.maxLifetimeMin ?? parseIntEnv("SANDBOX_MAX_LIFETIME_MIN", 120);
  const idleTimeoutMin =
    options.idleTimeoutMin ?? parseIntEnv("SANDBOX_IDLE_TIMEOUT_MIN", 30);
  const intervalSec =
    options.intervalSec ?? parseIntEnv("SANDBOX_CLEANUP_INTERVAL_SEC", 60);
  const now = options.now ?? (() => Date.now());

  const lastActivity = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  const touch = (sandboxId: string): void => {
    lastActivity.set(sandboxId, now());
  };

  const shouldReap = (
    createdAtIso: string,
    sandboxId: string,
  ): "max_lifetime" | "idle" | null => {
    const current = now();
    const createdAt = Date.parse(createdAtIso);
    if (!Number.isNaN(createdAt)) {
      const ageMin = (current - createdAt) / 60000;
      if (ageMin >= maxLifetimeMin) return "max_lifetime";
    }
    const last = lastActivity.get(sandboxId) ?? createdAt;
    if (!Number.isNaN(last)) {
      const idleMin = (current - last) / 60000;
      if (idleMin >= idleTimeoutMin) return "idle";
    }
    return null;
  };

  const sweepOnce: CleanupWorker["sweepOnce"] = async () => {
    const sandboxes = await provider.list();
    let destroyed = 0;
    for (const s of sandboxes) {
      if (s.status === "stopped" || s.status === "error") {
        // Already gone → forget activity tracking.
        lastActivity.delete(s.sandboxId);
        continue;
      }
      const reason = shouldReap(s.createdAt, s.sandboxId);
      if (!reason) continue;
      try {
        await provider.destroy(s.sandboxId);
        if (proxy) {
          await proxy.removeSandboxRoutes(s.sandboxId).catch(() => undefined);
        }
        lastActivity.delete(s.sandboxId);
        await auditLogger.log({
          event: "sandbox_cleanup",
          sandboxId: s.sandboxId,
          repoId: s.repoId,
          reason,
        });
        destroyed++;
      } catch (err) {
        // Non-strict: log to stderr, keep going.
        process.stderr.write(
          `cleanup-worker: failed to destroy ${s.sandboxId} (${
            (err as Error).message
          })\n`,
        );
      }
    }
    return destroyed;
  };

  const tick = async (): Promise<void> => {
    if (inFlight) {
      // Previous sweep still running — skip this tick.
      return;
    }
    inFlight = (async () => {
      try {
        await sweepOnce();
      } catch (err) {
        process.stderr.write(
          `cleanup-worker: sweep error (${(err as Error).message})\n`,
        );
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  };

  const start: CleanupWorker["start"] = () => {
    if (running) return;
    running = true;
    timer = setInterval(
      () => {
        void tick();
      },
      Math.max(1_000, intervalSec * 1000),
    );
    // setInterval keeps the event loop alive. In Node this is fine for a
    // long-running server; in tests we stop() before finishing.
    timer.unref?.();
  };

  const stop: CleanupWorker["stop"] = () => {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    start,
    stop,
    touch,
    sweepOnce,
    get running() {
      return running;
    },
  };
};

/**
 * Convenience: module-level singleton for the cleanup worker. Not started
 * by default — call `startSharedCleanupWorker()` once at server boot.
 */
let _sharedWorker: CleanupWorker | null = null;

export const getSharedCleanupWorker = (
  options: CleanupWorkerOptions,
): CleanupWorker => {
  if (!_sharedWorker) _sharedWorker = createCleanupWorker(options);
  return _sharedWorker;
};

export const __resetSharedCleanupWorker = (): void => {
  _sharedWorker?.stop();
  _sharedWorker = null;
};

// Re-export createAuditLogger for callers that want to share a dedicated
// logger with the worker (vs the singleton).
export { createAuditLogger };
