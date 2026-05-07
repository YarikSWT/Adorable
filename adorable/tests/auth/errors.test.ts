import { describe, expect, it, vi } from "vitest";
import { errorToResponse, HttpError } from "@/lib/auth/errors";

const readJson = async (res: Response): Promise<unknown> => res.json();

describe("errorToResponse", () => {
  it("serialises HttpError with extra fields per Doc 2 §6.3", async () => {
    const err = new HttpError(402, "quota.exceeded", "Превышена квота плана", {
      quota: {
        kind: "llm.tokens.monthly",
        limit: 100_000,
        used: 100_000,
        period_start: "2026-05-01T00:00:00.000Z",
      },
    });
    const res = errorToResponse(err);
    expect(res.status).toBe(402);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await readJson(res)) as { error: Record<string, unknown> };
    expect(body).toEqual({
      error: {
        code: "quota.exceeded",
        message: "Превышена квота плана",
        quota: {
          kind: "llm.tokens.monthly",
          limit: 100_000,
          used: 100_000,
          period_start: "2026-05-01T00:00:00.000Z",
        },
      },
    });
  });

  it("emits Retry-After header for 429 rate.limited when retryAfter is given", async () => {
    const err = new HttpError(429, "rate.limited", "Too many requests", {
      retryAfter: 12.4,
    });
    const res = errorToResponse(err);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("13");
    const body = (await readJson(res)) as { error: { code: string } };
    expect(body.error.code).toBe("rate.limited");
  });

  it("collapses unknown thrown values to 500 internal_error and logs them", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = errorToResponse(new Error("kaboom"));
      expect(res.status).toBe(500);
      const body = (await readJson(res)) as { error: { code: string } };
      expect(body.error.code).toBe("internal_error");
      expect(consoleSpy).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("falls back to code as message when no message is supplied", async () => {
    const res = errorToResponse(new HttpError(401, "auth.unauthenticated"));
    const body = (await readJson(res)) as {
      error: { code: string; message: string };
    };
    expect(body.error.message).toBe("auth.unauthenticated");
  });
});
