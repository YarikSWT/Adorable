// Pure-function tests for migrateRepoMetadata (Phase 5).

import { describe, expect, it } from "vitest";

import {
  SANDBOX_CAPABILITIES,
  STATIC_CAPABILITIES,
} from "@/lib/adapters/preview";
import { migrateRepoMetadata } from "@/lib/preview/migrate-metadata";
import type { RepoMetadata } from "@/lib/repo-storage";

const baseMetadata = (): RepoMetadata => ({
  version: 2,
  sourceRepoId: "src-1",
  vm: {
    vmId: "vm-x",
    previewUrl: "http://x",
    devCommandTerminalUrl: "http://x",
    additionalTerminalsUrl: "http://x",
  },
  conversations: [],
  deployments: [],
  productionDomain: null,
  productionDeploymentId: null,
});

describe("migrateRepoMetadata — backfill", () => {
  it("backfills boilerplateVersion when missing (default 1.0.0)", () => {
    const r = migrateRepoMetadata(baseMetadata());
    expect(r.changed).toBe(true);
    expect(r.metadata.boilerplateVersion).toBe("1.0.0");
    expect(r.applied).toContain("boilerplateVersion=1.0.0");
  });

  it("backfills preview block with sandbox defaults", () => {
    const r = migrateRepoMetadata(baseMetadata(), {
      now: () => "2026-04-29T00:00:00.000Z",
    });
    expect(r.metadata.preview).toEqual({
      provider: "sandbox",
      capabilities: SANDBOX_CAPABILITIES,
      createdAt: "2026-04-29T00:00:00.000Z",
      migrationStatus: "ok",
    });
    expect(r.applied).toContain("preview.provider=sandbox");
  });

  it("respects custom boilerplateVersion", () => {
    const r = migrateRepoMetadata(baseMetadata(), {
      boilerplateVersion: "2.5.0",
    });
    expect(r.metadata.boilerplateVersion).toBe("2.5.0");
  });

  it("respects custom provider + capabilities", () => {
    const r = migrateRepoMetadata(baseMetadata(), {
      provider: "static",
      capabilities: STATIC_CAPABILITIES,
      now: () => "t",
    });
    expect(r.metadata.preview?.provider).toBe("static");
    expect(r.metadata.preview?.capabilities).toEqual(STATIC_CAPABILITIES);
  });
});

describe("migrateRepoMetadata — idempotence", () => {
  it("no-op when both fields already present (returns same reference)", () => {
    const meta: RepoMetadata = {
      ...baseMetadata(),
      boilerplateVersion: "1.0.0",
      preview: {
        provider: "sandbox",
        capabilities: SANDBOX_CAPABILITIES,
        createdAt: "x",
        migrationStatus: "ok",
      },
    };
    const r = migrateRepoMetadata(meta);
    expect(r.changed).toBe(false);
    expect(r.applied).toEqual([]);
    expect(r.metadata).toBe(meta);
  });

  it("only fills missing field — keeps existing boilerplateVersion", () => {
    const meta: RepoMetadata = {
      ...baseMetadata(),
      boilerplateVersion: "9.9.9",
    };
    const r = migrateRepoMetadata(meta, { boilerplateVersion: "1.0.0" });
    expect(r.metadata.boilerplateVersion).toBe("9.9.9");
    expect(r.metadata.preview).toBeDefined();
    expect(r.applied.some((a) => a.startsWith("boilerplateVersion"))).toBe(false);
    expect(r.applied.some((a) => a.startsWith("preview"))).toBe(true);
  });

  it("only fills missing field — keeps existing preview", () => {
    const meta: RepoMetadata = {
      ...baseMetadata(),
      preview: {
        provider: "static",
        capabilities: STATIC_CAPABILITIES,
        createdAt: "earlier",
        migrationStatus: "ok",
      },
    };
    const r = migrateRepoMetadata(meta);
    expect(r.metadata.boilerplateVersion).toBe("1.0.0");
    expect(r.metadata.preview?.provider).toBe("static");
    expect(r.metadata.preview?.createdAt).toBe("earlier");
  });

  it("re-running on already-migrated metadata yields same result", () => {
    const meta = baseMetadata();
    const first = migrateRepoMetadata(meta, { now: () => "t1" });
    expect(first.changed).toBe(true);
    const second = migrateRepoMetadata(first.metadata, { now: () => "t2" });
    expect(second.changed).toBe(false);
    expect(second.metadata).toBe(first.metadata);
  });
});

describe("migrateRepoMetadata — does NOT switch provider", () => {
  it("never overwrites existing preview.provider", () => {
    const meta: RepoMetadata = {
      ...baseMetadata(),
      boilerplateVersion: "1.0.0",
      preview: {
        provider: "sandbox",
        capabilities: SANDBOX_CAPABILITIES,
        createdAt: "x",
        migrationStatus: "ok",
      },
    };
    const r = migrateRepoMetadata(meta, {
      provider: "static",
      capabilities: STATIC_CAPABILITIES,
    });
    expect(r.metadata.preview?.provider).toBe("sandbox");
    expect(r.changed).toBe(false);
  });
});
