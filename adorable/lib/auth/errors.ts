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

// JSON envelope shared by every auth-aware API route.
//
// `error.code` is the slug from the HttpError; the human `message` lives next
// to it; `extra` keys are spread at the same level as `code`/`message` so
// quota.exceeded ships {error:{code,message,quota:{...}}}, matching Doc 2 §6.3.
//
// Unknown throws collapse to a 500 internal_error — we never let raw
// exceptions reach the wire.
export const errorToResponse = (err: unknown): Response => {
  if (isHttpError(err)) {
    const body: Record<string, unknown> = {
      error: { code: err.code, message: err.message, ...(err.extra ?? {}) },
    };
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (err.status === 429) {
      const ra =
        err.extra && typeof (err.extra as { retryAfter?: unknown }).retryAfter === "number"
          ? Math.ceil((err.extra as { retryAfter: number }).retryAfter)
          : null;
      if (ra != null) headers["retry-after"] = String(ra);
    }
    return new Response(JSON.stringify(body), {
      status: err.status,
      headers,
    });
  }
  console.error("[api-wrap] unhandled error:", err);
  return new Response(
    JSON.stringify({
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    }),
    {
      status: 500,
      headers: { "content-type": "application/json" },
    },
  );
};
