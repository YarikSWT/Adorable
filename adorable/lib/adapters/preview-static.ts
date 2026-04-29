// Static PreviewProvider — vite build в ephemeral docker-runner'е, Caddy
// file_server раздаёт билд-артефакт.
//
// Контракт: docs/preview-provider/CONTRACTS.md §1–10.
// Operational details: docs/preview-provider/BUILD_PIPELINE.md.
//
// Phase 2 scope (этот файл): create / destroy / touch / getProjectFs.
//   - create(): allocate scratch dir, copy templates/vite-react/{src,public,
//     functions} into it, register Caddy file_server route to current symlink.
//   - destroy(): rm -rf scratch + static dirs, removeRoute.
//   - touch(): update lastTouched timestamp (для будущего cleanup-worker).
//   - getProjectFs(): node:fs ProjectFs scoped to scratch dir.
//
// build() — реальная docker-сборка — лендит в следующей итерации Phase 2.
// Сейчас броcает explicit "not implemented yet" чтобы caller получил
// чёткое сообщение.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { resolveTemplateDir } from "@/lib/template-seeder";
import { getProxyProvider } from "@/lib/proxy/provider-singleton";
import { createNodeFsProjectFs } from "@/lib/preview/project-fs";

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
}

interface StaticPreviewState {
  meta: PreviewMetadata;
  projectDir: string;
  staticDir: string;
  routeId: string;
  lastTouchedAt: string;
}

const resolveProjectsRoot = (override?: string): string =>
  path.resolve(
    override ?? process.env["PROJECTS_ROOT"] ?? "/data/projects",
  );

const resolveStaticRoot = (override?: string): string =>
  path.resolve(override ?? process.env["STATIC_ROOT"] ?? "/data/static");

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

export const createStaticPreviewProvider = (
  options: StaticPreviewProviderOptions = {},
): PreviewProvider => {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const staticRoot = resolveStaticRoot(options.staticRoot);
  const previewSuffix = resolveDomainSuffix(options.previewDomainSuffix);
  const publishedSuffix =
    options.publishedDomainSuffix ??
    process.env["PUBLISHED_DOMAIN_SUFFIX"] ??
    previewSuffix.replace(/^preview\./, "");
  const proto = resolveProtocol(options.previewProtocol);
  const portSegment = resolvePortSegment(options.previewPortSegment, proto);
  const proxyFactory = options.proxyProviderFactory ?? getProxyProvider;
  const templateDir = options.templateDir ?? resolveTemplateDir();

  const state = new Map<string, StaticPreviewState>();

  const projectScratchDir = (repoId: string): string =>
    path.join(projectsRoot, repoId);
  const projectStaticDir = (repoId: string): string =>
    path.join(staticRoot, repoId);
  const currentSymlinkPath = (repoId: string): string =>
    path.join(projectStaticDir(repoId), "current");

  const buildPreviewMetadata = (
    repoId: string,
    createdAt: string,
  ): PreviewMetadata => {
    const previewHost = `${repoId}.${previewSuffix}`;
    const publishedHost = `${repoId}.${publishedSuffix || previewSuffix}`;
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

      // Register Caddy file_server route → static current/.
      const routeId = `static-${opts.repoId}`;
      const previewHost = `${opts.repoId}.${previewSuffix}`;
      try {
        const proxy = await proxyFactory();
        await proxy.addRoute({
          id: routeId,
          hostname: previewHost,
          target: { type: "static", rootDir: currentLink },
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
      });
      return meta;
    },

    async build(opts: BuildOptions): Promise<BuildResult> {
      // Реальный docker run + atomic swap лендят следующим итером.
      // До тех пор build вернёт failed-stub чтобы caller'ы (chat onFinish)
      // не упали при попытке вызова.
      void opts;
      return {
        status: "failed",
        exitCode: -1,
        durationMs: 0,
        wasSwapped: false,
        errors: [
          {
            code: "unknown",
            message:
              "preview-static.build() not implemented yet — Phase 2 docker integration follow-up iter.",
          },
        ],
        warnings: [],
        stdout: "",
        stderr: "",
      };
    },

    async destroy(projectId: string): Promise<void> {
      const entry = state.get(projectId);
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
      const entry = state.get(projectId);
      if (!entry) return;
      entry.lastTouchedAt = new Date().toISOString();
    },

    async getProjectFs(projectId: string): Promise<ProjectFs | null> {
      const entry = state.get(projectId);
      if (!entry) return null;
      return createNodeFsProjectFs({ rootDir: entry.projectDir });
    },
  };

  return provider;
};
