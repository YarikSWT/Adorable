// ProxyProvider — адаптер над reverse-proxy для динамических preview-роутов.
//
// Контракт:
//   addRoute(spec)     — idempotently map hostname → target.
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
//
// Migration note (CONTRACTS §11, ADR-004):
// Раньше у ProxyRouteSpec было одно поле `upstream: string`. Теперь
// добавлен дискриминированный `target: ProxyRouteTarget` чтобы один и
// тот же proxy мог раздавать как `reverse_proxy` (sandbox), так и
// `file_server` (static preview). Старое поле `upstream` сохранено как
// optional alias — sandbox flow продолжает работать без изменений.
// Адаптеры используют resolveRouteTarget(spec) чтобы получить
// канонический target.

export interface HealthCheckSpec {
  path?: string;
  intervalSec?: number;
  timeoutSec?: number;
  expectStatusMin?: number;
  expectStatusMax?: number;
}

/**
 * Дискриминированный union: что Caddy/mock раздаёт по этому хосту.
 * Source: CONTRACTS §11, ADR-004 (file_server для static preview).
 */
export type ProxyRouteTarget =
  | {
      /** Reverse-proxy на upstream:port. Текущая реализация для sandbox. */
      type: "upstream";
      /** "10.0.0.5:3000" / "sandbox-name:5173". */
      address: string;
      healthCheck?: HealthCheckSpec;
    }
  | {
      /** file_server из директории. Для static preview-режима. */
      type: "static";
      /**
       * Абсолютный путь, который Caddy раздаёт. Должен оставаться
       * стабильным — atomic swap происходит через симлинк, Caddy об
       * этом не знает.
       */
      rootDir: string;
      /**
       * Default ["{path}", "{path}/", "/index.html"] — SPA fallback
       * для react-router-dom.
       */
      tryFiles?: string[];
    };

export interface ProxyRouteSpec {
  /** Stable identifier (e.g. sandboxId) used for later remove. */
  id: string;
  /** Public hostname to match, e.g. "abc123.preview.localhost". */
  hostname: string;
  /**
   * Legacy field — pre-PreviewProvider migration. Equivalent to
   * `target = { type: "upstream", address: upstream }`. Adapters
   * normalise через resolveRouteTarget(). Новый код должен
   * предпочитать `target`.
   */
  upstream?: string;
  /**
   * Что Caddy раздаёт по этому хосту. Если не задано — fallback на
   * legacy `upstream`. Один из двух MUST быть задан.
   */
  target?: ProxyRouteTarget;
  /** Legacy alias для healthCheck-настроек upstream-target'а. */
  healthCheck?: HealthCheckSpec;
  /** Optional sandbox association for audit-log cascade. */
  sandboxId?: string;
  /** Optional tags — free-form for metadata. */
  labels?: Record<string, string>;
}

export interface ProxyRouteInfo {
  id: string;
  hostname: string;
  /**
   * Legacy alias: при `target.type === "upstream"` равен address.
   * Для static-target равен undefined. Сохраняется чтобы старые
   * callers (audit-log, тесты) не сломались.
   */
  upstream?: string;
  /** Канонический target — заполняется адаптерами. */
  target: ProxyRouteTarget;
  sandboxId?: string;
}

/**
 * Канонизировать target из spec'ы — для адаптеров.
 * Если spec.target присутствует — использует его. Иначе строит
 * upstream-target из legacy spec.upstream (+ spec.healthCheck).
 *
 * Throws если ни одно из полей не задано.
 */
export const resolveRouteTarget = (
  spec: Pick<ProxyRouteSpec, "target" | "upstream" | "healthCheck">,
): ProxyRouteTarget => {
  if (spec.target) {
    if (spec.target.type === "upstream" && !spec.target.address) {
      throw new Error("ProxyRouteSpec: target.upstream.address is empty");
    }
    if (spec.target.type === "static" && !spec.target.rootDir) {
      throw new Error("ProxyRouteSpec: target.static.rootDir is empty");
    }
    return spec.target;
  }
  if (typeof spec.upstream === "string" && spec.upstream.length > 0) {
    return spec.healthCheck
      ? {
          type: "upstream",
          address: spec.upstream,
          healthCheck: spec.healthCheck,
        }
      : { type: "upstream", address: spec.upstream };
  }
  throw new Error(
    "ProxyRouteSpec: must specify either `target` or `upstream`",
  );
};

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
