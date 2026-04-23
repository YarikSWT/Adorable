// Docker-backed SandboxProvider через dockerode.
//
// Реализация следует контракту `SandboxProvider` из `sandbox.ts`.
// ВСЕ 15 ограничений из PROMPT.md применены на этапе create (см.
// `sandbox-docker-config.ts` для чистого билдера конфига + unit-тестов).
//
// Для файловой системы используем Docker Archive API: putArchive кладёт
// tar-архив в контейнер, getArchive достаёт одноэлементный tar. Это
// работает даже при ReadonlyRootfs=true, потому что /workspace смонтирован
// как rw volume.
//
// Dev server logs в первой итерации — пусто (провайдер не запускает
// dev-server явно; это делают callers через `exec`). Расширим, когда
// адаптер будет интегрирован в callers.

import Docker from "dockerode";
import * as tar from "tar-stream";
import { Readable } from "node:stream";

import type {
  ExecOptions,
  ExecResult,
  SandboxCreateOptions,
  SandboxDevServer,
  SandboxFs,
  SandboxHandle,
  SandboxProvider,
  SandboxStatus,
} from "./sandbox";
import {
  buildSandboxContainerConfig,
  type SandboxLimitsEnv,
} from "./sandbox-docker-config";
import { getSharedAuditLogger, type AuditLogger } from "../sandbox/audit-log";

type ContainerState =
  | "created"
  | "running"
  | "paused"
  | "restarting"
  | "removing"
  | "exited"
  | "dead";

const stateToStatus = (s: ContainerState | string): SandboxStatus => {
  if (s === "running" || s === "restarting") return "running";
  if (s === "created") return "creating";
  if (s === "exited" || s === "dead" || s === "removing") return "stopped";
  return "error";
};

const resolveDockerHost = (): Docker => {
  const socket = process.env["DOCKER_SOCKET"];
  if (socket && socket.startsWith("tcp://")) {
    const url = new URL(socket);
    return new Docker({
      host: url.hostname,
      port: Number.parseInt(url.port, 10) || 2375,
    });
  }
  const socketPath = socket && !socket.includes("://") ? socket : "/var/run/docker.sock";
  return new Docker({ socketPath });
};

const workspaceVolumeName = (sandboxId: string): string =>
  `adorable-ws-${sandboxId}`;

const simpleHash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
};

const readStreamToString = async (stream: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * Docker multiplexes exec stdout/stderr via an 8-byte header: [stream_type, 0, 0, 0, size(4 LE)].
 * Demux into two buffers.
 */
const demuxDockerStream = async (
  stream: NodeJS.ReadableStream,
): Promise<{ stdout: string; stderr: string }> => {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let buf = Buffer.alloc(0);

  for await (const chunk of stream) {
    const c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 8) {
      const type = buf[0];
      const size = buf.readUInt32BE(4);
      if (buf.length < 8 + size) break;
      const payload = buf.subarray(8, 8 + size);
      if (type === 2) err.push(payload);
      else out.push(payload);
      buf = buf.subarray(8 + size);
    }
  }

  return {
    stdout: Buffer.concat(out).toString("utf8"),
    stderr: Buffer.concat(err).toString("utf8"),
  };
};

const tarOne = async (name: string, content: string): Promise<Buffer> => {
  const pack = tar.pack();
  const body = Buffer.from(content, "utf8");
  pack.entry({ name, size: body.length, mode: 0o644 }, body);
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
};

const extractOne = async (
  stream: NodeJS.ReadableStream,
): Promise<string> => {
  const extract = tar.extract();
  let content = "";
  let found = false;

  return new Promise<string>((resolve, reject) => {
    extract.on("entry", (_header, streamEntry, next) => {
      if (found) {
        streamEntry.resume();
        next();
        return;
      }
      const chunks: Buffer[] = [];
      streamEntry.on("data", (c) => chunks.push(c as Buffer));
      streamEntry.on("end", () => {
        content = Buffer.concat(chunks).toString("utf8");
        found = true;
        next();
      });
      streamEntry.on("error", reject);
    });
    extract.on("finish", () => resolve(content));
    extract.on("error", reject);
    stream.pipe(extract as unknown as NodeJS.WritableStream);
  });
};

