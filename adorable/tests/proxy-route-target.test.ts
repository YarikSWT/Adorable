// Тесты на новый дискриминированный target (CONTRACTS §11) и legacy
// upstream-alias. Проверяют:
//   - resolveRouteTarget() от любого валидного варианта возвращает
//     канонический ProxyRouteTarget.
//   - Mock proxy honours оба варианта (upstream legacy + target new).
//   - ProxyRouteInfo всегда содержит target; upstream — только при
//     target.type === "upstream".

import { describe, expect, it } from "vitest";

import {
  createProxyProvider,
  resolveRouteTarget,
  type ProxyProvider,
} from "@/lib/adapters/proxy";

describe("resolveRouteTarget", () => {
  it("uses spec.target when provided", () => {
    const t = resolveRouteTarget({
      target: { type: "upstream", address: "10.0.0.5:3000" },
    });
    expect(t).toEqual({ type: "upstream", address: "10.0.0.5:3000" });
  });

  it("derives upstream-target from legacy spec.upstream", () => {
    const t = resolveRouteTarget({ upstream: "sandbox-1:5173" });
    expect(t).toEqual({ type: "upstream", address: "sandbox-1:5173" });
  });

  it("inlines healthCheck into upstream-target when derived from legacy", () => {
    const t = resolveRouteTarget({
      upstream: "x:1",
      healthCheck: { path: "/healthz", intervalSec: 5 },
    });
    expect(t.type).toBe("upstream");
    if (t.type !== "upstream") throw new Error("unreachable");
    expect(t.healthCheck?.path).toBe("/healthz");
  });

  it("preserves static target as-is", () => {
    const t = resolveRouteTarget({
      target: {
        type: "static",
        rootDir: "/data/static/proj-1/current",
        tryFiles: ["{path}", "/index.html"],
      },
    });
    expect(t).toEqual({
      type: "static",
      rootDir: "/data/static/proj-1/current",
      tryFiles: ["{path}", "/index.html"],
    });
  });

  it("throws when neither target nor upstream is provided", () => {
    expect(() => resolveRouteTarget({})).toThrow(/target.*upstream/i);
  });

  it("throws when target.upstream.address is empty", () => {
    expect(() =>
      resolveRouteTarget({ target: { type: "upstream", address: "" } }),
    ).toThrow(/address/i);
  });

  it("throws when target.static.rootDir is empty", () => {
    expect(() =>
      resolveRouteTarget({ target: { type: "static", rootDir: "" } }),
    ).toThrow(/rootDir/i);
  });
});

describe("Mock ProxyProvider — target / upstream coexistence", () => {
  let provider: ProxyProvider;

  it("addRoute with legacy upstream populates both upstream and target", async () => {
    provider = await createProxyProvider({ providerOverride: "mock" });
    const info = await provider.addRoute({
      id: "rt1",
      hostname: "a.preview.localhost",
      upstream: "10.0.0.1:3000",
    });
    expect(info.upstream).toBe("10.0.0.1:3000");
    expect(info.target).toEqual({
      type: "upstream",
      address: "10.0.0.1:3000",
    });
  });

  it("addRoute with explicit target.upstream omits redundant work", async () => {
    provider = await createProxyProvider({ providerOverride: "mock" });
    const info = await provider.addRoute({
      id: "rt2",
      hostname: "b.preview.localhost",
      target: { type: "upstream", address: "10.0.0.2:3000" },
    });
    expect(info.target.type).toBe("upstream");
    expect(info.upstream).toBe("10.0.0.2:3000");
  });

  it("addRoute with target.static records static target, no upstream", async () => {
    provider = await createProxyProvider({ providerOverride: "mock" });
    const info = await provider.addRoute({
      id: "rt3",
      hostname: "c.preview.localhost",
      target: { type: "static", rootDir: "/data/static/x/current" },
    });
    expect(info.target.type).toBe("static");
    expect(info.upstream).toBeUndefined();
  });

  it("addRoute with no target and no upstream rejects", async () => {
    provider = await createProxyProvider({ providerOverride: "mock" });
    await expect(
      provider.addRoute({ id: "rt-bad", hostname: "x" }),
    ).rejects.toThrow(/target.*upstream/i);
  });
});
