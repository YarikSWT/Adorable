// Tests for runMetadataMigration — Phase 5 CLI runner.
//
// Uses mock git provider via __resetGitSingleton + getGitProvider.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetGitSingleton,
  getGitProvider,
} from "@/lib/git/provider-singleton";
import {
  ADORABLE_WRAPPER_REPO_PREFIX,
  writeRepoMetadata,
  type RepoMetadata,
} from "@/lib/repo-storage";
import {
  SANDBOX_CAPABILITIES,
  STATIC_CAPABILITIES,
} from "@/lib/adapters/preview";
import { runMetadataMigration } from "@/lib/preview/migrate-metadata-runner";

const wrapperName = (id: string): string =>
  `${ADORABLE_WRAPPER_REPO_PREFIX}${id}`;

const makeMetadata = (sourceRepoId: string, overrides: Partial<RepoMetadata> = {}): RepoMetadata => ({
  version: 2,
  sourceRepoId,
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
  ...overrides,
});

let wrapperIds: Map<string, string>;

beforeEach(async () => {
  __resetGitSingleton();
  wrapperIds = new Map();
});

afterEach(() => {
  __resetGitSingleton();
});

const seedWrappers = async (
  specs: Array<{
    label: string;
    metadata: RepoMetadata | null;
  }>,
): Promise<void> => {
  const provider = await getGitProvider();
  for (const spec of specs) {
    // Wrapper repo: name starts with adorable-meta-... so isWrapperRepoName matches.
    const wrap = await provider.createRepo({
      name: wrapperName(`12345678-1234-1234-1234-${spec.label.padEnd(12, "x").slice(0, 12)}`),
    });
    wrapperIds.set(spec.label, wrap.repoId);
    if (spec.metadata) {
      await writeRepoMetadata(wrap.repoId, spec.metadata);
    }
  }
};

describe("runMetadataMigration — basic flow", () => {
  it("backfills missing boilerplateVersion + preview on legacy repos", async () => {
    await seedWrappers([
      { label: "legacy", metadata: makeMetadata("src-legacy") },
    ]);
    const provider = await getGitProvider();
    const report = await runMetadataMigration({
      provider,
      migrate: { boilerplateVersion: "1.0.0", provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
    });
    expect(report.inspected).toBe(1);
    expect(report.changed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errored).toBe(0);
    expect(report.details[0].outcome).toBe("changed");
    expect(report.details[0].applied).toContain("boilerplateVersion=1.0.0");
  });

  it("skips repos that are already migrated", async () => {
    await seedWrappers([
      {
        label: "current",
        metadata: makeMetadata("src-current", {
          boilerplateVersion: "1.0.0",
          preview: {
            provider: "sandbox",
            capabilities: SANDBOX_CAPABILITIES,
            createdAt: "x",
            migrationStatus: "ok",
          },
        }),
      },
    ]);
    const provider = await getGitProvider();
    const report = await runMetadataMigration({
      provider,
      migrate: { boilerplateVersion: "1.0.0", provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
    });
    expect(report.changed).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.details[0].outcome).toBe("no-op");
  });

  it("handles no-metadata repos gracefully", async () => {
    await seedWrappers([{ label: "blank", metadata: null }]);
    const provider = await getGitProvider();
    const report = await runMetadataMigration({
      provider,
      migrate: {},
    });
    expect(report.skipped).toBe(1);
    expect(report.details[0].outcome).toBe("no-metadata");
  });

  it("ignores non-wrapper repos (source repos, etc.)", async () => {
    const provider = await getGitProvider();
    await provider.createRepo({ name: "adorable-src-some-uuid" });
    await seedWrappers([
      { label: "wrap", metadata: makeMetadata("src-wrap") },
    ]);
    const report = await runMetadataMigration({
      provider,
      migrate: { boilerplateVersion: "1.0.0", provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
    });
    expect(report.inspected).toBe(1); // only the wrapper
  });
});

describe("runMetadataMigration — dry run", () => {
  it("does NOT write when dryRun=true", async () => {
    await seedWrappers([
      { label: "legacy", metadata: makeMetadata("src-legacy") },
    ]);
    const provider = await getGitProvider();
    const report = await runMetadataMigration({
      provider,
      migrate: { boilerplateVersion: "1.0.0", provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
      dryRun: true,
    });
    expect(report.changed).toBe(1);

    // Re-run without dryRun — should still see the change as needed.
    const second = await runMetadataMigration({
      provider,
      migrate: { boilerplateVersion: "1.0.0", provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
    });
    expect(second.changed).toBe(1);
  });
});

describe("runMetadataMigration — limit", () => {
  it("respects --limit cap", async () => {
    await seedWrappers([
      { label: "a", metadata: makeMetadata("src-a") },
      { label: "b", metadata: makeMetadata("src-b") },
      { label: "c", metadata: makeMetadata("src-c") },
    ]);
    const provider = await getGitProvider();
    const report = await runMetadataMigration({
      provider,
      migrate: {},
      limit: 2,
    });
    expect(report.inspected).toBe(2);
  });
});

describe("runMetadataMigration — log hook", () => {
  it("invokes log() once per processed repo", async () => {
    await seedWrappers([
      { label: "a", metadata: makeMetadata("src-a") },
      { label: "b", metadata: makeMetadata("src-b") },
    ]);
    const provider = await getGitProvider();
    const lines: string[] = [];
    await runMetadataMigration({
      provider,
      migrate: { boilerplateVersion: "1.0.0", provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
      log: (m) => lines.push(m),
    });
    expect(lines.length).toBe(2);
    expect(lines.every((l) => /\[(apply|ok|skip|dry|error)\]/.test(l))).toBe(true);
  });
});

describe("runMetadataMigration — does not switch provider", () => {
  it("static-pinned project survives a run with sandbox-default migration opts", async () => {
    await seedWrappers([
      {
        label: "static-pin",
        metadata: makeMetadata("src-static", {
          boilerplateVersion: "1.0.0",
          preview: {
            provider: "static",
            capabilities: STATIC_CAPABILITIES,
            createdAt: "earlier",
            migrationStatus: "ok",
          },
        }),
      },
    ]);
    const provider = await getGitProvider();
    const report = await runMetadataMigration({
      provider,
      migrate: { provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
    });
    expect(report.skipped).toBe(1);
    // Re-read the metadata: provider should still be "static".
    const { readRepoMetadata } = await import("@/lib/repo-storage");
    const repoId = wrapperIds.get("static-pin")!;
    const fresh = await readRepoMetadata(repoId);
    expect(fresh?.preview?.provider).toBe("static");
  });
});
