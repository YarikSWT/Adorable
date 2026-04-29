// Тесты на shape Caddy-config'а для static-target'ов (file_server).
// Не требуют live Caddy — выполняются на чистом JSON-выходе buildRoute.
//
// Корпус — что должно совпадать с Caddyfile-эквивалентом:
//   <hostname> {
//     root * <rootDir>
//     try_files {path} {path}/ /index.html
//     file_server
//   }

import { describe, expect, it } from "vitest";

import { __buildRouteForTest } from "@/lib/adapters/proxy-caddy";

const baseSpec = {
  id: "proj-1",
  hostname: "proj-1.preview.localhost",
};

describe("Caddy file_server route shape", () => {
  it("produces subroute with file matcher + rewrite + file_server", () => {
    const route = __buildRouteForTest(baseSpec, {
      type: "static",
      rootDir: "/data/static/proj-1/current",
    });
    expect(route["@id"]).toBe("adorable-route-proj-1");
    expect(route.match).toEqual([{ host: ["proj-1.preview.localhost"] }]);
    expect(route.terminal).toBe(true);

    const handle = route.handle?.[0] as unknown as {
      handler: string;
      routes: Array<{
        match?: Array<{ file?: { try_files?: string[] } }>;
        handle?: Array<{ handler?: string; uri?: string; root?: string }>;
      }>;
    };
    expect(handle.handler).toBe("subroute");

    // First route: file matcher + rewrite to matched file.
    const tryFiles = handle.routes[0]?.match?.[0]?.file?.try_files;
    expect(tryFiles).toEqual([
      "{http.request.uri.path}",
      "{http.request.uri.path}/",
      "/index.html",
    ]);
    expect(handle.routes[0]?.handle?.[0]?.handler).toBe("rewrite");
    expect(handle.routes[0]?.handle?.[0]?.uri).toBe(
      "{http.matchers.file.relative}",
    );

    // Second route: file_server with root.
    expect(handle.routes[1]?.handle?.[0]?.handler).toBe("file_server");
    expect(handle.routes[1]?.handle?.[0]?.root).toBe(
      "/data/static/proj-1/current",
    );
  });

  it("respects custom tryFiles override", () => {
    const route = __buildRouteForTest(baseSpec, {
      type: "static",
      rootDir: "/data/static/proj-2/current",
      tryFiles: ["{path}", "/200.html"],
    });
    const handle = route.handle?.[0] as unknown as {
      routes: Array<{ match?: Array<{ file?: { try_files?: string[] } }> }>;
    };
    expect(handle.routes[0]?.match?.[0]?.file?.try_files).toEqual([
      "{path}",
      "/200.html",
    ]);
  });
});

describe("Caddy reverse_proxy route shape (regression)", () => {
  it("populates reverse_proxy upstreams from upstream-target", () => {
    const route = __buildRouteForTest(baseSpec, {
      type: "upstream",
      address: "10.0.0.5:5173",
    });
    const handle0 = route.handle?.[0] as unknown as {
      handler: string;
      upstreams?: Array<{ dial?: string }>;
    };
    expect(handle0.handler).toBe("reverse_proxy");
    expect(handle0.upstreams?.[0]?.dial).toBe("10.0.0.5:5173");
  });
});