export const createDockerSandboxProvider = (
  options: { docker?: Docker; auditLogger?: AuditLogger } = {},
): SandboxProvider => {
  const docker = options.docker ?? resolveDockerHost();
  const auditLogger = options.auditLogger ?? getSharedAuditLogger();

  const envSource = process.env as unknown as SandboxLimitsEnv;

  // Phase 2 uses a tmpfs-backed /workspace (see sandbox-docker-config.ts).
  // No persistent volume is created; sandboxes clone their Gitea repo on
  // start and push changes back. Sticky volumes are a v2 enhancement.

  const buildHandleFromInspect = async (
    sandboxId: string,
    inspectData: Docker.ContainerInspectInfo,
  ): Promise<SandboxHandle> => {
    const container = docker.getContainer(inspectData.Id);
    const labels = inspectData.Config.Labels ?? {};
    const repoId = labels["adorable.repoId"] ?? "unknown";
    const workdir = inspectData.Config.WorkingDir || "/workspace";
    const createdAt = inspectData.Created ?? new Date().toISOString();
    const statusString = inspectData.State?.Status ?? "created";

    const fs: SandboxFs = {
      readTextFile: async (path) => {
        const abs = path.startsWith("/") ? path : `${workdir}/${path}`;
        const stream = (await container.getArchive({
          path: abs,
        })) as unknown as NodeJS.ReadableStream;
        return extractOne(stream);
      },
      readFile: async (p) => fs.readTextFile(p),
      writeTextFile: async (path, content) => {
        const abs = path.startsWith("/") ? path : `${workdir}/${path}`;
        const dir = abs.includes("/") ? abs.slice(0, abs.lastIndexOf("/")) : workdir;
        const base = abs.slice(abs.lastIndexOf("/") + 1);
        // Ensure destination dir exists (best-effort mkdir -p via exec).
        await exec({ command: `mkdir -p ${JSON.stringify(dir)}` }).catch(() => undefined);
        const archive = await tarOne(base, content);
        await container.putArchive(archive, { path: dir });
        await auditLogger.log({
          event: "sandbox_fs_write",
          sandboxId,
          repoId,
          path: abs,
          bytes: Buffer.byteLength(content, "utf8"),
        });
      },
      exists: async (path) => {
        const res = await exec({
          command: `test -e ${JSON.stringify(path.startsWith("/") ? path : `${workdir}/${path}`)} && echo Y || echo N`,
        });
        return res.stdout.trim() === "Y";
      },
    };

    const exec = async (opts: ExecOptions): Promise<ExecResult> => {
      const startedAt = Date.now();
      const execHandle = await container.exec({
        Cmd: ["/bin/sh", "-c", opts.command],
        AttachStdout: true,
        AttachStderr: true,
        User: inspectData.Config.User,
        WorkingDir: opts.cwd ?? workdir,
        Env: opts.env
          ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)
          : undefined,
      });

      const stream = (await execHandle.start({
        hijack: true,
        stdin: false,
      })) as unknown as NodeJS.ReadableStream;

      const timeoutMs = opts.timeoutMs ?? 120_000;
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        (stream as unknown as { destroy?: () => void }).destroy?.();
      }, timeoutMs);

      let demuxed: { stdout: string; stderr: string };
      try {
        demuxed = await demuxDockerStream(stream);
      } finally {
        clearTimeout(timeoutHandle);
      }

      const info = await execHandle.inspect();
      const exitCode = info.ExitCode ?? null;
      const duration = Date.now() - startedAt;

      await auditLogger.log({
        event: "sandbox_exec",
        sandboxId,
        repoId,
        command: opts.command,
        exitCode,
        duration_ms: duration,
        ...(timedOut ? { timedOut: true } : {}),
      });

      return {
        ok: exitCode === 0,
        exitCode,
        stdout: demuxed.stdout,
        stderr: demuxed.stderr,
        command: opts.command,
        ...(timedOut ? { timedOut: true } : {}),
      };
    };

    const devServer: SandboxDevServer = {
      getLogs: async () => {
        const logsStream = (await container.logs({
          stdout: true,
          stderr: true,
          tail: 500,
        })) as unknown as NodeJS.ReadableStream | Buffer;
        if (Buffer.isBuffer(logsStream)) return logsStream.toString("utf8");
        return readStreamToString(logsStream);
      },
    };

    const portsRecord: Record<string, number> = {};
    for (const [k] of Object.entries(inspectData.NetworkSettings?.Ports ?? {})) {
      const portNum = Number.parseInt(k.split("/")[0], 10);
      if (!Number.isNaN(portNum)) {
        portsRecord[`${portNum}`] = portNum;
      }
    }

    return {
      sandboxId,
      repoId,
      workdir,
      domains: [],
      ports: portsRecord,
      createdAt,
      status: stateToStatus(statusString),
      exec,
      fs,
      devServer,
    };
  };

  const create = async (
    opts: SandboxCreateOptions,
  ): Promise<SandboxHandle> => {
    // Docker restricts container names to [a-zA-Z0-9][a-zA-Z0-9_.-]+, so we
    // sanitize repoId — Gitea full_name uses `owner/repo` which contains `/`.
    // DNS hostnames (used by docker embedded DNS so Caddy can resolve us by
    // name) cap labels at 63 chars per RFC 1035, so the repo tag is capped
    // with a short hash suffix to keep names unique.
    const rawTag = opts.repoId.replace(/[^A-Za-z0-9_.-]/g, "-");
    const safeRepoTag =
      rawTag.length <= 28
        ? rawTag
        : `${rawTag.slice(0, 20)}-${simpleHash(rawTag)}`;
    const sandboxId =
      opts.sandboxId ??
      `adorable-sbx-${safeRepoTag}-${Date.now().toString(36)}`;
    const workdir = opts.workdir ?? "/workspace";
    const volumeName = workspaceVolumeName(sandboxId); // reserved, unused in tmpfs mode

    // Default command keeps container alive so that `exec` works.
    const cmd = ["sleep", "infinity"];
    const exposed = (opts.domains ?? []).map((d) => d.sandboxPort);

    const { createOptions, limits } = buildSandboxContainerConfig({
      sandboxId,
      repoId: opts.repoId,
      workdir,
      cmd,
      exposedPorts: exposed,
      workspaceVolumeName: volumeName,
      envSource,
      labels: opts.userId ? { "adorable.userId": opts.userId } : {},
    });

    const startedAt = Date.now();
    const container = await docker.createContainer(createOptions);
    await container.start();
    const inspectData = await container.inspect();

    await auditLogger.log({
      event: "sandbox_created",
      sandboxId,
      repoId: opts.repoId,
      userId: opts.userId,
      image: createOptions.Image ?? "unknown",
      limits,
      duration_ms: Date.now() - startedAt,
    });

    const handle = await buildHandleFromInspect(sandboxId, inspectData);
    handle.domains = opts.domains ?? [];
    // Ports dictionary keyed by role (preview/devTerminal/etc).
    const portsByRole: Record<string, number> = {};
    for (const d of opts.domains ?? []) {
      if (d.role) portsByRole[d.role] = d.sandboxPort;
    }
    Object.assign(handle.ports, portsByRole);
    return handle;
  };

  const ref = async ({
    sandboxId,
    repoId,
  }: {
    sandboxId: string;
    repoId?: string;
  }): Promise<SandboxHandle> => {
    const container = docker.getContainer(sandboxId);
    const info = await container.inspect();
    const labels = info.Config.Labels ?? {};
    if (repoId && labels["adorable.repoId"] !== repoId) {
      throw new Error(
        `sandbox-docker: sandboxId ${sandboxId} belongs to repo ${labels["adorable.repoId"]}, not ${repoId}`,
      );
    }
    return buildHandleFromInspect(sandboxId, info);
  };

  const destroy = async (sandboxId: string): Promise<void> => {
    const container = docker.getContainer(sandboxId);
    let info: Docker.ContainerInspectInfo | null = null;
    try {
      info = await container.inspect();
    } catch {
      return; // already gone — idempotent
    }
    const repoId = info.Config.Labels?.["adorable.repoId"];
    try {
      await container.stop({ t: 5 }).catch(() => undefined);
      await container.remove({ force: true, v: true }).catch(() => undefined);
    } finally {
      // No workspace volume to clean up — workdir is a tmpfs mount that
      // disappears with the container.
      await auditLogger.log({
        event: "sandbox_destroyed",
        sandboxId,
        repoId,
        reason: "manual",
      });
    }
  };

  const list = async () => {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: ["adorable.sandbox=true"] } as unknown as string,
    });
    return containers.map((c) => ({
      sandboxId: c.Labels["adorable.sandboxId"] ?? c.Names[0]?.replace(/^\//, "") ?? c.Id,
      repoId: c.Labels["adorable.repoId"] ?? "unknown",
      status: stateToStatus(c.State),
      createdAt: new Date(c.Created * 1000).toISOString(),
    }));
  };

  return {
    name: "docker",
    create,
    ref,
    destroy,
    list,
  };
};

// Re-export for convenience.
export { buildSandboxContainerConfig } from "./sandbox-docker-config";
// Silence "unused" warnings when Readable is imported for future fs impls.
export const __reserved_Readable = Readable;
