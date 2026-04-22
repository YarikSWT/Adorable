// Caddy 2 ProxyProvider через Admin API.
//
// Каждый роут хранится с Caddy `@id = adorable-<spec.id>`. Это позволяет
// точечно обновлять / удалять роуты через /id/<@id> endpoints без
// знания индекса в массиве routes.
//
// Endpoints:
//   PUT    /id/<@id>   — upsert (idempotent).
//   DELETE /id/<@id>   — remove.
//   GET    /config/apps/http/servers/{server}/routes — listing (fallback).
//   GET    /config/apps/http/servers/{server}/routes — we also need to
//          append newly-created routes to this array if @id is fresh.
//
// Caddy поведение: `PUT /id/<newId>` без существующего объекта
// возвращает 404. Поэтому первое создание идёт через POST в массив
// routes; обновление — через PUT по /id. Мы абстрагируем это в addRoute.

import {
  getSharedAuditLogger,
  type AuditLogger,
} from "@/lib/sandbox/audit-log";
import type {
  ProxyProvider,
  ProxyRouteInfo,
  ProxyRouteSpec,
} from "./proxy";

type CaddyRoute = {
  "@id"?: string;
  match?: Array<{ host?: string[] }>;
  handle?: Array<{
    handler?: string;
    upstreams?: Array<{ dial?: string }>;
    [k: string]: unknown;
  }>;
  terminal?: boolean;
};

type CaddyHttpConfig = {
  servers?: Record<
    string,
    {
      routes?: CaddyRoute[];
      [k: string]: unknown;
    }
  >;
};

const ID_PREFIX = "adorable-route-";

const buildId = (rawId: string): string => `${ID_PREFIX}${rawId}`;

const buildRoute = (spec: ProxyRouteSpec): CaddyRoute => {
  // Caddy `health_checks.active.expect_status` хочет одно число-префикс
  // (например 2 = 2xx). По-умолчанию отключаем active health check и
  // полагаемся на passive (Caddy сам marks bad upstream при сетевых
  // ошибках). Это также упрощает dev: dev-сервер на sandbox-контейнере
  // не всегда успевает ответить 2xx сразу после старта.
  const healthCheckConfig = spec.healthCheck
    ? {
        active: {
          uri: spec.healthCheck.path ?? "/",
          interval: `${spec.healthCheck.intervalSec ?? 10}s`,
          timeout: `${spec.healthCheck.timeoutSec ?? 2}s`,
          expect_status: Math.floor(
            (spec.healthCheck.expectStatusMin ?? 200) / 100,
          ),
        },
      }
    : undefined;

  const handle: NonNullable<CaddyRoute["handle"]>[number] = {
    handler: "reverse_proxy",
    upstreams: [{ dial: spec.upstream }],
    ...(healthCheckConfig ? { health_checks: healthCheckConfig } : {}),
  };

  return {
    "@id": buildId(spec.id),
    match: [{ host: [spec.hostname] }],
    handle: [handle],
    terminal: true,
  };
};

const resolveAdminUrl = (): string =>
  (
    process.env["CADDY_ADMIN_URL"] ??
    "http://localhost:2019"
  ).replace(/\/+$/, "");

const resolveServerName = (): string =>
  process.env["CADDY_SERVER_NAME"] ?? "preview";

