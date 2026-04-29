// Тесты HMR-safe singleton'а PreviewProvider + BuildQueue.
//
// Проверяет что getPreviewProvider() возвращает один и тот же инстанс
// между вызовами, и что getBuildQueue() возвращает рабочую очередь
// (с Phase 3 — реальная in-memory impl, не stub).

import { afterEach, describe, expect, it } from "vitest";

import {
  __resetPreviewSingleton,
  getBuildQueue,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";

describe("PreviewProvider singleton", () => {
  afterEach(() => {
    __resetPreviewSingleton();
  });

  it("getPreviewProvider returns the same instance on repeat calls", async () => {
    const a = await getPreviewProvider();
    const b = await getPreviewProvider();
    expect(b).toBe(a);
  });

  it("returns the mock provider in vitest env", async () => {
    const provider = await getPreviewProvider();
    expect(provider.name).toBe("mock");
  });

  it("__resetPreviewSingleton wipes the cached instance", async () => {
    const a = await getPreviewProvider();
    __resetPreviewSingleton();
    const b = await getPreviewProvider();
    expect(b).not.toBe(a);
  });

  it("PREVIEW_PROVIDER_FORCE_SANDBOX=1 overrides PREVIEW_PROVIDER env", async () => {
    const originalForce = process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"];
    const originalProvider = process.env["PREVIEW_PROVIDER"];
    try {
      // Even when env says static, the force-flag wins → sandbox.
      process.env["PREVIEW_PROVIDER"] = "static";
      process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"] = "1";
      __resetPreviewSingleton();
      const provider = await getPreviewProvider();
      expect(provider.name).toBe("sandbox");
    } finally {
      if (originalForce === undefined) {
        delete process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"];
      } else {
        process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"] = originalForce;
      }
      if (originalProvider === undefined) {
        delete process.env["PREVIEW_PROVIDER"];
      } else {
        process.env["PREVIEW_PROVIDER"] = originalProvider;
      }
      __resetPreviewSingleton();
    }
  });

  it("PREVIEW_PROVIDER_FORCE_SANDBOX=0 (or absent) honours PREVIEW_PROVIDER env", async () => {
    const originalForce = process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"];
    const originalProvider = process.env["PREVIEW_PROVIDER"];
    try {
      process.env["PREVIEW_PROVIDER"] = "static";
      delete process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"];
      __resetPreviewSingleton();
      const provider = await getPreviewProvider();
      expect(provider.name).toBe("static");
    } finally {
      if (originalForce !== undefined) {
        process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"] = originalForce;
      }
      if (originalProvider === undefined) {
        delete process.env["PREVIEW_PROVIDER"];
      } else {
        process.env["PREVIEW_PROVIDER"] = originalProvider;
      }
      __resetPreviewSingleton();
    }
  });
});

describe("BuildQueue (Phase 3 real impl)", () => {
  afterEach(() => {
    __resetPreviewSingleton();
  });

  it("getBuildQueue returns an object satisfying the interface shape", () => {
    const queue = getBuildQueue();
    expect(typeof queue.enqueue).toBe("function");
    expect(typeof queue.cancel).toBe("function");
    expect(typeof queue.getActive).toBe("function");
    expect(typeof queue.getQueued).toBe("function");
    expect(typeof queue.subscribe).toBe("function");
  });

  it("enqueue starts a job through the preview provider", async () => {
    // Mock preview provider lives in vitest env; build() returns a
    // succeeded BuildResult quickly, so enqueue + tick is enough.
    const queue = getBuildQueue();
    const provider = await getPreviewProvider();
    await provider.create({ repoId: "p-sing", boilerplateVersion: "1.0.0" });

    const events: string[] = [];
    queue.subscribe("p-sing", (e) => events.push(e.status));
    const res = await queue.enqueue({
      projectId: "p-sing",
      reason: "manual",
    });
    expect(res.status).toBe("running");
    // Allow the runJob promise to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toContain("running");
    expect(events).toContain("succeeded");
  });

  it("getBuildQueue is stable across calls (singleton)", () => {
    const a = getBuildQueue();
    const b = getBuildQueue();
    expect(b).toBe(a);
  });
});
