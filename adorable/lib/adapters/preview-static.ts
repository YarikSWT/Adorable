// Static PreviewProvider — vite build в ephemeral docker-runner'е, Caddy
// file_server раздаёт билд-артефакт.
//
// Контракт: docs/preview-provider/CONTRACTS.md §1–10.
// Operational details: docs/preview-provider/BUILD_PIPELINE.md.
//
// Этот файл владеет lifecycle (create/destroy/touch/getProjectFs) и
// orchestration build()'а: формирование buildId, вызов executor'а,
// парсинг ошибок, atomic swap, build-history GC.
//
// Сам docker-run абстрагирован за `BuildExecutor` (см. ниже). Default
// real-docker executor лежит в lib/preview/build-runner-docker.ts (lazy
// import); тесты передают свой executor через factory option.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { resolveTemplateDir } from "@/lib/template-seeder";
import { getProxyProvider } from "@/lib/proxy/provider-singleton";
import { createNodeFsProjectFs } from "@/lib/preview/project-fs";
import {
  parseBuildErrors,
  parseBuildWarnings,
} from "@/lib/preview/build-error-parser";
import { getSharedAuditLogger } from "@/lib/sandbox/audit-log";

import {
  STATIC_CAPABILITIES,
  type BuildOptions,
  type BuildResult,
  type PreviewCreateOptions,
  type PreviewMetadata,
  type PreviewProvider,
  type ProjectFs,
} from "./preview";
import type { ProxyProvider } from "./proxy";

// ---------------------------------------------------------------------------
// BuildExecutor — то что фактически запускает контейнер.
// ---------------------------------------------------------------------------

export interface BuildExecutorInput {
  projectId: string;
  /** Уникальный id внутри билда — вкл. в имя artifact dir. */
  buildId: string;
  /** Источник: project source files (RW в .vite, RO в src/public). */
  scratchDir: string;
  /** Где должен лежать готовый артефакт (RW для контейнера). */
  artifactDir: string;
  /** Версия boilerplate'а — определяет image tag и named volume. */
  boilerplateVersion: string;
  /** Опциональный signal для cancel. Реализация шлёт SIGTERM/SIGKILL. */
  signal?: AbortSignal;
}

export interface BuildExecutorResult {
  /** Exit code контейнера (-1 если cancelled до старта). */
  exitCode: number;
  /** Captured stdout (capped по BUILD_LOG_MAX_BYTES). */
  stdout: string;
  /** Captured stderr (capped по BUILD_LOG_MAX_BYTES). */
  stderr: string;
  /** True если получили signal == abort и контейнер был убит. */
  cancelled: boolean;
  /** True если hard-timeout сработал (BUILD_RUNNER_TIMEOUT_MS). */
  timedOut: boolean;
  /** Длительность от старта до выхода контейнера, мс. */
  durationMs: number;
}

export interface BuildExecutor {
  /**
   * Run vite build inside an ephemeral container. Implementation responsibility:
   *   - mount scratch + artifactDir per BUILD_PIPELINE §4.2
   *   - stream logs into bounded buffers
   *   - honour AbortSignal (kill container on abort)
   *   - apply hard timeout (BUILD_RUNNER_TIMEOUT_MS)
   * Implementation MUST NOT touch atomic swap or symlinks — that's orchestration.
   */
  runBuild(opts: BuildExecutorInput): Promise<BuildExecutorResult>;
}

const TEMPLATE_COPY_DIRS = ["src", "public", "functions"] as const;
const TEMPLATE_COPY_IGNORE = new Set<string>([
  ".gitkeep",
  "node_modules",
  ".git",
  ".DS_Store",
  "tsconfig.json", // functions/tsconfig.json лежит в build-runner image, не в scratch
]);

