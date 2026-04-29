// Default BuildExecutor — dockerode-backed.
//
// Запускает ephemeral build-runner контейнер с monтированиями
// согласно BUILD_PIPELINE.md §4.2:
//
//   docker run --rm --read-only --user 1000:1000 \
//     --network=$BUILD_RUNNER_NETWORK \
//     --memory=$BUILD_RUNNER_MEMORY \
//     --cpus=$BUILD_RUNNER_CPUS \
//     --pids-limit=$BUILD_RUNNER_PIDS \
//     --cap-drop ALL --security-opt no-new-privileges:true \
//     --tmpfs /tmp:size=200m \
//     --ulimit nofile=4096:4096 \
//     -v adorable_node_modules_react_<v>:/workspace/node_modules:ro \
//     -v <scratch>/src:/workspace/src:ro \
//     -v <scratch>/public:/workspace/public:ro \
//     -v <scratch>/.vite:/workspace/.vite:rw \
//     -v <artifactDir>:/workspace/dist:rw \
//     build-runner-react:<v>
//
// Cancel: AbortSignal → container.kill('SIGTERM') → grace → SIGKILL.
// Hard timeout: BUILD_RUNNER_TIMEOUT_MS (default 120 000).
// Logs: demuxed stdout/stderr into bounded buffers (BUILD_LOG_MAX_BYTES).

import Docker from "dockerode";
import { PassThrough, Writable } from "node:stream";

import type {
  BuildExecutor,
  BuildExecutorInput,
  BuildExecutorResult,
} from "@/lib/adapters/preview-static";

// ---------------------------------------------------------------------------
// Env resolution
// ---------------------------------------------------------------------------

const numEnv = (name: string, fallback: number): number => {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const strEnv = (name: string, fallback: string): string =>
  process.env[name] ?? fallback;

interface DockerExecutorEnv {
  imagePrefix: string;
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
  timeoutMs: number;
  cancelGraceMs: number;
  logMaxBytes: number;
  network: string;
  nodeModulesVolumePrefix: string;
}

const resolveEnv = (override?: Partial<DockerExecutorEnv>): DockerExecutorEnv => ({
  imagePrefix: override?.imagePrefix ?? strEnv("BUILD_RUNNER_IMAGE_PREFIX", "build-runner-"),
  memoryBytes: override?.memoryBytes ?? numEnv("BUILD_RUNNER_MEMORY", 2_147_483_648),
  nanoCpus: override?.nanoCpus ?? numEnv("BUILD_RUNNER_CPUS", 2) * 1e9,
  pidsLimit: override?.pidsLimit ?? numEnv("BUILD_RUNNER_PIDS", 512),
  timeoutMs: override?.timeoutMs ?? numEnv("BUILD_RUNNER_TIMEOUT_MS", 120_000),
  cancelGraceMs: override?.cancelGraceMs ?? numEnv("BUILD_CANCEL_GRACE_MS", 2_000),
  logMaxBytes: override?.logMaxBytes ?? numEnv("BUILD_LOG_MAX_BYTES", 16_384),
  network: override?.network ?? strEnv("BUILD_RUNNER_NETWORK", "adorable_build"),
  nodeModulesVolumePrefix:
    override?.nodeModulesVolumePrefix ??
    strEnv("BUILD_RUNNER_NODE_MODULES_VOLUME_PREFIX", "adorable_node_modules_react_"),
});

const resolveDockerHost = (override?: Docker): Docker => {
  if (override) return override;
  const socket = process.env["DOCKER_SOCKET"];
  if (socket && socket.startsWith("tcp://")) {
    const url = new URL(socket);
    return new Docker({
      host: url.hostname,
      port: Number.parseInt(url.port, 10) || 2375,
    });
  }
  const socketPath =
    socket && !socket.includes("://") ? socket : "/var/run/docker.sock";
  return new Docker({ socketPath });
};

// ---------------------------------------------------------------------------
// Bounded log buffer
// ---------------------------------------------------------------------------

class BoundedBuffer extends Writable {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly cap: number) {
    super();
  }
  override _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    if (this.size >= this.cap) return cb();
    const remaining = this.cap - this.size;
    const slice =
      chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    this.chunks.push(slice);
    this.size += slice.length;
    cb();
  }
  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

const versionToVolumeSuffix = (v: string): string => v.replace(/\./g, "_");

const buildImageTag = (env: DockerExecutorEnv, version: string): string =>
  `${env.imagePrefix}react:${version}`;

const buildNodeModulesVolume = (
  env: DockerExecutorEnv,
  version: string,
): string => `${env.nodeModulesVolumePrefix}${versionToVolumeSuffix(version)}`;

// ---------------------------------------------------------------------------
// Container config builder (pure — позволяет unit-тестировать)
// ---------------------------------------------------------------------------

