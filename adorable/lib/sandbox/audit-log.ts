// Structured JSON-lines audit log для sandbox + proxy операций.
//
// Формат: каждая строка — валидный JSON, разделённый \n. Пишем append-only
// через `fs.promises.appendFile`. Отсутствующий `SANDBOX_AUDIT_LOG` env →
// logging отключён (no-op). Отсутствующий каталог создаём по мере необх.
//
// Примеры событий:
//   { ts, event: "sandbox_created",  sandboxId, repoId, userId?, image, limits, duration_ms }
//   { ts, event: "sandbox_destroyed", sandboxId, repoId, reason? }
//   { ts, event: "sandbox_exec",     sandboxId, command, exitCode, duration_ms }
//   { ts, event: "proxy_route_added",   sandboxId, hostname, upstream }
//   { ts, event: "proxy_route_removed", sandboxId, hostname }
//   { ts, event: "sandbox_cleanup",  sandboxId, reason: "idle" | "max_lifetime" | "orphaned" }
//
// Цель: диагностика, билллинг, безопасность. Форматом пользуются и тесты
// (tests/sandbox-security.test.ts проверяет что логируется создание и
// уничтожение контейнера).

import { promises as fsp } from "node:fs";
import { dirname } from "node:path";

export type SandboxLimitSnapshot = {
  nanoCpus?: number;
  memoryBytes?: number;
  pidsLimit?: number;
  storageBytes?: number;
  networkName?: string;
  readonlyRootfs?: boolean;
  user?: string;
};

export type AuditEventBase = {
  ts: string;
  userId?: string;
  repoId?: string;
  sandboxId?: string;
};

export type AuditEvent =
  | (AuditEventBase & {
      event: "sandbox_created";
      image: string;
      limits: SandboxLimitSnapshot;
      duration_ms: number;
    })
  | (AuditEventBase & {
      event: "sandbox_destroyed";
      reason?: string;
    })
  | (AuditEventBase & {
      event: "sandbox_exec";
      command: string;
      exitCode: number | null;
      duration_ms: number;
      timedOut?: boolean;
    })
  | (AuditEventBase & {
      event: "sandbox_fs_write";
      path: string;
      bytes: number;
    })
  | (AuditEventBase & {
      event: "sandbox_cleanup";
      reason: "idle" | "max_lifetime" | "orphaned" | "manual";
    })
  | (AuditEventBase & {
      event: "proxy_route_added";
      hostname: string;
      upstream: string;
    })
  | (AuditEventBase & {
      event: "proxy_route_removed";
      hostname: string;
    })
  // Preview-provider build events (BUILD_PIPELINE §9, Phase 6).
  | (AuditEventBase & {
      event: "build_enqueued";
      jobId: string;
      projectId: string;
      reason: string;
      queueDepth: number;
      replacedJobId?: string;
    })
  | (AuditEventBase & {
      event: "build_started";
      jobId: string;
      projectId: string;
      buildId?: string;
      boilerplateVersion?: string;
    })
  | (AuditEventBase & {
      event: "build_finished";
      jobId: string;
      projectId: string;
      status: string;
      exitCode: number;
      durationMs: number;
      errorsCount: number;
    })
  | (AuditEventBase & {
      event: "build_cancelled";
      jobId: string;
      projectId: string;
      reason: "superseded" | "destroy" | "manual";
    });

// Distributive helper: turns a union of object types into a union where
// each variant has an optional `ts`, and `ts` is omitted from the required
// shape. Non-distributive `Omit<AuditEvent, "ts">` would collapse the
// discriminated union and we'd lose the ability to pass variant-specific
// fields (e.g. `path` on sandbox_fs_write).
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

export type AuditEventInput = DistributiveOmit<AuditEvent, "ts"> & {
  ts?: string;
};

export interface AuditLogger {
  log: (event: AuditEventInput) => Promise<void>;
  /** Path the logger is writing to, or null if disabled. */
  readonly path: string | null;
}

const resolveLogPath = (override?: string | null): string | null => {
  if (override === null) return null;
  if (override) return override;
  const fromEnv = process.env["SANDBOX_AUDIT_LOG"];
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
};

type CreateAuditLoggerOptions = {
  /** Override the log path. Pass `null` to disable explicitly. */
  path?: string | null;
  /** When true, throws on write failures instead of swallowing. Default false. */
  strict?: boolean;
};

export const createAuditLogger = (
  options: CreateAuditLoggerOptions = {},
): AuditLogger => {
  // NOTE: pass options.path directly (not `?? undefined`) — nullish
  // coalescing would collapse `null` to `undefined` and we'd lose the
  // explicit "disabled" signal.
  const path = resolveLogPath(
    "path" in options ? options.path : undefined,
  );
  const strict = options.strict ?? false;

  // Concurrent writes are serialized through this promise-chain so that
  // two parallel `append` calls cannot interleave partial JSON lines.
  let tail: Promise<void> = Promise.resolve();
  let dirEnsured = false;

  const ensureDir = async (): Promise<void> => {
    if (dirEnsured || !path) return;
    const dir = dirname(path);
    if (dir && dir !== "." && dir !== "/") {
      await fsp.mkdir(dir, { recursive: true });
    }
    dirEnsured = true;
  };

  const log: AuditLogger["log"] = async (event) => {
    if (!path) return; // disabled
    const withTs = {
      ...event,
      ts: event.ts ?? new Date().toISOString(),
    } as AuditEvent;
    const line = `${JSON.stringify(withTs)}\n`;

    const write = (async () => {
      try {
        await ensureDir();
        await fsp.appendFile(path, line, { encoding: "utf8" });
      } catch (err) {
        if (strict) throw err;
        // Non-strict: log to stderr but don't crash the caller.
        process.stderr.write(
          `audit-log: write failed (${(err as Error).message})\n`,
        );
      }
    })();

    tail = tail.then(() => write);
    await tail;
  };

  return { log, path };
};

/**
 * Module-level singleton — most callers share the same log file path, so
 * we reuse the same serialized writer. Tests can pass `path` explicitly to
 * get an isolated logger.
 */
let _sharedLogger: AuditLogger | null = null;
export const getSharedAuditLogger = (): AuditLogger => {
  if (!_sharedLogger) _sharedLogger = createAuditLogger();
  return _sharedLogger;
};

/** Test helper — reset the module-level singleton. */
export const __resetSharedAuditLogger = (): void => {
  _sharedLogger = null;
};
