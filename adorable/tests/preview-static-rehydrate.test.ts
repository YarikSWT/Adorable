// Tests for preview-static lazy re-hydration after process restart
// (OPEN_QUESTIONS §L3).
//
// Scenario: a static project's create() ran in a previous process — its
// scratch dir, static dir, current symlink, and .preview-state.json
// all live on disk. The new process spins up a fresh provider with an
// empty in-memory state Map. Calling build() / getProjectFs() /
// destroy() / touch() must transparently re-hydrate from disk instead
// of returning "project not found — call create() first".

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockProxyProvider } from "@/lib/adapters/proxy-mock";
import {
  createStaticPreviewProvider,
  type BuildExecutor,
  type BuildExecutorResult,
} from "@/lib/adapters/preview-static";

const successResult = (): BuildExecutorResult => ({
  exitCode: 0,
  stdout: "vite build OK\n",
  stderr: "",
  cancelled: false,
  timedOut: false,
  durationMs: 12,
});

let projectsRoot: string;
let staticRoot: string;

const makeProvider = (executor: BuildExecutor) => {
  const proxy = createMockProxyProvider();
  return {
    proxy,
    provider: createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      publishedDomainSuffix: "test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: executor,
    }),
  };
};

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "adorable-rehydrate-proj-"));
  staticRoot = await mkdtemp(path.join(tmpdir(), "adorable-rehydrate-static-"));
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
  await rm(staticRoot, { recursive: true, force: true });
});

describe("preview-static — lazy re-hydration after restart", () => {
  it("create() persists .preview-state.json next to static dir", async () => {
    const exec: BuildExecutor = { runBuild: async () => successResult() };
    const { provider } = makeProvider(exec);
    await provider.create({
      repoId: "p-rehy-1",
      boilerplateVersion: "2.5.0",
    });
    const persisted = path.join(
      staticRoot,
      "p-rehy-1",
      ".preview-state.json",
    );
    expect((await stat(persisted)).isFile()).toBe(true);
    const parsed = JSON.parse(await readFile(persisted, "utf8"));
    expect(parsed.boilerplateVersion).toBe("2.5.0");
    expect(typeof parsed.createdAt).toBe("string");
  });

  it("build() on a project that was created in a previous process succeeds", async () => {
    const captured: string[] = [];
    const exec: BuildExecutor = {
      async runBuild(opts) {
        captured.push(opts.boilerplateVersion);
        return successResult();
      },
    };

    // First "process": create the project so disk has everything.
    {
      const { provider } = makeProvider(exec);
      await provider.create({
        repoId: "p-rehy-2",
        boilerplateVersion: "3.0.1",
      });
    }

    // Second "process": fresh provider (empty state Map).
    const { provider: fresh } = makeProvider(exec);
    const res = await fresh.build({ projectId: "p-rehy-2", reason: "manual" });
    expect(res.status).toBe("succeeded");
    expect(res.exitCode).toBe(0);
    // Boilerplate version recovered from disk-persisted state.
    expect(captured).toEqual(["3.0.1"]);
  });

  it("getProjectFs() re-hydrates and returns a usable fs", async () => {
    const exec: BuildExecutor = { runBuild: async () => successResult() };
    {
      const { provider } = makeProvider(exec);
      await provider.create({
        repoId: "p-rehy-3",
        boilerplateVersion: "1.0.0",
      });
    }
    // Drop a file via direct disk write so we can verify fs works.
    await writeFile(
      path.join(projectsRoot, "p-rehy-3", "src", "marker.txt"),
      "hello",
    );

    const { provider: fresh } = makeProvider(exec);
    const fs = await fresh.getProjectFs("p-rehy-3");
    expect(fs).not.toBeNull();
    const content = await fs!.readTextFile("src/marker.txt");
    expect(content).toBe("hello");
  });

  it("returns null/failed for a project that was never created", async () => {
    const exec: BuildExecutor = { runBuild: async () => successResult() };
    const { provider } = makeProvider(exec);
    const fs = await provider.getProjectFs("never-created");
    expect(fs).toBeNull();
    const res = await provider.build({
      projectId: "never-created",
      reason: "manual",
    });
    expect(res.status).toBe("failed");
    expect(res.errors[0].message).toMatch(/not found/i);
  });

  it("falls back to boilerplateVersion=1.0.0 when .preview-state.json is missing (legacy projects)", async () => {
    const captured: string[] = [];
    const exec: BuildExecutor = {
      async runBuild(opts) {
        captured.push(opts.boilerplateVersion);
        return successResult();
      },
    };
    {
      const { provider } = makeProvider(exec);
      await provider.create({
        repoId: "p-rehy-legacy",
        boilerplateVersion: "9.9.9",
      });
    }
    // Simulate legacy project: delete the persisted state file.
    await rm(
      path.join(staticRoot, "p-rehy-legacy", ".preview-state.json"),
      { force: true },
    );

    const { provider: fresh } = makeProvider(exec);
    const res = await fresh.build({
      projectId: "p-rehy-legacy",
      reason: "manual",
    });
    expect(res.status).toBe("succeeded");
    expect(captured).toEqual(["1.0.0"]);
  });
});
