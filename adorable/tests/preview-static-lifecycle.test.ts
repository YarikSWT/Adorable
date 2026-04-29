// Unit-тесты для preview-static lifecycle (create/destroy/touch/getProjectFs).
// build() — это docker-зависимая часть, тестируется отдельно integration-suite'ом.
//
// Тесты используют tmpdir для PROJECTS_ROOT/STATIC_ROOT и mock proxy.

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STATIC_CAPABILITIES,
  type PreviewProvider,
} from "@/lib/adapters/preview";
import { createMockProxyProvider } from "@/lib/adapters/proxy-mock";
import { createStaticPreviewProvider } from "@/lib/adapters/preview-static";

let projectsRoot: string;
let staticRoot: string;
let proxy: ReturnType<typeof createMockProxyProvider>;
let provider: PreviewProvider;

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "adorable-static-projects-"));
  staticRoot = await mkdtemp(path.join(tmpdir(), "adorable-static-static-"));
  proxy = createMockProxyProvider();
  provider = createStaticPreviewProvider({
    projectsRoot,
    staticRoot,
    previewDomainSuffix: "preview.test",
    publishedDomainSuffix: "test",
    previewProtocol: "http",
    previewPortSegment: "",
    proxyProviderFactory: async () => proxy,
  });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
  await rm(staticRoot, { recursive: true, force: true });
});

describe("StaticPreviewProvider — create()", () => {
  it("returns metadata with static capabilities + URLs (hashed subdomain)", async () => {
    const meta = await provider.create({
      repoId: "proj-a",
      boilerplateVersion: "1.0.0",
    });
    expect(meta.projectId).toBe("proj-a");
    // Subdomain is sha256(repoId).slice(0,8) so HTTP Host stays valid
    // even when repoId contains slashes (e.g. "owner/name").
    expect(meta.previewUrl).toBe("http://5c303908.preview.test");
    expect(meta.publishedUrl).toBe("http://5c303908.test");
    expect(meta.capabilities).toEqual(STATIC_CAPABILITIES);
    expect(meta.terminalUrls).toBeUndefined();
  });

  it("repoId with slash produces DNS-safe hashed subdomain (Caddy-compatible)", async () => {
    const meta = await provider.create({
      repoId: "owner/repo-with-slash",
      boilerplateVersion: "1.0.0",
    });
    // Hostname must NOT contain a slash — that's invalid in HTTP Host.
    const url = new URL(meta.previewUrl);
    expect(url.hostname).not.toContain("/");
    expect(url.hostname).toMatch(/^[0-9a-f]{8}\.preview\.test$/);
  });

  it("creates scratch dir with template src/public/functions copied", async () => {
    await provider.create({ repoId: "proj-b", boilerplateVersion: "1.0.0" });
    const scratch = path.join(projectsRoot, "proj-b");
    // src/main.jsx / App.jsx exist
    expect((await stat(path.join(scratch, "src", "main.jsx"))).isFile()).toBe(
      true,
    );
    expect((await stat(path.join(scratch, "src", "App.jsx"))).isFile()).toBe(
      true,
    );
    // .vite + .cache directories exist
    expect((await stat(path.join(scratch, ".vite"))).isDirectory()).toBe(true);
    expect((await stat(path.join(scratch, ".cache"))).isDirectory()).toBe(true);
  });

  it("creates static dir with placeholder current symlink", async () => {
    await provider.create({ repoId: "proj-c", boilerplateVersion: "1.0.0" });
    const staticDir = path.join(staticRoot, "proj-c");
    const current = path.join(staticDir, "current");
    // current symlink resolves to placeholder index.html
    expect((await stat(current)).isDirectory()).toBe(true);
    const indexContent = await readFile(
      path.join(current, "index.html"),
      "utf8",
    );
    expect(indexContent).toContain("Initial build pending");
  });

  it("registers a Caddy file_server route", async () => {
    await provider.create({ repoId: "proj-d", boilerplateVersion: "1.0.0" });
    const routes = await proxy.listRoutes();
    expect(routes).toHaveLength(1);
    // routeId also uses the slug — Caddy's `/id/<@id>` REST URL would
    // otherwise split on a literal slash.
    expect(routes[0].id).toBe("static-268d5ee9");
    expect(routes[0].hostname).toBe("268d5ee9.preview.test");
    expect(routes[0].target.type).toBe("static");
  });

  it("is idempotent — second create returns same metadata, no duplicate routes", async () => {
    const a = await provider.create({
      repoId: "proj-e",
      boilerplateVersion: "1.0.0",
    });
    const b = await provider.create({
      repoId: "proj-e",
      boilerplateVersion: "1.0.0",
    });
    expect(b).toEqual(a);
    const routes = await proxy.listRoutes();
    expect(routes).toHaveLength(1);
  });
});

describe("StaticPreviewProvider — destroy()", () => {
  it("removes scratch dir, static dir, and proxy route", async () => {
    await provider.create({ repoId: "proj-x", boilerplateVersion: "1.0.0" });
    expect((await stat(path.join(projectsRoot, "proj-x"))).isDirectory()).toBe(
      true,
    );

    await provider.destroy("proj-x");

    await expect(stat(path.join(projectsRoot, "proj-x"))).rejects.toThrow();
    await expect(stat(path.join(staticRoot, "proj-x"))).rejects.toThrow();
    expect(await proxy.listRoutes()).toEqual([]);
  });

  it("is idempotent for unknown projectId", async () => {
    await provider.destroy("never-existed");
    // No throw expected.
  });
});

describe("StaticPreviewProvider — touch()", () => {
  it("updates lastTouchedAt for known projectId", async () => {
    await provider.create({ repoId: "proj-y", boilerplateVersion: "1.0.0" });
    await new Promise((r) => setTimeout(r, 5));
    await provider.touch("proj-y");
    // Internal state — we can't observe directly, but call should not throw
    // and is required by interface.
  });

  it("is idempotent for unknown projectId", async () => {
    await provider.touch("never-existed");
  });
});

describe("StaticPreviewProvider — getProjectFs()", () => {
  it("returns ProjectFs scoped to scratch dir for known project", async () => {
    await provider.create({ repoId: "proj-z", boilerplateVersion: "1.0.0" });
    const fs = await provider.getProjectFs("proj-z");
    if (!fs) throw new Error("expected fs");
    expect(await fs.exists("src/App.jsx")).toBe(true);
    // Whitelist enforced — non-writable path throws path-not-writable.
    await expect(
      fs.writeTextFile("package.json", "{}"),
    ).rejects.toMatchObject({ code: "path-not-writable" });
    // Whitelisted path roundtrips.
    await fs.writeTextFile("src/extra.jsx", "export const X = 1;");
    expect(await fs.readTextFile("src/extra.jsx")).toContain("X");
  });

  it("returns null for unknown projectId", async () => {
    expect(await provider.getProjectFs("never-existed")).toBeNull();
  });
});

// build() flow is fully covered by tests/preview-static-build.test.ts
// (uses an injected mock BuildExecutor). Calling build() here without
// an executor would attempt a real docker connection — out of scope
// for lifecycle tests.
