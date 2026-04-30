// Pure tests for lib/preflight/checks.ts.
//
// Each check is a pure function; we synth env objects and stub fs.
// Tests prove the severity/message contract that the CLI relies on.

import { describe, expect, it } from "vitest";

import {
  checkDirectoryWritable,
  checkPreviewProviderValue,
  checkRecommendedEnvVar,
  checkRequiredEnvVar,
  runStaticPreflight,
} from "@/lib/preflight/checks";

describe("checkPreviewProviderValue", () => {
  it("fails on unset", () => {
    const r = checkPreviewProviderValue({});
    expect(r.severity).toBe("fail");
    expect(r.message).toContain("unset");
    expect(r.remediation).toContain("static");
  });

  it("fails on bogus value", () => {
    const r = checkPreviewProviderValue({ PREVIEW_PROVIDER: "nope" });
    expect(r.severity).toBe("fail");
    expect(r.message).toContain("not one of");
  });

  it("warns on sandbox (assumes flipping to static)", () => {
    const r = checkPreviewProviderValue({ PREVIEW_PROVIDER: "sandbox" });
    expect(r.severity).toBe("warn");
    expect(r.message).toContain("sandbox");
  });

  it("ok on static", () => {
    const r = checkPreviewProviderValue({ PREVIEW_PROVIDER: "static" });
    expect(r.severity).toBe("ok");
  });

  it("warns on mock — same as sandbox", () => {
    const r = checkPreviewProviderValue({ PREVIEW_PROVIDER: "mock" });
    expect(r.severity).toBe("warn");
  });
});

describe("checkRequiredEnvVar", () => {
  it("fails on missing", () => {
    expect(checkRequiredEnvVar("FOO", {}).severity).toBe("fail");
  });

  it("fails on empty string", () => {
    expect(checkRequiredEnvVar("FOO", { FOO: "" }).severity).toBe("fail");
  });

  it("ok on present", () => {
    const r = checkRequiredEnvVar("FOO", { FOO: "bar" });
    expect(r.severity).toBe("ok");
    expect(r.message).toContain("FOO=bar");
  });
});

describe("checkRecommendedEnvVar", () => {
  it("warns on missing (not a hard failure)", () => {
    expect(checkRecommendedEnvVar("FOO", {}).severity).toBe("warn");
  });

  it("ok on present", () => {
    expect(checkRecommendedEnvVar("FOO", { FOO: "x" }).severity).toBe("ok");
  });
});

describe("checkDirectoryWritable", () => {
  const passingStat = async (_p: string) => ({ isDir: true });
  const failingStat = async (_p: string) => {
    throw new Error("ENOENT");
  };
  const fileStat = async (_p: string) => ({ isDir: false });
  const passingAccess = async (_p: string, _m: number) => undefined;
  const failingAccess = async (_p: string, _m: number) => {
    throw new Error("EACCES");
  };

  it("fails when path doesn't exist", async () => {
    const r = await checkDirectoryWritable("X", "/nope", {
      stat: failingStat,
      access: passingAccess,
    });
    expect(r.severity).toBe("fail");
    expect(r.message).toContain("does not exist");
  });

  it("fails when path is a file", async () => {
    const r = await checkDirectoryWritable("X", "/file", {
      stat: fileStat,
      access: passingAccess,
    });
    expect(r.severity).toBe("fail");
    expect(r.message).toContain("not a directory");
  });

  it("fails when path is unwritable", async () => {
    const r = await checkDirectoryWritable("X", "/ro", {
      stat: passingStat,
      access: failingAccess,
    });
    expect(r.severity).toBe("fail");
    expect(r.message).toContain("not writable");
  });

  it("ok when path exists and is writable", async () => {
    const r = await checkDirectoryWritable("X", "/ok", {
      stat: passingStat,
      access: passingAccess,
    });
    expect(r.severity).toBe("ok");
  });
});

describe("runStaticPreflight", () => {
  const passingDirOpts = {
    stat: async () => ({ isDir: true }),
    access: async () => undefined,
  };

  it("aggregates passes when env + dirs are healthy", async () => {
    const env: Record<string, string | undefined> = {
      PREVIEW_PROVIDER: "static",
      PROJECTS_ROOT: "/data/projects",
      STATIC_ROOT: "/data/static",
      CADDY_STATIC_ROOT: "/data/static",
      BUILD_RUNNER_NETWORK: "adorable_build",
      BUILD_RUNNER_TIMEOUT_MS: "120000",
      BUILD_WAIT_DEADLINE_BUFFER_MS: "5000",
      SANDBOX_AUDIT_LOG: "/var/log/adorable/audit.log",
    };
    const report = await runStaticPreflight({
      env,
      dirCheckOpts: passingDirOpts,
    });
    expect(report.failed).toBe(0);
    expect(report.warned).toBe(0);
    expect(report.passed).toBeGreaterThan(0);
  });

  it("flags missing required env + missing dir", async () => {
    const env: Record<string, string | undefined> = {
      PREVIEW_PROVIDER: "static",
      // PROJECTS_ROOT missing
      STATIC_ROOT: "/data/static",
    };
    const report = await runStaticPreflight({
      env,
      dirCheckOpts: passingDirOpts,
    });
    expect(report.failed).toBeGreaterThan(0);
    const projectsCheck = report.results.find(
      (r) => r.name === "env.PROJECTS_ROOT",
    );
    expect(projectsCheck?.severity).toBe("fail");
  });

  it("warns on missing recommended env vars without failing the report", async () => {
    const env: Record<string, string | undefined> = {
      PREVIEW_PROVIDER: "static",
      PROJECTS_ROOT: "/data/projects",
      STATIC_ROOT: "/data/static",
      // recommended vars all unset
    };
    const report = await runStaticPreflight({
      env,
      dirCheckOpts: passingDirOpts,
    });
    expect(report.failed).toBe(0);
    expect(report.warned).toBeGreaterThanOrEqual(5); // 5 recommended vars
  });

  it("doesn't double-fail on env miss + dir check skipped", async () => {
    const env: Record<string, string | undefined> = {
      PREVIEW_PROVIDER: "static",
      // PROJECTS_ROOT missing → dir check skipped, only env-fail counted
      STATIC_ROOT: "/data/static",
    };
    const report = await runStaticPreflight({
      env,
      dirCheckOpts: passingDirOpts,
    });
    const dirCheck = report.results.find(
      (r) => r.name === "dir.PROJECTS_ROOT",
    );
    expect(dirCheck).toBeUndefined();
  });
});
