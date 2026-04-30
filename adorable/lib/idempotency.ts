// In-memory idempotency cache. Clients send a `clientRequestId` (UUID) on
// duplicate-prone POSTs; if the same id arrives again within `ttlMs`, the
// cached response is returned instead of re-executing the handler. This
// guards against React StrictMode double-mount, double-click, and any
// other client-side retry that lands twice while the original is still
// in flight.
//
// In-memory means per-process: in a multi-instance deployment the same
// id hitting two pods will not dedup. That is OK for the dev/single-node
// setup we ship; if/when we scale horizontally this gets backed by Redis.

type Entry<T> = {
  expiresAt: number;
  // Resolved response payload OR an in-flight promise. Storing the
  // promise lets a second request that arrives mid-execution wait on
  // the first instead of racing it.
  inflight: Promise<T> | null;
  value: T | null;
};

export class IdempotencyCache<T> {
  private store = new Map<string, Entry<T>>();
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // Reap expired entries lazily. Called on every access; the cost is
  // O(n) over the live set, which stays small for our request volume.
  private reap(): void {
    const cutoff = this.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= cutoff && entry.inflight === null) {
        this.store.delete(key);
      }
    }
  }

  // Get-or-execute. If `key` is empty/undefined, falls through to `compute`
  // without caching — callers that pass no clientRequestId opt out.
  async run(key: string | undefined, compute: () => Promise<T>): Promise<T> {
    if (!key) return compute();

    this.reap();

    const existing = this.store.get(key);
    if (existing) {
      if (existing.inflight) return existing.inflight;
      if (existing.value !== null) return existing.value;
    }

    const promise = compute();
    const entry: Entry<T> = {
      expiresAt: this.now() + this.ttlMs,
      inflight: promise,
      value: null,
    };
    this.store.set(key, entry);

    try {
      const value = await promise;
      entry.value = value;
      entry.inflight = null;
      entry.expiresAt = this.now() + this.ttlMs;
      return value;
    } catch (err) {
      // Don't cache failures — let the next attempt with the same id
      // get a fresh execution. A failed POST /api/repos may have left
      // half-created state on the server, but a retry is still safer
      // than persistently returning the error.
      this.store.delete(key);
      throw err;
    }
  }

  // For tests.
  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
