// Unit-тесты для lib/sandbox/cleanup-worker.ts.
//
// Прогоняем против MockSandboxProvider. Инжектим `now` в воркер для
// детерминированных проверок TTL/idle логики без реальных таймеров.

import { describe, it, expect, beforeEach } from "vitest";

import {
  createSandboxProvider,
  type SandboxProvider,
} from "@/lib/adapters/sandbox";
import {
  createCleanupWorker,
  type CleanupWorker,
} from "@/lib/sandbox/cleanup-worker";
import { createAuditLogger } from "@/lib/sandbox/audit-log";

let provider: SandboxProvider;
let worker: CleanupWorker;
let clockMs: number;

const getNow = () => clockMs;
const advanceMinutes = (m: number) => {
  clockMs += m * 60_000;
};

beforeEach(async () => {
  provider = await createSandboxProvider({ providerOverride: "mock" });
  // Anchor the injected clock to real wall-clock, because the mock provider
  // stamps createdAt via `new Date().toISOString()`. Using a fixed absolute
  // time would make the sandbox appear ancient relative to our clock.
  clockMs = Date.now();
  worker = createCleanupWorker({
    provider,
    maxLifetimeMin: 120,
    idleTimeoutMin: 30,
    now: getNow,
    // Disable audit logging in tests by supplying a null-path logger.
    auditLogger: createAuditLogger({ path: null }),
  });
});

describe("cleanup-worker TTL", () => {
  it("does not destroy a fresh sandbox", async () => {
    const h = await provider.create({ repoId: "r1" });
    worker.touch(h.sandboxId);
    const n = await worker.sweepOnce();
    expect(n).toBe(0);
    const list = await provider.list();
    expect(list.find((s) => s.sandboxId === h.sandboxId)).toBeDefined();
  });

  it("destroys a sandbox older than MAX_LIFETIME", async () => {
    const h = await provider.create({ repoId: "r1" });
    worker.touch(h.sandboxId);
    advanceMinutes(121);
    const n = await worker.sweepOnce();
    expect(n).toBe(1);
    const list = await provider.list();
    expect(list.find((s) => s.sandboxId === h.sandboxId)).toBeUndefined();
  });

  it("destroys a sandbox idle beyond IDLE_TIMEOUT", async () => {
    const h = await provider.create({ repoId: "r1" });
    worker.touch(h.sandboxId);
    advanceMinutes(31);
    const n = await worker.sweepOnce();
    expect(n).toBe(1);
  });

  it("touch() resets the idle timer", async () => {
    const h = await provider.create({ repoId: "r1" });
    worker.touch(h.sandboxId);
    advanceMinutes(20);
    worker.touch(h.sandboxId); // activity
    advanceMinutes(15); // total 35 from create, 15 since last touch
    const n = await worker.sweepOnce();
    expect(n).toBe(0);
  });
});

describe("cleanup-worker proxy cascade", () => {
  it("invokes proxyProvider.removeSandboxRoutes on destroy", async () => {
    const h = await provider.create({ repoId: "r1" });
    worker.touch(h.sandboxId);
    advanceMinutes(121);

    const removed: string[] = [];
    const workerWithProxy = createCleanupWorker({
      provider,
      maxLifetimeMin: 120,
      idleTimeoutMin: 30,
      now: getNow,
      proxyProvider: {
        removeSandboxRoutes: async (id) => {
          removed.push(id);
        },
      },
      auditLogger: createAuditLogger({ path: null }),
    });
    await workerWithProxy.sweepOnce();
    expect(removed).toContain(h.sandboxId);
  });

  it("swallows proxy errors — destroy still reported as success", async () => {
    const h = await provider.create({ repoId: "r1" });
    advanceMinutes(121);
    const workerBadProxy = createCleanupWorker({
      provider,
      maxLifetimeMin: 120,
      idleTimeoutMin: 30,
      now: getNow,
      proxyProvider: {
        removeSandboxRoutes: async () => {
          throw new Error("proxy down");
        },
      },
      auditLogger: createAuditLogger({ path: null }),
    });
    const n = await workerBadProxy.sweepOnce();
    expect(n).toBe(1);
  });
});

describe("cleanup-worker lifecycle", () => {
  it("running flag toggles with start/stop", () => {
    expect(worker.running).toBe(false);
    worker.start();
    expect(worker.running).toBe(true);
    worker.stop();
    expect(worker.running).toBe(false);
  });

  it("start is idempotent", () => {
    worker.start();
    worker.start();
    expect(worker.running).toBe(true);
    worker.stop();
  });

  it("stop is safe without prior start", () => {
    expect(() => worker.stop()).not.toThrow();
  });

  it("forgets activity tracking when sandbox is already stopped", async () => {
    const h = await provider.create({ repoId: "r1" });
    worker.touch(h.sandboxId);
    await provider.destroy(h.sandboxId);
    // sandbox is gone from list entirely; sweep should not throw.
    const n = await worker.sweepOnce();
    expect(n).toBe(0);
  });
});

describe("cleanup-worker env defaults", () => {
  it("reads SANDBOX_MAX_LIFETIME_MIN / SANDBOX_IDLE_TIMEOUT_MIN env", async () => {
    const prev = {
      maxLife: process.env.SANDBOX_MAX_LIFETIME_MIN,
      idle: process.env.SANDBOX_IDLE_TIMEOUT_MIN,
    };
    try {
      process.env.SANDBOX_MAX_LIFETIME_MIN = "5";
      process.env.SANDBOX_IDLE_TIMEOUT_MIN = "2";
      const prov = await createSandboxProvider({ providerOverride: "mock" });
      clockMs = Date.now();
      const w = createCleanupWorker({
        provider: prov,
        now: getNow,
        auditLogger: createAuditLogger({ path: null }),
      });
      const h = await prov.create({ repoId: "r1" });
      w.touch(h.sandboxId);
      advanceMinutes(3); // 3 > 2 idle
      const n = await w.sweepOnce();
      expect(n).toBe(1);
    } finally {
      if (prev.maxLife !== undefined)
        process.env.SANDBOX_MAX_LIFETIME_MIN = prev.maxLife;
      else delete process.env.SANDBOX_MAX_LIFETIME_MIN;
      if (prev.idle !== undefined)
        process.env.SANDBOX_IDLE_TIMEOUT_MIN = prev.idle;
      else delete process.env.SANDBOX_IDLE_TIMEOUT_MIN;
    }
  });
});
