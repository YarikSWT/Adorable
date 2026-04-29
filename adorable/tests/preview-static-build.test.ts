// Тесты для preview-static.build() — orchestration слой:
//   - правильный exit-code → status mapping (succeeded/failed/cancelled)
//   - parsing stderr через build-error-parser
//   - atomic symlink swap при success
//   - skipCurrentSwap → wasSwapped=false но артефакт остаётся
//   - cancellation → artifactDir удаляется, status=cancelled
//   - build-history GC соблюдает limit + protects current/previous
//
// Использует mock executor — docker daemon не нужен.

import { mkdtemp, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockProxyProvider } from "@/lib/adapters/proxy-mock";
import {
  createStaticPreviewProvider,
  type BuildExecutor,
  type BuildExecutorResult,
} from "@/lib/adapters/preview-static";
import type { PreviewProvider } from "@/lib/adapters/preview";

const successResult = (): BuildExecutorResult => ({
  exitCode: 0,
  stdout: "vite v5.4.8 building for production\n✓ built\n",
  stderr: "",
  cancelled: false,
  timedOut: false,
  durationMs: 42,
});

const failResult = (): BuildExecutorResult => ({
  exitCode: 1,
  stdout: "",
  stderr: `Could not resolve "axios" from src/api.ts\n`,
  cancelled: false,
  timedOut: false,
  durationMs: 30,
});

let projectsRoot: string;
let staticRoot: string;
let proxy: ReturnType<typeof createMockProxyProvider>;

const makeProvider = (executor: BuildExecutor): PreviewProvider =>
  createStaticPreviewProvider({
    projectsRoot,
    staticRoot,
    previewDomainSuffix: "preview.test",
    publishedDomainSuffix: "test",
    previewProtocol: "http",
    previewPortSegment: "",
    proxyProviderFactory: async () => proxy,
    buildExecutor: executor,
    buildHistoryLimit: 3,
  });

beforeEach(async () => {
  projectsRoot = await mkdtemp(
    path.join(tmpdir(), "adorable-build-projects-"),
  );
  staticRoot = await mkdtemp(path.join(tmpdir(), "adorable-build-static-"));
  proxy = createMockProxyProvider();
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
  await rm(staticRoot, { recursive: true, force: true });
});

describe("preview-static.build() — success", () => {
  it("returns succeeded BuildResult with no errors", async () => {
    const executor: BuildExecutor = { runBuild: async () => successResult() };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "p1", boilerplateVersion: "1.0.0" });

    const res = await provider.build({ projectId: "p1", reason: "initial" });
    expect(res.status).toBe("succeeded");
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.wasSwapped).toBe(true);
    expect(res.artifactPath).toBeDefined();
    expect(res.durationMs).toBe(42);
  });

  it("atomically swaps the current symlink to the new build", async () => {
    const executor: BuildExecutor = { runBuild: async () => successResult() };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "p2", boilerplateVersion: "1.0.0" });

    const res = await provider.build({ projectId: "p2", reason: "initial" });
    const currentLink = path.join(staticRoot, "p2", "current");
    const target = await readlink(currentLink);
    expect(target).toMatch(/^builds\//);
    expect(res.artifactPath).toContain(target);
  });

  it("skipCurrentSwap=true keeps the placeholder current symlink", async () => {
    const executor: BuildExecutor = { runBuild: async () => successResult() };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "p3", boilerplateVersion: "1.0.0" });

    const before = await readlink(path.join(staticRoot, "p3", "current"));
    const res = await provider.build({
      projectId: "p3",
      reason: "migration",
      skipCurrentSwap: true,
    });
    const after = await readlink(path.join(staticRoot, "p3", "current"));
    expect(res.status).toBe("succeeded");
    expect(res.wasSwapped).toBe(false);
    expect(after).toBe(before); // current не двинулся
    expect(res.artifactPath).toBeDefined();
    // Артефакт всё равно записан:
    if (res.artifactPath) {
      expect((await stat(res.artifactPath)).isDirectory()).toBe(true);
    }
  });

  it("populates a previous symlink after the second swap", async () => {
    const executor: BuildExecutor = { runBuild: async () => successResult() };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "p4", boilerplateVersion: "1.0.0" });

    await provider.build({ projectId: "p4", reason: "initial" });
    const firstCurrent = await readlink(path.join(staticRoot, "p4", "current"));

    // Force a different buildId for the second build:
    await provider.build({
      projectId: "p4",
      reason: "manual",
      buildId: "second-build",
    });
    const previous = await readlink(path.join(staticRoot, "p4", "previous"));
    expect(previous).toBe(firstCurrent);
  });
});

