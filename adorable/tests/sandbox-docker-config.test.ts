// Unit-тесты для чистого билдера конфига sandbox-контейнера.
//
// Проверяют что ВСЕ 15 обязательных ограничений присутствуют в
// сгенерированных HostConfig/ContainerConfig. Docker daemon не нужен.
//
// Эти тесты — ворота фиксации 15-checklist: если кто-то случайно
// выкинет ограничение, падает ровно этот тест с понятным сообщением.

import { describe, it, expect, beforeEach } from "vitest";

import {
  buildSandboxContainerConfig,
  type SandboxLimitsEnv,
} from "@/lib/adapters/sandbox-docker-config";

const defaultEnv: SandboxLimitsEnv = {
  SANDBOX_IMAGE: "node:22-slim",
  SANDBOX_NETWORK_NAME: "adorable_sandboxes",
  SANDBOX_CPU_LIMIT: "2",
  SANDBOX_MEMORY_LIMIT: "2147483648",
  SANDBOX_PIDS_LIMIT: "512",
  SANDBOX_TMP_SIZE_BYTES: "104857600",
  SANDBOX_ULIMIT_NOFILE: "1024",
};

const buildDefault = () =>
  buildSandboxContainerConfig({
    sandboxId: "sbx-test",
    repoId: "repo-test",
    workdir: "/workspace",
    cmd: ["sleep", "infinity"],
    workspaceVolumeName: "adorable-ws-sbx-test",
    envSource: defaultEnv,
  });