export interface StaticPreviewProviderOptions {
  /** Override корня scratch dir. Default — env PROJECTS_ROOT или /data/projects. */
  projectsRoot?: string;
  /** Override корня артефактов. Default — env STATIC_ROOT или /data/static. */
  staticRoot?: string;
  /**
   * Path the Caddy container sees for the same content as staticRoot.
   * Default — env CADDY_STATIC_ROOT или "/data/static". Used when
   * registering the file_server route so Caddy gets a path it can
   * actually open (it lives in a container; staticRoot is the host
   * path). When dev runs Caddy and Node on the same FS at the same
   * path, set this equal to staticRoot for a no-op rewrite.
   */
  caddyStaticRoot?: string;
  /**
   * Override domain-suffix для preview URL'ов. Default — env
   * PREVIEW_DOMAIN_SUFFIX или "preview.localhost".
   */
  previewDomainSuffix?: string;
  /** Override "published" host suffix. Default — env PUBLISHED_DOMAIN_SUFFIX или PREVIEW_DOMAIN_SUFFIX. */
  publishedDomainSuffix?: string;
  /** "http" / "https". Default — env PREVIEW_PROTOCOL или "http". */
  previewProtocol?: string;
  /** Override port suffix (":8080" etc.). Default — derived from CADDY_HTTP_PORT. */
  previewPortSegment?: string;
  /** Override factory для proxy provider'а. Default — getProxyProvider() singleton. */
  proxyProviderFactory?: () => Promise<ProxyProvider>;
  /** Override template dir. */
  templateDir?: string;
  /**
   * BuildExecutor — реализация docker-run для билда. Default — lazy
   * import build-runner-docker.ts (требует docker daemon). Тесты
   * передают свой mock executor.
   */
  buildExecutor?: BuildExecutor;
  /** Override BUILD_HISTORY_LIMIT (default env или 5). */
  buildHistoryLimit?: number;
  /**
   * Optional audit logger — when set, build_swap + build_gc events
   * are emitted (BUILD_PIPELINE §9). Default: not logged. The
   * production singleton wires getSharedAuditLogger() automatically.
   */
  auditLogger?: import("@/lib/sandbox/audit-log").AuditLogger;
}

interface StaticPreviewState {
  meta: PreviewMetadata;
  projectDir: string;
  staticDir: string;
  routeId: string;
  lastTouchedAt: string;
  boilerplateVersion: string;
}

const resolveProjectsRoot = (override?: string): string =>
  path.resolve(
    override ?? process.env["PROJECTS_ROOT"] ?? "/data/projects",
  );

const resolveStaticRoot = (override?: string): string =>
  path.resolve(override ?? process.env["STATIC_ROOT"] ?? "/data/static");

/**
 * Path the Caddy container sees for the same content as STATIC_ROOT
 * on the host. The Node process writes via STATIC_ROOT (host path);
 * Caddy serves via this in-container path. They must point at the
 * same bytes — wired by docker-compose's bind mount.
 *
 * Default `/data/static` matches the bind mount target in
 * docker-compose.yml (`${STATIC_ROOT:-/tmp/adorable-data/static}:/data/static:ro`).
 *
 * When dev runs Caddy and Node on the SAME filesystem with the same
 * STATIC_ROOT, set CADDY_STATIC_ROOT to the same value (no rewrite).
 */
const resolveCaddyStaticRoot = (override?: string): string =>
  override ?? process.env["CADDY_STATIC_ROOT"] ?? "/data/static";

const resolveDomainSuffix = (override?: string): string =>
  override ??
  process.env["PREVIEW_DOMAIN_SUFFIX"] ??
  "preview.localhost";

const resolveProtocol = (override?: string): string =>
  override ?? process.env["PREVIEW_PROTOCOL"] ?? "http";

const resolvePortSegment = (override?: string, proto = "http"): string => {
  if (override !== undefined) return override;
  const explicit =
    process.env["PREVIEW_PUBLIC_PORT"] ?? process.env["CADDY_HTTP_PORT"];
  const port = explicit ? Number.parseInt(explicit, 10) : NaN;
  if (!Number.isFinite(port) || port <= 0) return "";
  const defaultPort = proto === "https" ? 443 : 80;
  return port === defaultPort ? "" : `:${port}`;
};

const copyTemplateFiles = async (
  templateDir: string,
  projectDir: string,
): Promise<void> => {
  for (const sub of TEMPLATE_COPY_DIRS) {
    const srcDir = path.join(templateDir, sub);
    const destDir = path.join(projectDir, sub);
    await fs.mkdir(destDir, { recursive: true });
    let exists = false;
    try {
      await fs.access(srcDir);
      exists = true;
    } catch {
      /* template dir missing this sub — OK, just create empty */
    }
    if (!exists) continue;
    await copyTreeFiltered(srcDir, destDir);
  }
};

