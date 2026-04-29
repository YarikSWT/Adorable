// Tests for migrateRepoToStatic — Phase 5 per-project sandbox→static.

import { describe, expect, it, vi } from "vitest";

import {
  SANDBOX_CAPABILITIES,
  STATIC_CAPABILITIES,
  type PreviewProvider,
} from "@/lib/adapters/preview";
import { createMockPreviewProvider } from "@/lib/adapters/preview-mock";
import type { SandboxProvider } from "@/lib/adapters/sandbox";
import { migrateRepoToStatic } from "@/lib/preview/migrate-to-static";
import type { RepoMetadata } from "@/lib/repo-storage";

const baseMetadata = (overrides: Partial<RepoMetadata> = {}): RepoMetadata => ({
  version: 2,
  sourceRepoId: "src-1",
  vm: {
    vmId: "sbx-existing",
    previewUrl: "http://old",
    devCommandTerminalUrl: "http://old-dev",
    additionalTerminalsUrl: "http://old-aux",
  },
  conversations: [],
  deployments: [],
  productionDomain: null,
  productionDeploymentId: null,
  ...overrides,
});

const makeStaticProvider = (): PreviewProvider => {
  // The mock provider is allowed (`migrateRepoToStatic` accepts both
  // "static" and "mock" names) — for tests we use the mock.
  return createMockPreviewProvider({
    capabilities: STATIC_CAPABILITIES,
    previewBaseDomain: "preview.test",
    publishedBaseDomain: "test",
  });
};

const makeSandboxProvider = (
  destroyImpl: (id: string) => Promise<void> = async () => {},
): SandboxProvider =>
  ({
    name: "mock",
    create: vi.fn(),
    ref: vi.fn(),
    list: vi.fn(),
    destroy: vi.fn(destroyImpl) as SandboxProvider["destroy"],
  }) as unknown as SandboxProvider;

describe("migrateRepoToStatic — happy path", () => {
  it("destroys sandbox, creates static preview, rewrites metadata", async () => {
    const sandboxProvider = makeSandboxProvider();
    const staticProvider = makeStaticProvider();

    const result = await migrateRepoToStatic({
      sourceRepoId: "src-1",
      metadata: baseMetadata({
        boilerplateVersion: "1.0.0",
        preview: {
          provider: "sandbox",
          capabilities: SANDBOX_CAPABILITIES,
          createdAt: "earlier",
          migrationStatus: "ok",
        },
      }),
      staticProvider,
      sandboxProvider,
      boilerplateVersion: "1.0.0",
      now: () => "2026-04-29T12:00:00.000Z",
    });

    expect(result.changed).toBe(true);
    expect(result.destroyedSandboxId).toBe("sbx-existing");
    expect(result.destroySucceeded).toBe(true);
    expect(sandboxProvider.destroy).toHaveBeenCalledWith("sbx-existing");

    // Metadata reshape:
    expect(result.metadata.preview?.provider).toBe("static");
    expect(result.metadata.preview?.capabilities).toEqual(STATIC_CAPABILITIES);
    expect(result.metadata.preview?.createdAt).toBe("2026-04-29T12:00:00.000Z");
    expect(result.metadata.preview?.migrationStatus).toBe("ok");
    expect(result.metadata.boilerplateVersion).toBe("1.0.0");

    // vm field synthesized from PreviewMetadata (no terminalUrls in static).
    expect(result.metadata.vm.vmId).toBe("src-1");
    expect(result.metadata.vm.previewUrl).toContain("src-1");
    expect(result.metadata.vm.devCommandTerminalUrl).toBe("");
    expect(result.metadata.vm.additionalTerminalsUrl).toBe("");

    expect(result.applied).toEqual(
      expect.arrayContaining([
        "sandbox-destroyed=sbx-existing",
        "preview.provider=static",
        "vm-resynthesized",
        "boilerplateVersion=1.0.0",
      ]),
    );
  });

  it("works when sandbox-destroy throws (idempotency)", async () => {
    const sandboxProvider = makeSandboxProvider(async () => {
      throw new Error("container already gone");
    });
    const staticProvider = makeStaticProvider();
    const result = await migrateRepoToStatic({
      sourceRepoId: "src-2",
      metadata: baseMetadata({ sourceRepoId: "src-2" }),
      staticProvider,
      sandboxProvider,
      boilerplateVersion: "1.0.0",
    });
    expect(result.changed).toBe(true);
    expect(result.destroyedSandboxId).toBe("sbx-existing");
    expect(result.destroySucceeded).toBe(false);
    expect(result.metadata.preview?.provider).toBe("static");
  });
});

describe("migrateRepoToStatic — no-op", () => {
  it("returns skip when project is already on static", async () => {
    const sandboxProvider = makeSandboxProvider();
    const staticProvider = makeStaticProvider();

    const result = await migrateRepoToStatic({
      sourceRepoId: "src-3",
      metadata: baseMetadata({
        preview: {
          provider: "static",
          capabilities: STATIC_CAPABILITIES,
          createdAt: "x",
          migrationStatus: "ok",
        },
      }),
      staticProvider,
      sandboxProvider,
      boilerplateVersion: "1.0.0",
    });

    expect(result.changed).toBe(false);
    expect(result.skipReason).toMatch(/already.*static/i);
    expect(sandboxProvider.destroy).not.toHaveBeenCalled();
  });
});

describe("migrateRepoToStatic — guards", () => {
  it("rejects a non-static / non-mock staticProvider", async () => {
    const sandboxProvider = makeSandboxProvider();
    const wrongProvider = createMockPreviewProvider();
    Object.defineProperty(wrongProvider, "name", { value: "sandbox" });
    await expect(
      migrateRepoToStatic({
        sourceRepoId: "src-4",
        metadata: baseMetadata(),
        staticProvider: wrongProvider,
        sandboxProvider,
        boilerplateVersion: "1.0.0",
      }),
    ).rejects.toThrow(/staticProvider.name/);
  });
});
