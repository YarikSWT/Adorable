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
import {
  resolveRouteTarget,
  type ProxyProvider,
  type ProxyRouteInfo,
  type ProxyRouteSpec,
  type ProxyRouteTarget,
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

const DEFAULT_TRY_FILES: ReadonlyArray<string> = [
  "{http.request.uri.path}",
  "{http.request.uri.path}/",
  "/index.html",
];

const buildStaticRoute = (
  spec: ProxyRouteSpec,
  target: Extract<ProxyRouteTarget, { type: "static" }>,
): CaddyRoute => {
  // Equivalent to:
  //   <hostname> { root * <rootDir>; try_files {path} {path}/ /index.html; file_server }
  //
  // В JSON это subroute с двумя routes: первый делает rewrite на
  // try_files-matched путь, второй — file_server. Конструкция
  // соответствует Caddyfile-направляющим try_files+file_server.
  const tryFiles = target.tryFiles ?? Array.from(DEFAULT_TRY_FILES);
  return {
    "@id": buildId(spec.id),
    match: [{ host: [spec.hostname] }],
    handle: [
      {
        handler: "subroute",
        routes: [
          {
            match: [{ file: { try_files: tryFiles } }],
            handle: [
              {
                handler: "rewrite",
                uri: "{http.matchers.file.relative}",
              },
            ],
          },
          {
            handle: [
              {
                handler: "file_server",
                root: target.rootDir,
              },
            ],
          },
        ],
      } as unknown as NonNullable<CaddyRoute["handle"]>[number],
    ],
    terminal: true,
  };
};

// Exposed as `__buildRouteForTest` ниже — internal helper, не часть
// публичного API. Тесты на shape Caddy-config'а ходят через него
// чтобы не запускать live Caddy.
const buildRoute = (
  spec: ProxyRouteSpec,
  target: ProxyRouteTarget,
): CaddyRoute => {
  if (target.type === "static") {
    return buildStaticRoute(spec, target);
  }
  // Caddy `health_checks.active.expect_status` хочет одно число-префикс
  // (например 2 = 2xx). По-умолчанию отключаем active health check и
  // полагаемся на passive (Caddy сам marks bad upstream при сетевых
  // ошибках). Это также упрощает dev: dev-сервер на sandbox-контейнере
  // не всегда успевает ответить 2xx сразу после старта.
  const hc = target.healthCheck ?? spec.healthCheck;
  const healthCheckConfig = hc
    ? {
        active: {
          uri: hc.path ?? "/",
          interval: `${hc.intervalSec ?? 10}s`,
          timeout: `${hc.timeoutSec ?? 2}s`,
          expect_status: Math.floor((hc.expectStatusMin ?? 200) / 100),
        },
      }
    : undefined;

  const handle: NonNullable<CaddyRoute["handle"]>[number] = {
    handler: "reverse_proxy",
    upstreams: [{ dial: target.address }],
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
    // A missing server still returns HTTP 200 — with a literal `null` body
    // (the path is valid but unset). `r.ok` alone therefore reports a
    // non-existent server as present, after which addRoute's POST to
    // .../servers/<name>/routes/... fails with "invalid traversal path".
    // Guard on a non-null value so we actually scaffold the server.
    if (r.ok && r.json != null) return;
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
    const handle0 = route.handle?.[0];
    const handler = handle0?.handler;

    // file_server (static) route — handle[0] = subroute с file_server внутри.
    if (handler === "subroute") {
      const sub = handle0 as unknown as {
        routes?: Array<{
          handle?: Array<{
            handler?: string;
            root?: string;
          }>;
        }>;
      };
      let rootDir = "";
      for (const r of sub.routes ?? []) {
        for (const h of r.handle ?? []) {
          if (h.handler === "file_server" && typeof h.root === "string") {
            rootDir = h.root;
            break;
          }
        }
        if (rootDir) break;
      }
      if (rootDir) {
        return {
          id: id.slice(ID_PREFIX.length),
          hostname: host,
          target: { type: "static", rootDir },
        };
      }
    }

    // Default: reverse_proxy → upstream.
    const upstream =
      (handle0?.upstreams as Array<{ dial?: string }> | undefined)?.[0]?.dial ??
      "";
    return {
      id: id.slice(ID_PREFIX.length),
      hostname: host,
      upstream,
      target: { type: "upstream", address: upstream },
    };
  };

  const addRoute: ProxyProvider["addRoute"] = async (spec: ProxyRouteSpec) => {
    await ensureServer();
    const target = resolveRouteTarget(spec);
    const route = buildRoute(spec, target);
    const id = route["@id"]!;
    // Legacy field — undefined for static targets, address for upstream:
    const upstreamAddr =
      target.type === "upstream" ? target.address : undefined;

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
        upstream: upstreamAddr ?? "",
        sandboxId: spec.sandboxId,
      });
      return {
        id: spec.id,
        hostname: spec.hostname,
        target,
        ...(upstreamAddr !== undefined ? { upstream: upstreamAddr } : {}),
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
      upstream: upstreamAddr ?? "",
      sandboxId: spec.sandboxId,
    });
    return {
      id: spec.id,
      hostname: spec.hostname,
      target,
      ...(upstreamAddr !== undefined ? { upstream: upstreamAddr } : {}),
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

/** Test-only — used by tests/proxy-caddy-static.test.ts to verify
 * the shape of the Caddy JSON config produced for static targets,
 * without requiring a live Caddy admin API. */
export const __buildRouteForTest = (
  spec: ProxyRouteSpec,
  target: ProxyRouteTarget,
): CaddyRoute => buildRoute(spec, target);
