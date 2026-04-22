// ProxyProvider — адаптер над reverse-proxy для динамических preview-роутов.
//
// Контракт:
//   addRoute(spec)     — idempotently map hostname → upstream.
//   removeRoute(id)    — delete a previously added route.
//   listRoutes()       — enumerate currently registered routes.
//   healthCheck()      — ping the proxy control plane (admin API).
//
// В dev и prod реализация — Caddy 2 Admin API (lib/adapters/proxy-caddy.ts).
// Для тестов — in-memory mock (lib/adapters/proxy-mock.ts).
//
// Каждый роут идентифицируется стабильным `id` — обычно `sandboxId` или
// `sandboxId-<role>`. ID используется как Caddy `@id` для точечных
// PUT/DELETE операций.

export interface ProxyRouteSpec {
  /** Stable identifier (e.g. sandboxId) used for later remove. */
  id: string;
  /** Public hostname to match, e.g. "abc123.preview.localhost". */
  hostname: string;
  /** Upstream to dial, e.g. "10.0.0.5:3000" or "sandbox-name:3000". */
  upstream: string;
  /** Optional health check. Defaults: active probe "/" every 10s, 2s timeout. */
  healthCheck?: {
    path?: string;
    intervalSec?: number;
    timeoutSec?: number;
    expectStatusMin?: number;
    expectStatusMax?: number;
  };
  /** Optional sandbox association for audit-log cascade. */
  sandboxId?: string;
  /** Optional tags — free-form for metadata. */
  labels?: Record<string, string>;
}

export interface ProxyRouteInfo {
  id: string;
  hostname: string;
  upstream: string;
  sandboxId?: string;
}

export interface ProxyProvider {
  name: string;
  /** Idempotent: PUT-style replace. Returns the route as stored. */
  addRoute: (spec: ProxyRouteSpec) => Promise<ProxyRouteInfo>;
  /** Remove by id. Idempotent — missing routes are a no-op. */
  removeRoute: (id: string) => Promise<void>;
  /**
   * Remove every route associated with a given sandboxId. Used by the
   * cleanup worker when destroying a sandbox.
   */
  removeSandboxRoutes: (sandboxId: string) => Promise<void>;
  /** Enumerate currently registered routes. */
  listRoutes: () => Promise<ProxyRouteInfo[]>;
  /** True if the proxy control plane is reachable. */
  healthCheck: () => Promise<boolean>;
}

export type ProxyProviderName = "caddy" | "mock";

const normalizeProviderName = (
  raw?: string | null,
): ProxyProviderName | null => {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "caddy") return "caddy";
  if (v === "mock" || v === "test" || v === "fake") return "mock";
  return null;
};

export const resolveProxyProviderName = (
  override?: string,
): ProxyProviderName => {
  const explicit =
    normalizeProviderName(override) ??
    normalizeProviderName(process.env["PROXY_PROVIDER"]);
  if (explicit) return explicit;
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) return "mock";
  return "caddy";
};

export const createProxyProvider = async (
  options: { providerOverride?: string } = {},
): Promise<ProxyProvider> => {
  const name = resolveProxyProviderName(options.providerOverride);
  switch (name) {
    case "mock": {
      const mod = await import("./proxy-mock");
      return mod.createMockProxyProvider();
    }
    case "caddy": {
      const mod = await import("./proxy-caddy");
      return mod.createCaddyProxyProvider();
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown proxy provider: ${_exhaustive as string}`);
    }
  }
};
