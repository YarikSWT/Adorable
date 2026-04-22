// Контрактные тесты для ProxyProvider (mock).

import { describe, it, expect, beforeEach } from "vitest";

import {
  createProxyProvider,
  resolveProxyProviderName,
  type ProxyProvider,
} from "@/lib/adapters/proxy";

describe("resolveProxyProviderName", () => {
  it("defaults to mock in tests", () => {
    expect(resolveProxyProviderName()).toBe("mock");
  });

  it("honours override", () => {
    expect(resolveProxyProviderName("caddy")).toBe("caddy");
  });
});

describe("ProxyProvider contract (mock)", () => {
  let provider: ProxyProvider;

  beforeEach(async () => {
    provider = await createProxyProvider({ providerOverride: "mock" });
  });

  it("addRoute is idempotent — repeated call doesn't duplicate", async () => {
    await provider.addRoute({
      id: "sbx1",
      hostname: "sbx1.preview.localhost",
      upstream: "10.0.0.5:3000",
    });
    await provider.addRoute({
      id: "sbx1",
      hostname: "sbx1.preview.localhost",
      upstream: "10.0.0.5:3000",
    });
    const list = await provider.listRoutes();
    expect(list).toHaveLength(1);
  });

  it("addRoute returns stored info", async () => {
    const info = await provider.addRoute({
      id: "r1",
      hostname: "r1.preview.localhost",
      upstream: "10.0.0.1:3000",
      sandboxId: "sbx1",
    });
    expect(info).toMatchObject({
      id: "r1",
      hostname: "r1.preview.localhost",
      upstream: "10.0.0.1:3000",
      sandboxId: "sbx1",
    });
  });

  it("removeRoute removes by id", async () => {
    await provider.addRoute({
      id: "r1",
      hostname: "a.preview.localhost",
      upstream: "1:1",
    });
    await provider.removeRoute("r1");
    const list = await provider.listRoutes();
    expect(list).toHaveLength(0);
  });

  it("removeRoute is idempotent for missing ids", async () => {
    await expect(provider.removeRoute("nope")).resolves.toBeUndefined();
  });

  it("removeSandboxRoutes removes all routes tagged with sandboxId", async () => {
    await provider.addRoute({
      id: "sbx1-preview",
      hostname: "a.preview.localhost",
      upstream: "1:1",
      sandboxId: "sbx1",
    });
    await provider.addRoute({
      id: "sbx1-term",
      hostname: "b.preview.localhost",
      upstream: "1:2",
      sandboxId: "sbx1",
    });
    await provider.addRoute({
      id: "sbx2-preview",
      hostname: "c.preview.localhost",
      upstream: "2:1",
      sandboxId: "sbx2",
    });

    await provider.removeSandboxRoutes("sbx1");

    const list = await provider.listRoutes();
    expect(list).toHaveLength(1);
    expect(list[0].sandboxId).toBe("sbx2");
  });

  it("listRoutes returns all routes", async () => {
    await provider.addRoute({
      id: "a",
      hostname: "a.preview.localhost",
      upstream: "1:1",
    });
    await provider.addRoute({
      id: "b",
      hostname: "b.preview.localhost",
      upstream: "2:2",
    });
    const list = await provider.listRoutes();
    expect(list.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("healthCheck respects setHealthy", async () => {
    const mock = provider as unknown as {
      setHealthy: (h: boolean) => void;
    } & ProxyProvider;
    expect(await mock.healthCheck()).toBe(true);
    mock.setHealthy(false);
    expect(await mock.healthCheck()).toBe(false);
  });
});
