// Тесты HMR-safe singleton'а PreviewProvider + BuildQueue stub.
//
// Проверяет что getPreviewProvider() возвращает один и тот же инстанс
// между вызовами, и что BuildQueue в Phase 1 — explicit stub.

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
});

describe("BuildQueue stub (Phase 1)", () => {
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

  it("enqueue throws an explicit not-implemented error", async () => {
    const queue = getBuildQueue();
    await expect(
      queue.enqueue({ projectId: "x", reason: "manual" }),
    ).rejects.toThrow(/Phase 3/);
  });

  it("getBuildQueue is stable across calls (singleton)", () => {
    const a = getBuildQueue();
    const b = getBuildQueue();
    expect(b).toBe(a);
  });
});