describe("preview-static.build() — failed", () => {
  it("returns failed status with parsed import-not-allowed error", async () => {
    const executor: BuildExecutor = { runBuild: async () => failResult() };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "pf", boilerplateVersion: "1.0.0" });

    const res = await provider.build({ projectId: "pf", reason: "initial" });
    expect(res.status).toBe("failed");
    expect(res.exitCode).toBe(1);
    expect(res.wasSwapped).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0].code).toBe("import-not-allowed");
    expect(res.errors[0].missingModule).toBe("axios");
    expect(res.errors[0].suggestion).toMatch(/fetch/i);
  });

  it("does not swap current on failure", async () => {
    const executor: BuildExecutor = { runBuild: async () => failResult() };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "pf2", boilerplateVersion: "1.0.0" });

    const before = await readlink(path.join(staticRoot, "pf2", "current"));
    await provider.build({ projectId: "pf2", reason: "initial" });
    const after = await readlink(path.join(staticRoot, "pf2", "current"));
    expect(after).toBe(before);
  });
});

describe("preview-static.build() — cancelled", () => {
  it("returns cancelled status and removes artifact dir", async () => {
    const executor: BuildExecutor = {
      async runBuild() {
        return {
          exitCode: 143,
          stdout: "",
          stderr: "",
          cancelled: true,
          timedOut: false,
          durationMs: 10,
        };
      },
    };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "pc", boilerplateVersion: "1.0.0" });

    const res = await provider.build({
      projectId: "pc",
      reason: "manual",
      buildId: "cancelled-build-id",
    });
    expect(res.status).toBe("cancelled");
    expect(res.wasSwapped).toBe(false);
    // Artifact dir was cleaned:
    await expect(
      stat(path.join(staticRoot, "pc", "builds", "cancelled-build-id")),
    ).rejects.toThrow();
  });
});

describe("preview-static.build() — history GC", () => {
  it("keeps only `buildHistoryLimit` builds + current/previous after a successful build", async () => {
    const executor: BuildExecutor = { runBuild: async () => successResult() };
    const provider = makeProvider(executor);
    await provider.create({ repoId: "pgc", boilerplateVersion: "1.0.0" });

    // Five sequential builds with explicit ascending IDs.
    const buildIds = ["b001", "b002", "b003", "b004", "b005"];
    for (const id of buildIds) {
      await provider.build({
        projectId: "pgc",
        reason: "manual",
        buildId: id,
      });
    }

    // After GC: latest 3 builds + placeholder. b001 should be deleted.
    const buildsDir = path.join(staticRoot, "pgc", "builds");
    const remaining = await (
      await import("node:fs/promises")
    ).readdir(buildsDir);
    // Always keep "placeholder", at most 3 timestamped builds.
    expect(remaining).toContain("placeholder");
    const stamped = remaining.filter((x) => x !== "placeholder");
    expect(stamped.length).toBeLessThanOrEqual(3);
    expect(stamped).toContain("b005"); // current
    expect(stamped).toContain("b004"); // previous
  });
});

describe("preview-static.build() — unknown project", () => {
  it("returns failed result for project that hasn't been created", async () => {
    const executor: BuildExecutor = { runBuild: async () => successResult() };
    const provider = makeProvider(executor);
    const res = await provider.build({
      projectId: "never",
      reason: "initial",
    });
    expect(res.status).toBe("failed");
    expect(res.errors[0].message).toMatch(/not found/i);
  });
});
