// Minimal structured (JSON-line) logger for the worker/reaper.
//
// Spec §2.2 calls for pino + OTel; those are observability polish (Phase 7,
// out of the loop's CI-gated scope). Until then this keeps logs structured with
// runId/projectId on every line so the worker-smoke assertion ("worker logs
// job") and production debugging both work without a heavy dependency.

type Fields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(bound: Fields): Logger;
}

function emit(level: string, base: Fields, msg: string, fields?: Fields): void {
  const line = JSON.stringify({
    level,
    msg,
    ...base,
    ...fields,
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export function createLogger(base: Fields = {}): Logger {
  return {
    info: (msg, fields) => emit("info", base, msg, fields),
    warn: (msg, fields) => emit("warn", base, msg, fields),
    error: (msg, fields) => emit("error", base, msg, fields),
    child: (bound) => createLogger({ ...base, ...bound }),
  };
}

export const logger = createLogger({ service: "agent-worker" });
