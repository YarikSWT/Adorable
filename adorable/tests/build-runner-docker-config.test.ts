// Unit tests для buildContainerCreateOptions — pure config builder.
// Не требует docker daemon. Locks invariants из BUILD_PIPELINE §4.2.

import { describe, expect, it } from "vitest";

import { buildContainerCreateOptions } from "@/lib/preview/build-runner-docker";

const baseEnv = {
  imagePrefix: "build-runner-",
  memoryBytes: 2_147_483_648,
  nanoCpus: 2 * 1e9,
  pidsLimit: 512,
  timeoutMs: 120_000,
  cancelGraceMs: 2_000,
  logMaxBytes: 16_384,
  network: "adorable_build",
  nodeModulesVolumePrefix: "adorable_node_modules_react_",
};

const baseInput = {
  projectId: "proj-1",
  buildId: "2026-04-29T11-00-00Z-abcd",
  scratchDir: "/data/projects/proj-1",
  artifactDir: "/data/static/proj-1/builds/2026-04-29T11-00-00Z-abcd",
  boilerplateVersion: "1.0.0",
};

describe("buildContainerCreateOptions", () => {
  it("uses build-runner-react:<version> image", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    expect(cfg.Image).toBe("build-runner-react:1.0.0");
  });

  it("respects custom image prefix", () => {
    const cfg = buildContainerCreateOptions({
      env: { ...baseEnv, imagePrefix: "custom-prefix-" },
      input: baseInput,
    });
    expect(cfg.Image).toBe("custom-prefix-react:1.0.0");
  });

  it("runs as 1000:1000 inside /workspace", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    expect(cfg.User).toBe("1000:1000");
    expect(cfg.WorkingDir).toBe("/workspace");
  });

  it("attaches stdout + stderr, no TTY", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    expect(cfg.Tty).toBe(false);
    expect(cfg.AttachStdout).toBe(true);
    expect(cfg.AttachStderr).toBe(true);
  });

  it("sets NODE_PATH=/workspace/node_modules so vite.config.js loaded from /tmp can resolve modules", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    expect(cfg.Env).toContain("NODE_PATH=/workspace/node_modules");
  });

  it("sets NODE_ENV=production + project/build env", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    expect(cfg.Env).toEqual([
      "NODE_ENV=production",
      "VITE_PROJECT_ID=proj-1",
      "VITE_BUILD_ID=2026-04-29T11-00-00Z-abcd",
      "NODE_PATH=/workspace/node_modules",
    ]);
  });

  it("applies hardening flags from BUILD_PIPELINE §4.2", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    const hc = cfg.HostConfig!;
    expect(hc.NetworkMode).toBe("adorable_build");
    expect(hc.AutoRemove).toBe(true);
    expect(hc.ReadonlyRootfs).toBe(true);
    expect(hc.Memory).toBe(2_147_483_648);
    expect(hc.NanoCpus).toBe(2 * 1e9);
    expect(hc.PidsLimit).toBe(512);
    expect(hc.CapDrop).toEqual(["ALL"]);
    expect(hc.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(hc.Tmpfs).toEqual({ "/tmp": "size=200m" });
    expect(hc.Ulimits).toEqual([{ Name: "nofile", Soft: 4096, Hard: 4096 }]);
  });

  it("mounts node_modules RO from versioned named volume", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    expect(cfg.HostConfig?.Binds).toContain(
      "adorable_node_modules_react_1_0_0:/workspace/node_modules:ro",
    );
  });

  it("mounts scratch src + public RO, .vite RW, dist RW", () => {
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    const binds = cfg.HostConfig?.Binds ?? [];
    expect(binds).toContain("/data/projects/proj-1/src:/workspace/src:ro");
    expect(binds).toContain("/data/projects/proj-1/public:/workspace/public:ro");
    expect(binds).toContain("/data/projects/proj-1/.vite:/workspace/.vite:rw");
    expect(binds).toContain(
      "/data/static/proj-1/builds/2026-04-29T11-00-00Z-abcd:/workspace/dist:rw",
    );
  });

  it("converts boilerplate version dots to underscores in volume name", () => {
    const cfg = buildContainerCreateOptions({
      env: baseEnv,
      input: { ...baseInput, boilerplateVersion: "1.2.3" },
    });
    expect(cfg.HostConfig?.Binds?.[0]).toBe(
      "adorable_node_modules_react_1_2_3:/workspace/node_modules:ro",
    );
  });

  it("Cmd copies vite.config.js to writable /tmp before running build", () => {
    // Vite's loadConfigFromBundledFile writes a sibling
    // vite.config.js.timestamp-*.mjs file. With ReadonlyRootfs=true
    // the image's /workspace can't take that write — the override
    // copies the trusted config to /tmp (tmpfs, writable) and points
    // Vite at it via --config so the timestamp file lands there.
    const cfg = buildContainerCreateOptions({ env: baseEnv, input: baseInput });
    expect(cfg.Cmd).toEqual([
      "sh",
      "-c",
      "cp /workspace/vite.config.js /tmp/vite.config.js && exec npx vite build --config /tmp/vite.config.js",
    ]);
  });
});
