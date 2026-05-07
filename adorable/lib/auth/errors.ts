// Single error class for the auth layer.
//
// `code` is the machine-friendly slug used in JSON responses (`auth.unauthenticated`,
// `quota.exceeded`, etc.); `message` is human-readable; `extra` carries
// structured context for the client (quota.exceeded ships the limit/used
// numbers, conflict.email_exists ships the conflicting email mask). The full
// HTTP serialisation lives in lib/auth/api-wrap.ts (Phase 8) — this file is
// just the throwable.

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message?: string,
    extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    if (extra) this.extra = extra;
  }
}

export const isHttpError = (err: unknown): err is HttpError =>
  err instanceof HttpError;
