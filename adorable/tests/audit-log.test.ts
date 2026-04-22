// Тесты для lib/sandbox/audit-log.ts.
//
// Проверяем:
//   - disabled-режим (нет env + нет path) → no-op, ничего не пишется.
//   - явная включённая запись → файл появляется, строки — валидный JSON,
//     разделены \n.
//   - сериализация параллельных вызовов (нет перемежения).
//   - автосоздание директории.
//   - strict=true → ошибка пробрасывается.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  createAuditLogger,
  __resetSharedAuditLogger,
  getSharedAuditLogger,
} from "@/lib/sandbox/audit-log";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "audit-log-test-"));
  __resetSharedAuditLogger();
  delete process.env.SANDBOX_AUDIT_LOG;
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

const readLines = async (p: string): Promise<string[]> => {
  const content = await fsp.readFile(p, "utf8");
  return content.split("\n").filter(Boolean);
};

describe("createAuditLogger", () => {
  it("is a no-op when no path is configured", async () => {
    const logger = createAuditLogger();
    expect(logger.path).toBeNull();
    await logger.log({
      event: "sandbox_created",
      sandboxId: "s1",
      repoId: "r1",
      image: "node:22",
      limits: {},
      duration_ms: 100,
    });
    // Should complete without writing anywhere — no throw, no file.
  });

  it("uses env SANDBOX_AUDIT_LOG when no override", async () => {
    const logPath = path.join(tmpDir, "audit.log");
    process.env.SANDBOX_AUDIT_LOG = logPath;
    const logger = createAuditLogger();
    expect(logger.path).toBe(logPath);

    await logger.log({
      event: "sandbox_created",
      sandboxId: "s1",
      repoId: "r1",
      image: "node:22",
      limits: { memoryBytes: 1024 },
      duration_ms: 10,
    });

    const lines = await readLines(logPath);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      event: "sandbox_created",
      sandboxId: "s1",
      repoId: "r1",
      image: "node:22",
      limits: { memoryBytes: 1024 },
      duration_ms: 10,
    });
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("explicit path overrides env", async () => {
    process.env.SANDBOX_AUDIT_LOG = "/tmp/should-not-be-used.log";
    const logPath = path.join(tmpDir, "explicit.log");
    const logger = createAuditLogger({ path: logPath });
    expect(logger.path).toBe(logPath);
    await logger.log({
      event: "sandbox_destroyed",
      sandboxId: "s1",
      reason: "manual",
    });
    const lines = await readLines(logPath);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe("sandbox_destroyed");
  });

  it("explicit null disables even when env set", async () => {
    process.env.SANDBOX_AUDIT_LOG = path.join(tmpDir, "should-not-exist.log");
    const logger = createAuditLogger({ path: null });
    expect(logger.path).toBeNull();
    await logger.log({
      event: "sandbox_destroyed",
      sandboxId: "s1",
    });
    const exists = await fsp
      .stat(process.env.SANDBOX_AUDIT_LOG)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("serializes concurrent writes — no interleaved partial lines", async () => {
    const logPath = path.join(tmpDir, "concurrent.log");
    const logger = createAuditLogger({ path: logPath });

    const N = 50;
    const writes = Array.from({ length: N }, (_, i) =>
      logger.log({
        event: "sandbox_exec",
        sandboxId: "s1",
        command: `echo ${i}`,
        exitCode: 0,
        duration_ms: i,
      }),
    );
    await Promise.all(writes);

    const lines = await readLines(logPath);
    expect(lines).toHaveLength(N);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const commands = lines
      .map((l) => JSON.parse(l) as { command: string })
      .map((e) => e.command);
    // All 50 commands should be present (order is serialized but not sorted).
    for (let i = 0; i < N; i++) {
      expect(commands).toContain(`echo ${i}`);
    }
  });

  it("auto-creates parent directory", async () => {
    const logPath = path.join(tmpDir, "nested", "a", "b", "audit.log");
    const logger = createAuditLogger({ path: logPath });
    await logger.log({
      event: "sandbox_created",
      sandboxId: "s1",
      repoId: "r1",
      image: "node:22",
      limits: {},
      duration_ms: 1,
    });
    const stat = await fsp.stat(logPath);
    expect(stat.isFile()).toBe(true);
  });

  it("strict=true propagates write errors", async () => {
    // Use a path whose parent cannot be created (try to write to /proc).
    const logger = createAuditLogger({
      path: "/dev/null/cannot-be-directory.log",
      strict: true,
    });
    await expect(
      logger.log({
        event: "sandbox_destroyed",
        sandboxId: "s1",
      }),
    ).rejects.toThrow();
  });

  it("strict=false swallows write errors", async () => {
    const logger = createAuditLogger({
      path: "/dev/null/cannot-be-directory.log",
      strict: false,
    });
    await expect(
      logger.log({
        event: "sandbox_destroyed",
        sandboxId: "s1",
      }),
    ).resolves.toBeUndefined();
  });

  it("supports all declared event types", async () => {
    const logPath = path.join(tmpDir, "events.log");
    const logger = createAuditLogger({ path: logPath });
    await logger.log({
      event: "sandbox_created",
      sandboxId: "s1",
      repoId: "r1",
      image: "node:22",
      limits: {},
      duration_ms: 1,
    });
    await logger.log({
      event: "sandbox_destroyed",
      sandboxId: "s1",
    });
    await logger.log({
      event: "sandbox_exec",
      sandboxId: "s1",
      command: "ls",
      exitCode: 0,
      duration_ms: 1,
    });
    await logger.log({
      event: "sandbox_fs_write",
      sandboxId: "s1",
      path: "/ws/a.txt",
      bytes: 5,
    });
    await logger.log({
      event: "sandbox_cleanup",
      sandboxId: "s1",
      reason: "idle",
    });
    await logger.log({
      event: "proxy_route_added",
      sandboxId: "s1",
      hostname: "abc.preview.localhost",
      upstream: "10.1.2.3:3000",
    });
    await logger.log({
      event: "proxy_route_removed",
      sandboxId: "s1",
      hostname: "abc.preview.localhost",
    });

    const lines = await readLines(logPath);
    expect(lines).toHaveLength(7);
    const events = lines.map((l) => (JSON.parse(l) as { event: string }).event);
    expect(events).toEqual([
      "sandbox_created",
      "sandbox_destroyed",
      "sandbox_exec",
      "sandbox_fs_write",
      "sandbox_cleanup",
      "proxy_route_added",
      "proxy_route_removed",
    ]);
  });
});

describe("getSharedAuditLogger", () => {
  it("returns a singleton", () => {
    const a = getSharedAuditLogger();
    const b = getSharedAuditLogger();
    expect(a).toBe(b);
  });
});
