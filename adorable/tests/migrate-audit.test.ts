// Tests for the boilerplate_migration audit event emitted by both
// migration paths: bulk runMetadataMigration and per-project
// migrateRepoToStatic. SECURITY.md §6.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { createMockPreviewProvider } from "@/lib/adapters/preview-mock";
import type { SandboxProvider } from "@/lib/adapters/sandbox";
import { createAuditLogger } from "@/lib/sandbox/audit-log";
import { runMetadataMigration } from "@/lib/preview/migrate-metadata-runner";
import { migrateRepoToStatic } from "@/lib/preview/migrate-to-static";

const wrapperName = (id: string): string =>
  `${ADORABLE_WRAPPER_REPO_PREFIX}${id}`;

const baseMetadata = (sourceRepoId: string): RepoMetadata => ({
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
});

let logPath: string;
let activeLogger: ReturnType<typeof createAuditLogger> | null = null;

beforeEach(async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "adorable-mig-audit-"));
  logPath = path.join(tmp, "audit.log");
  __resetGitSingleton();
});

afterEach(async () => {
  __resetGitSingleton();
  if (activeLogger) await activeLogger.flush();
  await rm(path.dirname(logPath), { recursive: true, force: true });
  activeLogger = null;
});

const readEvents = async (): Promise<unknown[]> => {
  if (activeLogger) await activeLogger.flush();
  let raw = "";
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};

describe("migrate-repo-metadata — audit", () => {
  it("emits boilerplate_migration with run summary", async () => {
    const provider = await getGitProvider();
    const wrap = await provider.createRepo({
      name: wrapperName("12345678-1111-1111-1111-aaaaaaaaaaaa"),
    });
    await writeRepoMetadata(wrap.repoId, baseMetadata("src-1"));
    activeLogger = createAuditLogger({ path: logPath });

    const report = await runMetadataMigration({
      provider,
      migrate: {
        boilerplateVersion: "1.0.0",
        provider: "sandbox",
        capabilities: SANDBOX_CAPABILITIES,
      },
      auditLogger: activeLogger,
    });
    expect(report.changed).toBe(1);

    const events = (await readEvents()) as Array<Record<string, unknown>>;
    const ev = events.find((e) => e.event === "boilerplate_migration");
    expect(ev).toMatchObject({
      event: "boilerplate_migration",
      script: "migrate-repo-metadata",
      toVersion: "1.0.0",
      inspected: 1,
      changed: 1,
      skipped: 0,
      errored: 0,
    });
  });

  it("includes dryRun flag when run in dry-run mode", async () => {
    const provider = await getGitProvider();
    const wrap = await provider.createRepo({
      name: wrapperName("12345678-1111-1111-1111-bbbbbbbbbbbb"),
    });
    await writeRepoMetadata(wrap.repoId, baseMetadata("src-2"));
    activeLogger = createAuditLogger({ path: logPath });

    await runMetadataMigration({
      provider,
      migrate: { boilerplateVersion: "1.0.0", provider: "sandbox", capabilities: SANDBOX_CAPABILITIES },
      dryRun: true,
      auditLogger: activeLogger,
    });

    const ev = (await readEvents()).find(
      (e) => (e as { event: string }).event === "boilerplate_migration",
    );
    expect(ev).toMatchObject({ dryRun: true });
  });
});

describe("migrate-repo-to-static — audit", () => {
  const makeSandboxProvider = (): SandboxProvider =>
    ({
      name: "mock",
      create: vi.fn(),
      ref: vi.fn(),
      list: vi.fn(),
      destroy: vi.fn(async () => {}) as SandboxProvider["destroy"],
    }) as unknown as SandboxProvider;

  it("emits boilerplate_migration on successful migration", async () => {
    activeLogger = createAuditLogger({ path: logPath });
    const result = await migrateRepoToStatic({
      sourceRepoId: "src-3",
      metadata: {
        ...baseMetadata("src-3"),
        boilerplateVersion: "1.0.0",
        preview: {
          provider: "sandbox",
          capabilities: SANDBOX_CAPABILITIES,
          createdAt: "x",
          migrationStatus: "ok",
        },
      },
      staticProvider: createMockPreviewProvider({ capabilities: STATIC_CAPABILITIES }),
      sandboxProvider: makeSandboxProvider(),
      boilerplateVersion: "1.0.0",
      auditLogger: activeLogger,
    });
    expect(result.changed).toBe(true);

    const ev = (await readEvents()).find(
      (e) => (e as { event: string }).event === "boilerplate_migration",
    );
    expect(ev).toMatchObject({
      event: "boilerplate_migration",
      script: "migrate-repo-to-static",
      fromVersion: "sandbox",
      toVersion: "static",
      inspected: 1,
      changed: 1,
      skipped: 0,
    });
  });

  it("emits boilerplate_migration with changed=0 + skipped=1 on no-op", async () => {
    activeLogger = createAuditLogger({ path: logPath });
    const result = await migrateRepoToStatic({
      sourceRepoId: "src-4",
      metadata: {
        ...baseMetadata("src-4"),
        preview: {
          provider: "static",
          capabilities: STATIC_CAPABILITIES,
          createdAt: "x",
          migrationStatus: "ok",
        },
      },
      staticProvider: createMockPreviewProvider({ capabilities: STATIC_CAPABILITIES }),
      sandboxProvider: makeSandboxProvider(),
      boilerplateVersion: "1.0.0",
      auditLogger: activeLogger,
    });
    expect(result.changed).toBe(false);

    const ev = (await readEvents()).find(
      (e) => (e as { event: string }).event === "boilerplate_migration",
    );
    expect(ev).toMatchObject({
      event: "boilerplate_migration",
      script: "migrate-repo-to-static",
      changed: 0,
      skipped: 1,
    });
  });
});
