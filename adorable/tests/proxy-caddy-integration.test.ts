// Интеграционные тесты proxy-caddy.ts против живого Caddy Admin API.
// Gated on RUN_CADDY_TESTS=1. Требуют:
//   - Caddy 2 с admin API на CADDY_ADMIN_URL (default http://localhost:2019)
//   - server "preview" (создастся автоматически если нет)

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createCaddyProxyProvider } from "@/lib/adapters/proxy-caddy";
import { createAuditLogger } from "@/lib/sandbox/audit-log";
import type { ProxyProvider } from "@/lib/adapters/proxy";

const enabled = process.env.RUN_CADDY_TESTS === "1";
const d = enabled ? describe : describe.skip;

const createdIds: string[] = [];
let provider: ProxyProvider;

d("proxy-caddy integration (live Caddy Admin API)", () => {
  beforeAll(() => {
    provider = createCaddyProxyProvider({
      auditLogger: createAuditLogger({ path: null }),
    });
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await provider.removeRoute(id).catch(() => undefined);
    }
  });

  it("healthCheck passes", async () => {
    expect(await provider.healthCheck()).toBe(true);
  }, 10_000);

  it("addRoute creates a route and listRoutes finds it", async () => {
    const id = `it-${Date.now().toString(36)}`;
    createdIds.push(id);
    const info = await provider.addRoute({
      id,
      hostname: `${id}.preview.localhost`,
      upstream: "127.0.0.1:9999",
    });
    expect(info.id).toBe(id);

    const list = await provider.listRoutes();
    expect(list.some((r) => r.id === id)).toBe(true);
  }, 15_000);

  it("addRoute is idempotent — repeated call doesn't duplicate", async () => {
    const id = `it-idem-${Date.now().toString(36)}`;
    createdIds.push(id);
    await provider.addRoute({
      id,
      hostname: `${id}.preview.localhost`,
      upstream: "127.0.0.1:9998",
    });
    await provider.addRoute({
      id,
      hostname: `${id}.preview.localhost`,
      upstream: "127.0.0.1:9998",
    });
    const list = await provider.listRoutes();
    const count = list.filter((r) => r.id === id).length;
    expect(count).toBe(1);
  }, 15_000);

  it("removeRoute removes a route", async () => {
    const id = `it-rm-${Date.now().toString(36)}`;
    await provider.addRoute({
      id,
      hostname: `${id}.preview.localhost`,
      upstream: "127.0.0.1:9997",
    });
    await provider.removeRoute(id);
    const list = await provider.listRoutes();
    expect(list.some((r) => r.id === id)).toBe(false);
  }, 15_000);

  it("removeRoute is idempotent for missing ids", async () => {
    await expect(provider.removeRoute("nonexistent-xyz")).resolves.toBeUndefined();
  }, 10_000);

  it("removeSandboxRoutes removes all matching ids", async () => {
    const sbx = `sbx-${Date.now().toString(36)}`;
    const prefixes = [`${sbx}`, `${sbx}-term`, `${sbx}-additional`];
    for (const id of prefixes) {
      await provider.addRoute({
        id,
        hostname: `${id}.preview.localhost`,
        upstream: "127.0.0.1:9996",
        sandboxId: sbx,
      });
      createdIds.push(id);
    }
    await provider.removeSandboxRoutes(sbx);
    const list = await provider.listRoutes();
    for (const id of prefixes) {
      expect(list.some((r) => r.id === id)).toBe(false);
    }
  }, 30_000);
});