describe("sandbox HostConfig (15 restrictions)", () => {
  let built: ReturnType<typeof buildSandboxContainerConfig>;
  let hc: NonNullable<ReturnType<typeof buildSandboxContainerConfig>["createOptions"]["HostConfig"]>;
  let cc: ReturnType<typeof buildSandboxContainerConfig>["createOptions"];

  beforeEach(() => {
    built = buildDefault();
    cc = built.createOptions;
    hc = cc.HostConfig!;
  });

  it("1) CPU limit via NanoCpus (from SANDBOX_CPU_LIMIT)", () => {
    expect(hc.NanoCpus).toBe(2_000_000_000);
  });

  it("2) Memory limit (from SANDBOX_MEMORY_LIMIT)", () => {
    expect(hc.Memory).toBe(2_147_483_648);
  });

  it("3) MemorySwap === Memory (swap disabled)", () => {
    expect(hc.MemorySwap).toBe(hc.Memory);
  });

  it("4) PidsLimit (fork-bomb protection)", () => {
    expect(hc.PidsLimit).toBe(512);
  });

  it("5) ReadonlyRootfs", () => {
    expect(hc.ReadonlyRootfs).toBe(true);
  });

  it("6) SecurityOpt has no-new-privileges:true", () => {
    expect(hc.SecurityOpt).toContain("no-new-privileges:true");
  });

  it("7) CapDrop has ALL", () => {
    expect(hc.CapDrop).toEqual(["ALL"]);
  });

  it("8) Config.User is non-root 1000:1000", () => {
    expect(cc.User).toBe("1000:1000");
  });

  it("9) Ulimits includes nofile and core=0", () => {
    const names = hc.Ulimits?.map((u) => u.Name);
    expect(names).toEqual(expect.arrayContaining(["nofile", "core"]));
    const core = hc.Ulimits?.find((u) => u.Name === "core");
    expect(core?.Hard).toBe(0);
  });

  it("10) StorageOpt.size is set when SANDBOX_STORAGE_LIMIT provided", () => {
    const withStorage = buildSandboxContainerConfig({
      sandboxId: "sbx-st",
      repoId: "r",
      workdir: "/workspace",
      workspaceVolumeName: "v",
      envSource: { ...defaultEnv, SANDBOX_STORAGE_LIMIT: "5368709120" },
    });
    expect(withStorage.createOptions.HostConfig?.StorageOpt).toEqual({
      size: "5368709120",
    });
  });

  it("10b) StorageOpt omitted when SANDBOX_STORAGE_LIMIT empty (ext4 compat)", () => {
    expect(hc.StorageOpt).toBeUndefined();
  });

  it("11) BlkioDevice*Bps wired when device+rate env set", () => {
    const withBlk = buildSandboxContainerConfig({
      sandboxId: "sbx-b",
      repoId: "r",
      workdir: "/workspace",
      workspaceVolumeName: "v",
      envSource: {
        ...defaultEnv,
        SANDBOX_BLKIO_DEVICE: "/dev/sda",
        SANDBOX_BLKIO_READ_BPS: "10485760",
        SANDBOX_BLKIO_WRITE_BPS: "10485760",
      },
    });
    const bhc = withBlk.createOptions.HostConfig!;
    expect(bhc.BlkioDeviceReadBps).toEqual([
      { Path: "/dev/sda", Rate: 10485760 },
    ]);
    expect(bhc.BlkioDeviceWriteBps).toEqual([
      { Path: "/dev/sda", Rate: 10485760 },
    ]);
  });

  it("12) NetworkMode is custom network (not host, not bridge)", () => {
    expect(hc.NetworkMode).toBe("adorable_sandboxes");
    expect(hc.NetworkMode).not.toBe("host");
    expect(hc.NetworkMode).not.toBe("bridge");
    // Endpoints config registers sandbox alias.
    expect(cc.NetworkingConfig?.EndpointsConfig?.adorable_sandboxes).toBeDefined();
  });

  it("13) AutoRemove is false (cleanup worker owns lifecycle)", () => {
    // Not AutoRemove=true, because cleanup-worker handles TTL/idle.
    // RestartPolicy={no} so docker does not restart it itself.
    expect(hc.AutoRemove).toBe(false);
    expect(hc.RestartPolicy?.Name).toBe("no");
  });

  it("14) Tmpfs /tmp with size+mode", () => {
    expect(hc.Tmpfs).toBeDefined();
    const opt = hc.Tmpfs!["/tmp"];
    expect(opt).toContain("rw");
    expect(opt).toContain("nosuid");
    expect(opt).toContain("nodev");
    expect(opt).toMatch(/size=\d+/);
    expect(opt).toContain("mode=1777");
  });

  it("14b) Tmpfs workdir is writable by non-root user", () => {
    const wopt = hc.Tmpfs!["/workspace"];
    expect(wopt).toBeDefined();
    expect(wopt).toContain("rw");
    expect(wopt).toContain("nosuid");
    expect(wopt).toContain("uid=1000");
    expect(wopt).toContain("gid=1000");
    expect(wopt).toMatch(/size=\d+/);
  });

  it("14b-i) /workspace tmpfs has explicit exec flag", () => {
    // Без него Docker накладывает noexec на tmpfs по умолчанию,
    // и npm install падает на esbuild/rollup postinstall, vite не
    // стартует — нативные бинари не исполнить из /workspace/node_modules.
    const wopt = hc.Tmpfs!["/workspace"];
    expect(wopt).toContain("exec");
    expect(wopt).not.toMatch(/\bnoexec\b/);
  });

  it("14b-ii) /tmp tmpfs has explicit exec flag", () => {
    // npm разворачивает пакеты во временную директорию и выполняет
    // postinstall оттуда; spawn('sh', { cwd: /tmp/... }) требует exec.
    const tmpopt = hc.Tmpfs!["/tmp"];
    expect(tmpopt).toContain("exec");
    expect(tmpopt).not.toMatch(/\bnoexec\b/);
  });

  it("14c) /workspace tmpfs honours SANDBOX_WORKSPACE_SIZE_BYTES", () => {
    const built10g = buildSandboxContainerConfig({
      sandboxId: "sbx-ws",
      repoId: "r",
      workdir: "/workspace",
      workspaceVolumeName: "v",
      envSource: {
        ...defaultEnv,
        SANDBOX_WORKSPACE_SIZE_BYTES: String(10 * 1024 * 1024 * 1024),
      },
    });
    const wopt = built10g.createOptions.HostConfig!.Tmpfs!["/workspace"];
    expect(wopt).toContain(`size=${10 * 1024 * 1024 * 1024}`);
    expect(built10g.limits.workspaceSizeBytes).toBe(10 * 1024 * 1024 * 1024);
  });

  it("14d) /workspace tmpfs defaults to 6 GiB when no env override", () => {
    const minimalEnv: SandboxLimitsEnv = {
      SANDBOX_NETWORK_NAME: "adorable_sandboxes",
    };
    const built = buildSandboxContainerConfig({
      sandboxId: "sbx-default",
      repoId: "r",
      workdir: "/workspace",
      workspaceVolumeName: "v",
      envSource: minimalEnv,
    });
    expect(built.limits.workspaceSizeBytes).toBe(6_442_450_944);
    expect(built.createOptions.HostConfig!.Tmpfs!["/workspace"]).toContain(
      "size=6442450944",
    );
  });

  it("14e) /tmp tmpfs defaults to 1 GiB when no env override", () => {
    const minimalEnv: SandboxLimitsEnv = {
      SANDBOX_NETWORK_NAME: "adorable_sandboxes",
    };
    const built = buildSandboxContainerConfig({
      sandboxId: "sbx-tmp-default",
      repoId: "r",
      workdir: "/workspace",
      workspaceVolumeName: "v",
      envSource: minimalEnv,
    });
    expect(built.limits.tmpSizeBytes).toBe(1_073_741_824);
    expect(built.createOptions.HostConfig!.Tmpfs!["/tmp"]).toContain(
      "size=1073741824",
    );
  });

  it("14f) Memory and Pids defaults comfortable for Next.js dev", () => {
    const minimalEnv: SandboxLimitsEnv = {
      SANDBOX_NETWORK_NAME: "adorable_sandboxes",
    };
    const built = buildSandboxContainerConfig({
      sandboxId: "sbx-defaults",
      repoId: "r",
      workdir: "/workspace",
      workspaceVolumeName: "v",
      envSource: minimalEnv,
    });
    expect(built.limits.memoryBytes).toBe(4_294_967_296); // 4 GiB
    expect(built.limits.pidsLimit).toBe(1024);
    // nofile is not exposed on limits snapshot, but we can read it via Ulimits.
    const nofile = built.createOptions.HostConfig!.Ulimits!.find(
      (u) => u.Name === "nofile",
    );
    expect(nofile?.Soft).toBe(4096);
    expect(nofile?.Hard).toBe(4096);
  });

  it("15) Labels include audit fields (sandbox/repoId/sandboxId/createdAt)", () => {
    expect(cc.Labels).toMatchObject({
      "adorable.sandbox": "true",
      "adorable.sandboxId": "sbx-test",
      "adorable.repoId": "repo-test",
    });
    expect(cc.Labels?.["adorable.createdAt"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns snapshot of limits for audit logging", () => {
    expect(built.limits).toMatchObject({
      nanoCpus: 2_000_000_000,
      memoryBytes: 2_147_483_648,
      pidsLimit: 512,
      networkName: "adorable_sandboxes",
      readonlyRootfs: true,
      user: "1000:1000",
      capDrop: ["ALL"],
      securityOpt: ["no-new-privileges:true"],
      tmpSizeBytes: 104_857_600,
      // defaultEnv не задаёт SANDBOX_WORKSPACE_SIZE_BYTES → берём дефолт 6 GiB.
      workspaceSizeBytes: 6_442_450_944,
    });
  });

  it("does not mount host paths — workspace is tmpfs (isolated per sandbox)", () => {
    // We deliberately don't bind host dirs into the sandbox. Workspace is
    // a tmpfs-backed in-memory dir so a compromised sandbox cannot reach
    // host state even via symlink traversal.
    expect(hc.Binds ?? []).toEqual([]);
    expect(hc.Tmpfs?.["/workspace"]).toBeDefined();
  });
});

describe("sandbox config validation", () => {
  it("rejects SANDBOX_NETWORK_NAME=host", () => {
    expect(() =>
      buildSandboxContainerConfig({
        sandboxId: "s",
        repoId: "r",
        workdir: "/ws",
        workspaceVolumeName: "v",
        envSource: { ...defaultEnv, SANDBOX_NETWORK_NAME: "host" },
      }),
    ).toThrow(/custom network/);
  });

  it("rejects SANDBOX_NETWORK_NAME=bridge", () => {
    expect(() =>
      buildSandboxContainerConfig({
        sandboxId: "s",
        repoId: "r",
        workdir: "/ws",
        workspaceVolumeName: "v",
        envSource: { ...defaultEnv, SANDBOX_NETWORK_NAME: "bridge" },
      }),
    ).toThrow(/custom network/);
  });

  it("rejects root user override", () => {
    expect(() =>
      buildSandboxContainerConfig({
        sandboxId: "s",
        repoId: "r",
        workdir: "/ws",
        workspaceVolumeName: "v",
        envSource: defaultEnv,
        user: "root",
      }),
    ).toThrow(/must not be root/);
  });

  it("rejects malformed CPU limit", () => {
    expect(() =>
      buildSandboxContainerConfig({
        sandboxId: "s",
        repoId: "r",
        workdir: "/ws",
        workspaceVolumeName: "v",
        envSource: { ...defaultEnv, SANDBOX_CPU_LIMIT: "not-a-number" },
      }),
    ).toThrow(/invalid CPU limit/);
  });

  it("parses fractional CPU limits", () => {
    const b = buildSandboxContainerConfig({
      sandboxId: "s",
      repoId: "r",
      workdir: "/ws",
      workspaceVolumeName: "v",
      envSource: { ...defaultEnv, SANDBOX_CPU_LIMIT: "0.5" },
    });
    expect(b.createOptions.HostConfig?.NanoCpus).toBe(500_000_000);
  });

  it("exposes ports by sandboxPort", () => {
    const b = buildSandboxContainerConfig({
      sandboxId: "s",
      repoId: "r",
      workdir: "/ws",
      workspaceVolumeName: "v",
      exposedPorts: [3000, 3010],
      envSource: defaultEnv,
    });
    expect(b.createOptions.ExposedPorts).toEqual({
      "3000/tcp": {},
      "3010/tcp": {},
    });
  });
});
