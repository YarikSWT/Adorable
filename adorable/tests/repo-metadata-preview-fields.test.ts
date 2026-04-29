// Тесты round-trip для новых полей RepoMetadata: boilerplateVersion +
// preview (CONTRACTS §12). Используем mock git provider singleton.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readRepoMetadata,
  writeRepoMetadata,
  type RepoMetadata,
  type RepoPreviewMetadata,
} from "@/lib/repo-storage";
import {
  __resetGitSingleton,
  getGitProvider,
} from "@/lib/git/provider-singleton";

const baseMetadata = (sourceRepoId: string): RepoMetadata => ({
  version: 2,
  sourceRepoId,
  vm: {
    vmId: "vm-1",
    previewUrl: "http://example",
    devCommandTerminalUrl: "http://example",
    additionalTerminalsUrl: "http://example",
  },
  conversations: [],
  deployments: [],
  productionDomain: null,
  productionDeploymentId: null,
});

let wrapRepoId: string;
let srcRepoId: string;

beforeEach(async () => {
  __resetGitSingleton();
  const provider = await getGitProvider();
  const wrap = await provider.createRepo({ name: "wrap", private: true });
  const src = await provider.createRepo({ name: "src", private: true });
  wrapRepoId = wrap.repoId;
  srcRepoId = src.repoId;
});

afterEach(() => {
  __resetGitSingleton();
});

describe("RepoMetadata — boilerplateVersion + preview round-trip", () => {
  it("persists boilerplateVersion across read/write", async () => {
    const meta: RepoMetadata = {
      ...baseMetadata(srcRepoId),
      boilerplateVersion: "1.0.0",
    };
    await writeRepoMetadata(wrapRepoId, meta);
    const loaded = await readRepoMetadata(wrapRepoId);
    expect(loaded?.boilerplateVersion).toBe("1.0.0");
  });

  it("persists preview block across read/write", async () => {
    const preview: RepoPreviewMetadata = {
      provider: "static",
      capabilities: {
        shellAccess: false,
        customDependencies: false,
        serverRuntime: false,
        hotReload: false,
        manualRebuild: true,
      },
      createdAt: "2026-04-29T12:00:00Z",
      migrationStatus: "ok",
    };
    const meta: RepoMetadata = {
      ...baseMetadata(srcRepoId),
      boilerplateVersion: "1.0.0",
      preview,
    };
    await writeRepoMetadata(wrapRepoId, meta);
    const loaded = await readRepoMetadata(wrapRepoId);
    expect(loaded?.preview).toEqual(preview);
  });

  it("backwards compatible — old metadata without new fields still loads", async () => {
    // Write base metadata (no boilerplateVersion / preview).
    await writeRepoMetadata(wrapRepoId, baseMetadata(srcRepoId));
    const loaded = await readRepoMetadata(wrapRepoId);
    expect(loaded).toBeDefined();
    expect(loaded?.boilerplateVersion).toBeUndefined();
    expect(loaded?.preview).toBeUndefined();
  });

  it("preview.publishedAt + publishedBuildId persist", async () => {
    const meta: RepoMetadata = {
      ...baseMetadata(srcRepoId),
      boilerplateVersion: "1.2.3",
      preview: {
        provider: "static",
        capabilities: {
          shellAccess: false,
          customDependencies: false,
          serverRuntime: false,
          hotReload: false,
          manualRebuild: true,
        },
        createdAt: "2026-04-29T12:00:00Z",
        publishedAt: "2026-04-29T12:30:00Z",
        publishedBuildId: "2026-04-29T12-30-00Z-abcd",
      },
    };
    await writeRepoMetadata(wrapRepoId, meta);
    const loaded = await readRepoMetadata(wrapRepoId);
    expect(loaded?.preview?.publishedAt).toBe("2026-04-29T12:30:00Z");
    expect(loaded?.preview?.publishedBuildId).toBe("2026-04-29T12-30-00Z-abcd");
  });
});