const copyTreeFiltered = async (
  src: string,
  dest: string,
): Promise<void> => {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    if (TEMPLATE_COPY_IGNORE.has(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await fs.mkdir(d, { recursive: true });
      await copyTreeFiltered(s, d);
    } else if (ent.isFile()) {
      await fs.copyFile(s, d);
    }
    // symlinks/etc — не копируем (template их не содержит)
  }
};

const resolveBuildHistoryLimit = (override?: number): number => {
  if (typeof override === "number" && override > 0) return override;
  const env = Number.parseInt(process.env["BUILD_HISTORY_LIMIT"] ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 5;
};

const allocateBuildId = (override?: string): string => {
  if (override) return override;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${randomUUID().slice(0, 4)}`;
};

/** Pure helper — атомарно (через mkdir+rename) переключает symlink. */
const atomicSymlinkSwap = async (
  staticDir: string,
  newBuildId: string,
): Promise<{ oldTarget: string | null }> => {
  const currentLink = path.join(staticDir, "current");
  const tmpLink = path.join(staticDir, "current.tmp");
  let oldTarget: string | null = null;
  try {
    oldTarget = await fs.readlink(currentLink);
  } catch {
    /* нет предыдущего — ОК */
  }
  // Удалим возможный stale tmp:
  await fs.rm(tmpLink, { force: true });
  await fs.symlink(`builds/${newBuildId}`, tmpLink);
  await fs.rename(tmpLink, currentLink);

  // previous = старый current target.
  if (oldTarget) {
    const previousLink = path.join(staticDir, "previous");
    const previousTmp = path.join(staticDir, "previous.tmp");
    await fs.rm(previousTmp, { force: true });
    await fs.symlink(oldTarget, previousTmp);
    await fs.rename(previousTmp, previousLink);
  }
  return { oldTarget };
};

const garbageCollectBuilds = async (
  staticDir: string,
  limit: number,
): Promise<{ deleted: string[] }> => {
  const buildsDir = path.join(staticDir, "builds");
  let entries: string[];
  try {
    entries = await fs.readdir(buildsDir);
  } catch {
    return { deleted: [] };
  }
  const protect = new Set<string>();
  for (const sym of ["current", "previous"]) {
    try {
      const t = await fs.readlink(path.join(staticDir, sym));
      // Targets like "builds/<id>" — extract <id>.
      protect.add(path.basename(t));
    } catch {
      /* nothing to protect */
    }
  }
  protect.add("placeholder"); // Never delete the placeholder.
  // Sort descending so the newest stay (ISO timestamps sort lexicographically).
  const sorted = entries.sort().reverse();
  const keep = new Set<string>();
  for (const id of sorted) {
    if (protect.has(id)) {
      keep.add(id);
      continue;
    }
    if (keep.size < limit) {
      keep.add(id);
    }
  }
  const deleted: string[] = [];
  for (const id of sorted) {
    if (keep.has(id)) continue;
    await fs.rm(path.join(buildsDir, id), { recursive: true, force: true });
    deleted.push(id);
  }
  return { deleted };
};

let cachedDefaultExecutor: BuildExecutor | null = null;
const getDefaultBuildExecutor = async (): Promise<BuildExecutor> => {
  if (cachedDefaultExecutor) return cachedDefaultExecutor;
  // Lazy import — production-only, требует docker daemon.
  const mod = await import("@/lib/preview/build-runner-docker");
  cachedDefaultExecutor = mod.createDockerBuildExecutor();
  return cachedDefaultExecutor;
};

export const createStaticPreviewProvider = (
  options: StaticPreviewProviderOptions = {},
): PreviewProvider => {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const staticRoot = resolveStaticRoot(options.staticRoot);
  const caddyStaticRoot = resolveCaddyStaticRoot(options.caddyStaticRoot);
  const previewSuffix = resolveDomainSuffix(options.previewDomainSuffix);
  const publishedSuffix =
    options.publishedDomainSuffix ??
    process.env["PUBLISHED_DOMAIN_SUFFIX"] ??
    previewSuffix.replace(/^preview\./, "");
  const proto = resolveProtocol(options.previewProtocol);
  const portSegment = resolvePortSegment(options.previewPortSegment, proto);
  const proxyFactory = options.proxyProviderFactory ?? getProxyProvider;
  const templateDir = options.templateDir ?? resolveTemplateDir();
  const buildHistoryLimit = resolveBuildHistoryLimit(options.buildHistoryLimit);
  const executor = options.buildExecutor;
  // Default to the shared audit logger; tests pass `auditLogger: null`
  // (cast to any) when they want to silence it. Most tests just set
  // SANDBOX_AUDIT_LOG to a tmp path.
  const audit =
    "auditLogger" in options ? options.auditLogger : getSharedAuditLogger();

  const state = new Map<string, StaticPreviewState>();

  const projectScratchDir = (repoId: string): string =>
    path.join(projectsRoot, repoId);
  const projectStaticDir = (repoId: string): string =>
    path.join(staticRoot, repoId);
  const currentSymlinkPath = (repoId: string): string =>
    path.join(projectStaticDir(repoId), "current");
  const persistedStatePath = (repoId: string): string =>
    path.join(projectStaticDir(repoId), ".preview-state.json");

  /**
   * Lazy re-hydration of the in-memory state Map after a process
   * restart (OPEN_QUESTIONS §L3). The Map lives only in the singleton
   * closure, but `create()` writes a tiny `.preview-state.json` next to
   * the static dir so subsequent boots can reconstruct the entry from
   * disk without re-doing template seeding or proxy registration.
   *
   * Returns the state if disk has enough to rebuild it; null otherwise
   * (treated as "project never created").
   */
  const tryRehydrateFromDisk = async (
    repoId: string,
  ): Promise<StaticPreviewState | null> => {
    const projectDir = projectScratchDir(repoId);
    const staticDir = projectStaticDir(repoId);
    let stat;
    try {
      stat = await fs.stat(projectDir);
    } catch {
      return null;
    }
    if (!stat.isDirectory()) return null;

    let persisted: { boilerplateVersion: string; createdAt: string };
    try {
      const raw = await fs.readFile(persistedStatePath(repoId), "utf8");
      persisted = JSON.parse(raw) as typeof persisted;
    } catch {
      // No persisted state — the project pre-dates §L3 fix. Fall back
      // to "1.0.0" (the only version that ever existed before this
      // commit) and now-as-createdAt. Subsequent build() will use the
      // current build-runner image tag.
      persisted = {
        boilerplateVersion: "1.0.0",
        createdAt: new Date().toISOString(),
      };
    }
    const meta = buildPreviewMetadata(repoId, persisted.createdAt);
    const entry: StaticPreviewState = {
      meta,
      projectDir,
      staticDir,
      routeId: `static-${subdomainKey(repoId)}`,
      lastTouchedAt: persisted.createdAt,
      boilerplateVersion: persisted.boilerplateVersion,
    };
    state.set(repoId, entry);
    return entry;
  };

  const getOrRehydrate = async (
    repoId: string,
  ): Promise<StaticPreviewState | null> => {
    const inMem = state.get(repoId);
    if (inMem) return inMem;
    return tryRehydrateFromDisk(repoId);
  };

  // Subdomain key — DNS-safe slug derived deterministically from repoId.
  // Wrapper repoIds are `<owner>/<name>` with a slash; that slash kills
  // any HTTP Host header (Caddy returns 400 "malformed Host header").
  // Sandbox-mode dodges this by using a random 8-char UUID slice; we
  // need the same shape for static-mode but stable per project so a
  // restart doesn't change the URL. Hash gives us both.
  const subdomainKey = (repoId: string): string =>
    createHash("sha256").update(repoId).digest("hex").slice(0, 8);

  const buildPreviewMetadata = (
    repoId: string,
    createdAt: string,
  ): PreviewMetadata => {
    const slug = subdomainKey(repoId);
    const previewHost = `${slug}.${previewSuffix}`;
    const publishedHost = `${slug}.${publishedSuffix || previewSuffix}`;
    return {
      projectId: repoId,
      previewUrl: `${proto}://${previewHost}${portSegment}`,
      publishedUrl: `${proto}://${publishedHost}${portSegment}`,
      capabilities: STATIC_CAPABILITIES,
      createdAt,
    };
  };

  const provider: PreviewProvider = {
    name: "static",
    capabilities: STATIC_CAPABILITIES,

    async create(opts: PreviewCreateOptions): Promise<PreviewMetadata> {
      const existing = state.get(opts.repoId);
      if (existing) return existing.meta;

      const projectDir = projectScratchDir(opts.repoId);
      const staticDir = projectStaticDir(opts.repoId);

      await fs.mkdir(projectDir, { recursive: true });
      await fs.mkdir(path.join(projectDir, ".vite"), { recursive: true });
      await fs.mkdir(path.join(projectDir, ".cache"), { recursive: true });
      await fs.mkdir(path.join(staticDir, "builds"), { recursive: true });

      // Initial seeding from boilerplate.
      await copyTemplateFiles(templateDir, projectDir);

      // Caddy file_server смотрит на стабильный путь `current/` — его
      // первая успешная build атомарно подменит. До того как build
      // отработает — отдадим placeholder index.html чтобы 200 OK
      // вместо 404 пользователю.
      const placeholderDir = path.join(staticDir, "builds", "placeholder");
      await fs.mkdir(placeholderDir, { recursive: true });
      await fs.writeFile(
        path.join(placeholderDir, "index.html"),
        `<!doctype html><meta charset="utf-8"><title>${opts.repoId}</title>
<body><p>Initial build pending…</p></body>`,
      );
      const currentLink = currentSymlinkPath(opts.repoId);
      try {
        await fs.symlink(
          path.relative(staticDir, placeholderDir),
          currentLink,
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }

      // Register Caddy file_server route → static current/. Uses the
      // same DNS-safe slug as buildPreviewMetadata so the registered
      // hostname matches what the iframe will request. routeId also
      // uses the slug — Caddy's `/id/<@id>` REST URL would split on
      // a literal `/` if we kept the raw repoId here.
      const slug = subdomainKey(opts.repoId);
      const routeId = `static-${slug}`;
      const previewHost = `${slug}.${previewSuffix}`;
      try {
        const proxy = await proxyFactory();
        // Caddy lives in a container; pass the container-internal
        // path so its file_server can actually open the bytes. The
        // mapping is host:`${staticRoot}` ↔ container:`${caddyStaticRoot}`
        // (wired by docker-compose bind mount).
        const caddyCurrentLink = path.join(
          caddyStaticRoot,
          opts.repoId,
          "current",
        );
        await proxy.addRoute({
          id: routeId,
          hostname: previewHost,
          target: { type: "static", rootDir: caddyCurrentLink },
        });
      } catch (err) {
        process.stderr.write(
          `preview-static: addRoute(${opts.repoId}) failed (${(err as Error).message}); preview will be unreachable until proxy is fixed.\n`,
        );
      }

      const meta = buildPreviewMetadata(opts.repoId, new Date().toISOString());
      state.set(opts.repoId, {
        meta,
        projectDir,
        staticDir,
        routeId,
        lastTouchedAt: meta.createdAt,
        boilerplateVersion: opts.boilerplateVersion,
      });

      // Persist the bits we can't re-derive (boilerplateVersion +
      // createdAt) so subsequent process restarts can re-hydrate the
      // in-memory entry without re-seeding (OPEN_QUESTIONS §L3).
      try {
        await fs.writeFile(
          persistedStatePath(opts.repoId),
          JSON.stringify(
            {
              boilerplateVersion: opts.boilerplateVersion,
              createdAt: meta.createdAt,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        process.stderr.write(
          `preview-static: failed to persist .preview-state.json for ${opts.repoId}: ${(err as Error).message}\n`,
        );
      }
      return meta;
    },

    async build(opts: BuildOptions): Promise<BuildResult> {
      const entry = await getOrRehydrate(opts.projectId);
      if (!entry) {
        return {
          status: "failed",
          exitCode: -1,
          durationMs: 0,
          wasSwapped: false,
          errors: [
            {
              code: "unknown",
              message: `preview-static.build: project "${opts.projectId}" not found — call create() first.`,
            },
          ],
          warnings: [],
          stdout: "",
          stderr: "",
        };
      }

      const buildId = allocateBuildId(opts.buildId);
      const artifactDir = path.join(entry.staticDir, "builds", buildId);
      await fs.mkdir(artifactDir, { recursive: true });

      const exec = executor ?? (await getDefaultBuildExecutor());
      const execResult = await exec.runBuild({
        projectId: opts.projectId,
        buildId,
        scratchDir: entry.projectDir,
        artifactDir,
        boilerplateVersion: entry.boilerplateVersion,
        signal: opts.signal,
      });

      const errors = parseBuildErrors({
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      });
      const warnings = parseBuildWarnings({
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      });

      const succeeded = execResult.exitCode === 0 && !execResult.cancelled;
      let status: BuildResult["status"];
      if (execResult.cancelled) status = "cancelled";
      else if (succeeded) status = "succeeded";
      else status = "failed";

      let wasSwapped = false;
      if (succeeded && !opts.skipCurrentSwap) {
        try {
          const { oldTarget } = await atomicSymlinkSwap(
            entry.staticDir,
            buildId,
          );
          wasSwapped = true;
          if (audit) {
            const event: import("@/lib/sandbox/audit-log").AuditEventInput = {
              event: "build_swap",
              projectId: opts.projectId,
              buildId,
              ...(oldTarget
                ? { previousBuildId: oldTarget.replace(/^builds\//, "") }
                : {}),
            };
            void audit.log(event).catch(() => undefined);
          }
        } catch (err) {
          errors.push({
            code: "unknown",
            message: `Atomic swap failed: ${(err as Error).message}`,
          });
        }
      }
      if (!succeeded) {
        // Cancel/fail: оставим artifactDir на диске для getBuildLogsTool;
        // GC удалит когда дойдёт до limit'а. Но если cancelled — сразу
        // вычистим чтобы не плодить мусор.
        if (execResult.cancelled) {
          await fs
            .rm(artifactDir, { recursive: true, force: true })
            .catch(() => undefined);
        }
      } else {
        // Success — GC старых билдов.
        const gcResult = await garbageCollectBuilds(
          entry.staticDir,
          buildHistoryLimit,
        ).catch(() => null);
        if (audit && gcResult && gcResult.deleted.length > 0) {
          const event: import("@/lib/sandbox/audit-log").AuditEventInput = {
            event: "build_gc",
            projectId: opts.projectId,
            deletedBuilds: gcResult.deleted,
          };
          void audit.log(event).catch(() => undefined);
        }
      }

      if (execResult.timedOut && !execResult.cancelled) {
        errors.push({
          code: "unknown",
          message: `Build timed out (exit ${execResult.exitCode}).`,
        });
        if (audit) {
          const event: import("@/lib/sandbox/audit-log").AuditEventInput = {
            event: "build_runner_killed_timeout",
            projectId: opts.projectId,
            buildId,
            durationMs: execResult.durationMs,
            exitCode: execResult.exitCode,
          };
          void audit.log(event).catch(() => undefined);
        }
      }

      return {
        status,
        exitCode: execResult.exitCode,
        durationMs: execResult.durationMs,
        ...(succeeded ? { artifactPath: artifactDir } : {}),
        wasSwapped,
        errors,
        warnings,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      };
    },

    async destroy(projectId: string): Promise<void> {
      const entry = await getOrRehydrate(projectId);
      if (!entry) return;

      try {
        const proxy = await proxyFactory();
        await proxy.removeRoute(entry.routeId);
      } catch (err) {
        process.stderr.write(
          `preview-static: removeRoute(${projectId}) failed (${(err as Error).message}); continuing cleanup.\n`,
        );
      }

      try {
        await fs.rm(entry.projectDir, { recursive: true, force: true });
      } catch (err) {
        process.stderr.write(
          `preview-static: rm scratch dir (${projectId}) failed: ${(err as Error).message}\n`,
        );
      }
      try {
        await fs.rm(entry.staticDir, { recursive: true, force: true });
      } catch (err) {
        process.stderr.write(
          `preview-static: rm static dir (${projectId}) failed: ${(err as Error).message}\n`,
        );
      }
      state.delete(projectId);
    },

    async touch(projectId: string): Promise<void> {
      const entry = await getOrRehydrate(projectId);
      if (!entry) return;
      entry.lastTouchedAt = new Date().toISOString();
    },

    async getProjectFs(projectId: string): Promise<ProjectFs | null> {
      const entry = await getOrRehydrate(projectId);
      if (!entry) return null;
      return createNodeFsProjectFs({ rootDir: entry.projectDir });
    },
  };

  return provider;
};
