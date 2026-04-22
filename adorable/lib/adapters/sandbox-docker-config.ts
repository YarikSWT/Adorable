// Чистый билдер HostConfig + ContainerConfig для sandbox-контейнера.
//
// Вынесен в отдельный модуль, чтобы покрыть unit-тестами без
// необходимости поднимать Docker daemon. Тесты проверяют что ВСЕ 15
// ограничений присутствуют.
//
// Опции принимают env-подобные значения (строки). Внутри приводятся к
// корректным типам и падают с осмысленной ошибкой если значение невалидно.

import type Dockerode from "dockerode";

export interface SandboxLimitsEnv {
  SANDBOX_IMAGE?: string;
  SANDBOX_NETWORK_NAME?: string;
  SANDBOX_CPU_LIMIT?: string;
  SANDBOX_MEMORY_LIMIT?: string;
  SANDBOX_PIDS_LIMIT?: string;
  SANDBOX_STORAGE_LIMIT?: string;
  /** "1000:1000" или пусто. */
  SANDBOX_USER?: string;
  /** `/dev/sda` — если хочешь применить BlkioDevice*Bps. Пусто → пропускаем. */
  SANDBOX_BLKIO_DEVICE?: string;
  /** байт/сек */
  SANDBOX_BLKIO_READ_BPS?: string;
  SANDBOX_BLKIO_WRITE_BPS?: string;
  /** Максимальный размер /tmp в байтах (для tmpfs). Дефолт 104857600 (100MiB). */
  SANDBOX_TMP_SIZE_BYTES?: string;
  /** nofile ulimit soft+hard. */
  SANDBOX_ULIMIT_NOFILE?: string;
}

export interface BuildContainerOptions {
  sandboxId: string;
  repoId: string;
  /** Рабочая директория внутри контейнера. */
  workdir: string;
  /** Команда запуска (CMD). */
  cmd?: string[];
  /** ENV для контейнера. */
  env?: Record<string, string>;
  /** Имя docker volume для рабочего каталога (сохраняется между рестартами). */
  workspaceVolumeName: string;
  /** Список exposed-портов (в контейнере). */
  exposedPorts?: number[];
  /** Labels — для discovery + cleanup worker. */
  labels?: Record<string, string>;
  /** Env-контекст (обычно process.env). */
  envSource: SandboxLimitsEnv;
  /** User override; по умолчанию из env. */
  user?: string;
}

export interface BuiltContainerConfig {
  /** dockerode createContainer options (Name + Config + HostConfig + NetworkingConfig). */
  createOptions: Dockerode.ContainerCreateOptions;
  /** Снимок лимитов — для audit-log. */
  limits: {
    nanoCpus: number;
    memoryBytes: number;
    pidsLimit: number;
    storageBytes?: number;
    networkName: string;
    readonlyRootfs: boolean;
    user: string;
    capDrop: string[];
    securityOpt: string[];
    tmpSizeBytes: number;
  };
}

const parseIntOr = (v: string | undefined, fallback: number): number => {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) {
    throw new Error(`sandbox-docker-config: cannot parse integer from "${v}"`);
  }
  return n;
};

const parseCpuLimit = (v: string | undefined, fallback: number): number => {
  // Accept "2", "1.5" etc. Value is cores → NanoCpus = cores * 1e9.
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`sandbox-docker-config: invalid CPU limit "${v}"`);
  }
  return Math.floor(n * 1e9);
};

/**
 * Строит dockerode ContainerCreateOptions со всеми 15 ограничениями.
 * Чистая функция — удобно тестить без Docker.
 */
