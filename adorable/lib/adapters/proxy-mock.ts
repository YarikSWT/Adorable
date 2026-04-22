// In-memory ProxyProvider для unit-тестов.
//
// Хранит роуты в Map, семантика addRoute = idempotent upsert.

import type {
  ProxyProvider,
  ProxyRouteInfo,
  ProxyRouteSpec,
} from "./proxy";

export interface MockProxyProvider extends ProxyProvider {
  inspect: () => Map<string, ProxyRouteInfo>;
  /** Break health check for tests that verify error paths. */
  setHealthy: (healthy: boolean) => void;
  /** Spy on addRoute/removeRoute call counts. */
  stats: () => { adds: number; removes: number };
  reset: () => void;
}

export const createMockProxyProvider = (): MockProxyProvider => {
  const routes = new Map<string, ProxyRouteInfo>();
  let healthy = true;
  let adds = 0;
  let removes = 0;

  const addRoute: ProxyProvider["addRoute"] = async (spec: ProxyRouteSpec) => {
    const info: ProxyRouteInfo = {
      id: spec.id,
      hostname: spec.hostname,
      upstream: spec.upstream,
      ...(spec.sandboxId ? { sandboxId: spec.sandboxId } : {}),
    };
    routes.set(spec.id, info);
    adds++;
    return info;
  };

  const removeRoute: ProxyProvider["removeRoute"] = async (id: string) => {
    if (routes.delete(id)) removes++;
  };

  const removeSandboxRoutes: ProxyProvider["removeSandboxRoutes"] = async (
    sandboxId: string,
  ) => {
    for (const [id, info] of routes.entries()) {
      if (info.sandboxId === sandboxId) {
        routes.delete(id);
        removes++;
      }
    }
  };

  const listRoutes: ProxyProvider["listRoutes"] = async () =>
    Array.from(routes.values());

  const healthCheck: ProxyProvider["healthCheck"] = async () => healthy;

  return {
    name: "mock",
    addRoute,
    removeRoute,
    removeSandboxRoutes,
    listRoutes,
    healthCheck,
    inspect: () => routes,
    setHealthy: (h: boolean) => {
      healthy = h;
    },
    stats: () => ({ adds, removes }),
    reset: () => {
      routes.clear();
      adds = 0;
      removes = 0;
      healthy = true;
    },
  };
};