export const createCaddyProxyProvider = (
  options: {
    adminUrl?: string;
    serverName?: string;
    auditLogger?: AuditLogger;
  } = {},
): ProxyProvider => {
  const adminUrl = (options.adminUrl ?? resolveAdminUrl()).replace(/\/+$/, "");
  const serverName = options.serverName ?? resolveServerName();
  const auditLogger = options.auditLogger ?? getSharedAuditLogger();

  const apiJson = async (
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; json: unknown; text: string }> => {
    // Small retry loop — Caddy's admin API sometimes closes the keep-alive
    // connection mid-stream on back-to-back mutating requests, which
    // surfaces as `UND_ERR_SOCKET` / "other side closed" in undici.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${adminUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Connection: "close",
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          cache: "no-store",
        });
        const text = await res.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        return { ok: res.ok, status: res.status, json, text };
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  };

  const ensureServer = async (): Promise<void> => {
    // Make sure the target server exists; if it doesn't, create an empty
    // one listening on :80 so we don't fight the operator's base config.
    const r = await apiJson(
      "GET",
      `/config/apps/http/servers/${encodeURIComponent(serverName)}`,
    );
    if (r.ok) return;
    // Initialize the http.servers.<serverName> scaffold if missing.
    const root = await apiJson("GET", `/config/apps/http`);
    if (!root.ok) {
      await apiJson("POST", `/config/apps/http`, {
        servers: { [serverName]: { listen: [":80"], routes: [] } },
      });
    } else {
      await apiJson(
        "PUT",
        `/config/apps/http/servers/${encodeURIComponent(serverName)}`,
        { listen: [":80"], routes: [] },
      );
    }
  };

  const getHttpConfig = async (): Promise<CaddyHttpConfig> => {
    const r = await apiJson("GET", `/config/apps/http`);
    return r.ok ? (r.json as CaddyHttpConfig) ?? {} : {};
  };

  const parseInfoFromRoute = (route: CaddyRoute): ProxyRouteInfo | null => {
    const id = route["@id"];
    if (!id || !id.startsWith(ID_PREFIX)) return null;
    const host = route.match?.[0]?.host?.[0] ?? "";
    const upstream =
      (route.handle?.[0]?.upstreams as Array<{ dial?: string }> | undefined)?.[0]
        ?.dial ?? "";
    return {
      id: id.slice(ID_PREFIX.length),
      hostname: host,
      upstream,
    };
  };

  const addRoute: ProxyProvider["addRoute"] = async (spec: ProxyRouteSpec) => {
    await ensureServer();
    const route = buildRoute(spec);
    const id = route["@id"]!;

    // Semantics for Caddy's /id/<@id> endpoint:
    //   PUT   — inserts at the indexed path (list INSERT, not replace).
    //   PATCH — replaces the value in place (what we want for idempotent update).
    //   DELETE — removes.
    //
    // For a fresh @id both PUT and PATCH return 404 (no known object).
    // We therefore try PATCH first; on 404 we POST-append to routes[...].

    const patch = await apiJson("PATCH", `/id/${encodeURIComponent(id)}`, route);
    if (patch.ok) {
      await auditLogger.log({
        event: "proxy_route_added",
        hostname: spec.hostname,
        upstream: spec.upstream,
        sandboxId: spec.sandboxId,
      });
      return {
        id: spec.id,
        hostname: spec.hostname,
        upstream: spec.upstream,
        ...(spec.sandboxId ? { sandboxId: spec.sandboxId } : {}),
      };
    }
    if (patch.status !== 404) {
      throw new Error(
        `proxy-caddy: PATCH /id/${id} failed (${patch.status}): ${patch.text}`,
      );
    }

    // No existing object with this @id — append via POST.
    const post = await apiJson(
      "POST",
      `/config/apps/http/servers/${encodeURIComponent(serverName)}/routes/...`,
      [route],
    );
    if (!post.ok) {
      throw new Error(
        `proxy-caddy: POST routes failed (${post.status}): ${post.text}`,
      );
    }
    await auditLogger.log({
      event: "proxy_route_added",
      hostname: spec.hostname,
      upstream: spec.upstream,
      sandboxId: spec.sandboxId,
    });
    return {
      id: spec.id,
      hostname: spec.hostname,
      upstream: spec.upstream,
      ...(spec.sandboxId ? { sandboxId: spec.sandboxId } : {}),
    };
  };

  const removeRoute: ProxyProvider["removeRoute"] = async (id: string) => {
    const del = await apiJson("DELETE", `/id/${encodeURIComponent(buildId(id))}`);
    if (!del.ok && del.status !== 404) {
      throw new Error(
        `proxy-caddy: DELETE /id/${id} failed (${del.status}): ${del.text}`,
      );
    }
    await auditLogger.log({
      event: "proxy_route_removed",
      hostname: "",
      sandboxId: undefined,
    });
  };

  const removeSandboxRoutes: ProxyProvider["removeSandboxRoutes"] = async (
    sandboxId: string,
  ) => {
    // Caddy doesn't index routes by sandboxId — we enumerate and match.
    const cfg = await getHttpConfig();
    const routes = cfg.servers?.[serverName]?.routes ?? [];
    for (const r of routes) {
      const info = parseInfoFromRoute(r);
      if (!info) continue;
      // Routes registered via our addRoute never embed sandboxId into the
      // Caddy object (it's not an index key). We treat `id` as the match
      // criterion — in practice our callers use sandboxId as the route id.
      if (info.id === sandboxId || info.id.startsWith(`${sandboxId}-`)) {
        await removeRoute(info.id);
      }
    }
  };

  const listRoutes: ProxyProvider["listRoutes"] = async () => {
    const cfg = await getHttpConfig();
    const routes = cfg.servers?.[serverName]?.routes ?? [];
    const infos: ProxyRouteInfo[] = [];
    for (const r of routes) {
      const info = parseInfoFromRoute(r);
      if (info) infos.push(info);
    }
    return infos;
  };

  const healthCheck: ProxyProvider["healthCheck"] = async () => {
    try {
      const r = await apiJson("GET", `/config/`);
      return r.ok;
    } catch {
      return false;
    }
  };

  return {
    name: "caddy",
    addRoute,
    removeRoute,
    removeSandboxRoutes,
    listRoutes,
    healthCheck,
  };
};