export interface DockerBuildContainerConfigInput {
  env: DockerExecutorEnv;
  input: BuildExecutorInput;
}

export const buildContainerCreateOptions = (
  args: DockerBuildContainerConfigInput,
): Docker.ContainerCreateOptions => {
  const { env, input } = args;
  const image = buildImageTag(env, input.boilerplateVersion);
  const volume = buildNodeModulesVolume(env, input.boilerplateVersion);
  return {
    Image: image,
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    User: "1000:1000",
    WorkingDir: "/workspace",
    Env: [
      "NODE_ENV=production",
      `VITE_PROJECT_ID=${input.projectId}`,
      `VITE_BUILD_ID=${input.buildId}`,
    ],
    HostConfig: {
      NetworkMode: env.network,
      AutoRemove: true,
      ReadonlyRootfs: true,
      Memory: env.memoryBytes,
      NanoCpus: env.nanoCpus,
      PidsLimit: env.pidsLimit,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: { "/tmp": "size=200m" },
      Binds: [
        `${volume}:/workspace/node_modules:ro`,
        `${input.scratchDir}/src:/workspace/src:ro`,
        `${input.scratchDir}/public:/workspace/public:ro`,
        `${input.scratchDir}/.vite:/workspace/.vite:rw`,
        `${input.artifactDir}:/workspace/dist:rw`,
      ],
      Ulimits: [{ Name: "nofile", Soft: 4096, Hard: 4096 }],
    },
  };
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export interface DockerBuildExecutorOptions {
  /** Override Docker client (тесты). */
  docker?: Docker;
  /** Override env (тесты). */
  envOverride?: Partial<DockerExecutorEnv>;
}

export const createDockerBuildExecutor = (
  options: DockerBuildExecutorOptions = {},
): BuildExecutor => {
  const env = resolveEnv(options.envOverride);
  const docker = resolveDockerHost(options.docker);

  return {
    async runBuild(input: BuildExecutorInput): Promise<BuildExecutorResult> {
      const startedAt = Date.now();
      const stdoutBuf = new BoundedBuffer(env.logMaxBytes);
      const stderrBuf = new BoundedBuffer(env.logMaxBytes);

      let cancelled = false;
      let timedOut = false;

      let container: Docker.Container | null = null;

      // Already cancelled before we started:
      if (input.signal?.aborted) {
        return {
          exitCode: -1,
          stdout: "",
          stderr: "",
          cancelled: true,
          timedOut: false,
          durationMs: 0,
        };
      }

      const config = buildContainerCreateOptions({ env, input });
      container = await docker.createContainer(config);

      const onAbort = (): void => {
        cancelled = true;
        if (!container) return;
        container.kill({ signal: "SIGTERM" }).catch(() => undefined);
        setTimeout(() => {
          container?.kill({ signal: "SIGKILL" }).catch(() => undefined);
        }, env.cancelGraceMs);
      };
      input.signal?.addEventListener("abort", onAbort);

      const hardTimeout = setTimeout(() => {
        timedOut = true;
        container?.kill({ signal: "SIGKILL" }).catch(() => undefined);
      }, env.timeoutMs);

      let exitCode = -1;
      try {
        // Attach BEFORE start to capture all output.
        const attachStream = await container.attach({
          stream: true,
          stdout: true,
          stderr: true,
        });
        const stdoutPipe = new PassThrough();
        const stderrPipe = new PassThrough();
        stdoutPipe.pipe(stdoutBuf);
        stderrPipe.pipe(stderrBuf);
        // dockerode exposes demux on container.modem; the official typings
        // don't include it, so we cast.
        (container.modem as unknown as {
          demuxStream: (
            s: NodeJS.ReadableStream,
            o: NodeJS.WritableStream,
            e: NodeJS.WritableStream,
          ) => void;
        }).demuxStream(attachStream, stdoutPipe, stderrPipe);

        await container.start();
        const exitInfo = (await container.wait()) as { StatusCode: number };
        exitCode = exitInfo.StatusCode;

        // Drain demux streams (close pipes so BoundedBuffer flushes).
        stdoutPipe.end();
        stderrPipe.end();
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        // Container might be gone after kill — that's fine, we just record
        // the failure mode.
        stderrBuf.write(Buffer.from(`build-runner-docker: ${msg}\n`));
        if (exitCode === -1 && !cancelled && !timedOut) {
          // Genuine error before/around container.wait — keep -1.
        }
      } finally {
        clearTimeout(hardTimeout);
        input.signal?.removeEventListener("abort", onAbort);
      }

      return {
        exitCode,
        stdout: stdoutBuf.toString(),
        stderr: stderrBuf.toString(),
        cancelled,
        timedOut,
        durationMs: Date.now() - startedAt,
      };
    },
  };
};
