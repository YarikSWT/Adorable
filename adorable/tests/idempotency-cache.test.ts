// IdempotencyCache: in-memory dedup of expensive POSTs by clientRequestId.
// Verifies the three observable behaviors callers depend on:
//   1. concurrent runs with the same key share one execution
//   2. a completed run is replayed within ttlMs
//   3. failures aren't cached — the next call retries

import { describe, expect, it } from "vitest";
import { IdempotencyCache } from "@/lib/idempotency";

describe("IdempotencyCache", () => {
  it("collapses concurrent calls with the same key into one execution", async () => {
    const cache = new IdempotencyCache<number>(60_000);
    let runs = 0;
    let resolveCompute: ((v: number) => void) | undefined;
    const compute = () =>
      new Promise<number>((resolve) => {
        runs += 1;
        resolveCompute = resolve;
      });

    const a = cache.run("k1", compute);
    const b = cache.run("k1", compute);

    expect(runs).toBe(1);
    resolveCompute?.(42);
    expect(await a).toBe(42);
    expect(await b).toBe(42);
  });

  it("returns cached value within TTL", async () => {
    const cache = new IdempotencyCache<number>(60_000);
    let runs = 0;
    const compute = async () => {
      runs += 1;
      return runs;
    };

    expect(await cache.run("k1", compute)).toBe(1);
    expect(await cache.run("k1", compute)).toBe(1);
    expect(runs).toBe(1);
  });

  it("expires entry after TTL", async () => {
    let now = 1_000;
    const cache = new IdempotencyCache<number>(100, () => now);
    let runs = 0;
    const compute = async () => {
      runs += 1;
      return runs;
    };

    expect(await cache.run("k1", compute)).toBe(1);
    now += 200;
    expect(await cache.run("k1", compute)).toBe(2);
  });

  it("does not cache failures — next call retries", async () => {
    const cache = new IdempotencyCache<number>(60_000);
    let attempt = 0;
    const compute = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("first call fails");
      return attempt;
    };

    await expect(cache.run("k1", compute)).rejects.toThrow("first call fails");
    expect(await cache.run("k1", compute)).toBe(2);
  });

  it("treats missing key as opt-out (no caching)", async () => {
    const cache = new IdempotencyCache<number>(60_000);
    let runs = 0;
    const compute = async () => {
      runs += 1;
      return runs;
    };

    expect(await cache.run(undefined, compute)).toBe(1);
    expect(await cache.run(undefined, compute)).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it("isolates entries by key", async () => {
    const cache = new IdempotencyCache<string>(60_000);
    const a = await cache.run("k1", async () => "A");
    const b = await cache.run("k2", async () => "B");
    expect(a).toBe("A");
    expect(b).toBe("B");
  });
});