export const buildSandboxContainerConfig = (
  opts: BuildContainerOptions,
): BuiltContainerConfig => {
  const env = opts.envSource;

  const image = env.SANDBOX_IMAGE ?? "node:22-slim";
  const networkName = env.SANDBOX_NETWORK_NAME ?? "adorable_sandboxes";
  if (networkName === "host" || networkName === "bridge") {
    throw new Error(
      `sandbox-docker-config: SANDBOX_NETWORK_NAME must be a custom network, got "${networkName}"`,
    );
  }

  const nanoCpus = parseCpuLimit(env.SANDBOX_CPU_LIMIT, 2_000_000_000); // 2 cores
  const memoryBytes = parseIntOr(env.SANDBOX_MEMORY_LIMIT, 2_147_483_648); // 2 GiB
  const pidsLimit = parseIntOr(env.SANDBOX_PIDS_LIMIT, 512);
  const storageBytes = env.SANDBOX_STORAGE_LIMIT
    ? parseIntOr(env.SANDBOX_STORAGE_LIMIT, 0)
    : undefined;
  const tmpSizeBytes = parseIntOr(env.SANDBOX_TMP_SIZE_BYTES, 104_857_600); // 100 MiB
  const nofile = parseIntOr(env.SANDBOX_ULIMIT_NOFILE, 1024);
  const user = opts.user ?? env.SANDBOX_USER ?? "1000:1000";
  if (user === "0" || user === "0:0" || user === "root") {
    throw new Error(
      `sandbox-docker-config: User must not be root, got "${user}"`,
    );
  }

  const labels: Record<string, string> = {
    "adorable.sandbox": "true",
    "adorable.sandboxId": opts.sandboxId,
    "adorable.repoId": opts.repoId,
    "adorable.createdAt": new Date().toISOString(),
    ...(opts.labels ?? {}),
  };

  const exposedPortsMap: Record<string, Record<string, unknown>> = {};
  for (const p of opts.exposedPorts ?? []) {
    exposedPortsMap[`${p}/tcp`] = {};
  }

  const envPairs = Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${v}`);

  const blkioReadBps = env.SANDBOX_BLKIO_READ_BPS
    ? parseIntOr(env.SANDBOX_BLKIO_READ_BPS, 0)
    : undefined;
  const blkioWriteBps = env.SANDBOX_BLKIO_WRITE_BPS
    ? parseIntOr(env.SANDBOX_BLKIO_WRITE_BPS, 0)
    : undefined;
  const blkioDevice = env.SANDBOX_BLKIO_DEVICE;

  // Dockerode типы у HostConfig/Config не покрывают всего — приводим как
  // `Dockerode.ContainerCreateOptions`, но детально собираем объект.
  const hostConfig: Dockerode.HostConfig = {
    // (1) CPU limit
    NanoCpus: nanoCpus,
    // (2) Memory limit
    Memory: memoryBytes,
    // (3) Swap off
    MemorySwap: memoryBytes,
    // (4) PIDs limit
    PidsLimit: pidsLimit,
    // (5) Read-only rootfs
    ReadonlyRootfs: true,
    // (6) no-new-privileges
    SecurityOpt: ["no-new-privileges:true"],
    // (7) Drop all capabilities
    CapDrop: ["ALL"],
    // (9) ulimits
    Ulimits: [
      { Name: "nofile", Soft: nofile, Hard: nofile },
      { Name: "core", Soft: 0, Hard: 0 },
    ],
    // (11) Block I/O limits (optional — only when real device given)
    ...(blkioDevice && blkioReadBps
      ? {
          BlkioDeviceReadBps: [{ Path: blkioDevice, Rate: blkioReadBps }],
        }
      : {}),
    ...(blkioDevice && blkioWriteBps
      ? {
          BlkioDeviceWriteBps: [{ Path: blkioDevice, Rate: blkioWriteBps }],
        }
      : {}),
    // (12) Custom network
    NetworkMode: networkName,
    // (13) AutoRemove: мы выбрали ЛОЖЬ + cleanup worker с TTL (см. ADR-012),
    // чтобы долгоживущие sandbox'ы можно было рестартить.
    AutoRemove: false,
    // (14) Tmpfs /tmp + writable workspace.
    //
    // Рабочая директория — tmpfs с явным uid/mode чтобы sandbox-user
    // (дефолт 1000:1000) мог писать в /workspace при ReadonlyRootfs=true.
    // Персистентность между рестартами контейнера теряется, но для
    // sandbox-агента Adorable это приемлемо: код хранится в Gitea-репо,
    // sandbox клонирует его при старте. "Sticky" persistence — v2.
    Tmpfs: {
      "/tmp": `rw,nosuid,nodev,size=${tmpSizeBytes},mode=1777`,
      [opts.workdir]: `rw,nosuid,nodev,size=${Math.max(
        storageBytes ?? 1_073_741_824,
        104_857_600,
      )},uid=${(opts.user ?? user).split(":")[0]},gid=${
        (opts.user ?? user).split(":")[1] ?? (opts.user ?? user).split(":")[0]
      },mode=0755`,
    },
    // Restart полисия — on-failure (не unless-stopped, чтобы cleanup мог убить).
    RestartPolicy: { Name: "no" },
  };

  // (10) Storage limit — работает только на overlay2 + xfs/btrfs с pquota.
  // Добавляем только если задано; иначе создание упадёт на ext4.
  if (storageBytes && storageBytes > 0) {
    hostConfig.StorageOpt = { size: `${storageBytes}` };
  }

  const containerConfig: Dockerode.ContainerCreateOptions = {
    name: opts.sandboxId,
    Image: image,
    // (8) Non-root user
    User: user,
    WorkingDir: opts.workdir,
    Cmd: opts.cmd,
    Env: envPairs.length ? envPairs : undefined,
    ExposedPorts: Object.keys(exposedPortsMap).length
      ? exposedPortsMap
      : undefined,
    Labels: labels,
    Tty: false,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    OpenStdin: false,
    HostConfig: hostConfig,
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: {
          Aliases: [opts.sandboxId],
        },
      },
    },
  };

  return {
    createOptions: containerConfig,
    limits: {
      nanoCpus,
      memoryBytes,
      pidsLimit,
      storageBytes,
      networkName,
      readonlyRootfs: true,
      user,
      capDrop: ["ALL"],
      securityOpt: ["no-new-privileges:true"],
      tmpSizeBytes,
    },
  };
};
