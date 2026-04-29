// In-memory mock реализация PreviewProvider — для unit/contract тестов.
// Не подтягивает docker, fs или сетевые зависимости.
//
// Контракт: docs/preview-provider/CONTRACTS.md §1–10.

import type {
  BuildOptions,
  BuildResult,
  FileEntry,
  PreviewCapabilities,
  PreviewCreateOptions,
  PreviewMetadata,
  PreviewProvider,
  ProjectFs,
  SearchResult,
} from "./preview";
import { ProjectFsError, STATIC_CAPABILITIES } from "./preview";

export interface MockPreviewProviderOptions {
  /** Capabilities, которые провайдер декларирует. Default — STATIC_CAPABILITIES. */
  capabilities?: PreviewCapabilities;
  /** Хост-префикс для URL'ов (без порта). Default "preview.localhost". */
  previewBaseDomain?: string;
  /** Хост-префикс для published URL'ов. Default "localhost". */
  publishedBaseDomain?: string;
  /** Поведение build() — для тестирования error-flow. Default "succeeded". */
  buildOutcome?: "succeeded" | "failed" | "cancelled";
}

interface MockProjectState {
  meta: PreviewMetadata;
  files: Map<string, string>;
  lastTouchedAt: string;
}

export const createMockPreviewProvider = (
  options: MockPreviewProviderOptions = {},
): PreviewProvider => {
  const capabilities = options.capabilities ?? STATIC_CAPABILITIES;
  const previewBase = options.previewBaseDomain ?? "preview.localhost";
  const publishedBase = options.publishedBaseDomain ?? "localhost";
  const outcome = options.buildOutcome ?? "succeeded";

  const state = new Map<string, MockProjectState>();

  const buildMetadata = (
    repoId: string,
    createdAt: string,
  ): PreviewMetadata => {
    const meta: PreviewMetadata = {
      projectId: repoId,
      previewUrl: `http://${repoId}.${previewBase}`,
      publishedUrl: `http://${repoId}.${publishedBase}`,
      capabilities,
      createdAt,
    };
    if (capabilities.shellAccess) {
      meta.terminalUrls = {
        devCommand: `http://${repoId}-dev.${previewBase}`,
        additional: `http://${repoId}-aux.${previewBase}`,
      };
    }
    return meta;
  };

  const provider: PreviewProvider = {
    name: "mock",
    capabilities,

    async create(opts: PreviewCreateOptions): Promise<PreviewMetadata> {
      const existing = state.get(opts.repoId);
      if (existing) return existing.meta;
      const now = new Date().toISOString();
      const meta = buildMetadata(opts.repoId, now);
      state.set(opts.repoId, {
        meta,
        files: new Map<string, string>(),
        lastTouchedAt: now,
      });
      return meta;
    },

    async build(opts: BuildOptions): Promise<BuildResult> {
      const succeeded = outcome === "succeeded";
      return {
        status: outcome,
        exitCode: succeeded ? 0 : outcome === "cancelled" ? -1 : 1,
        durationMs: 0,
        artifactPath: succeeded
          ? `/mock/static/${opts.projectId}/builds/mock-${opts.buildId ?? "default"}`
          : undefined,
        wasSwapped: succeeded && !opts.skipCurrentSwap,
        errors:
          outcome === "failed"
            ? [{ code: "unknown", message: "mock build failed" }]
            : [],
        warnings: [],
        stdout: succeeded ? "mock build OK\n" : "",
        stderr: outcome === "failed" ? "mock build failed\n" : "",
      };
    },

    async destroy(projectId: string): Promise<void> {
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
      return createInMemoryProjectFs(entry.files);
    },
  };

  return provider;
};

// ---------------------------------------------------------------------------
// In-memory ProjectFs — без whitelist enforcement (mock; тесты смотрят
// контракт высокого уровня). Whitelist enforcement тестируется в
// project-fs.test.ts когда появится реальная impl (Phase 2).
// ---------------------------------------------------------------------------

const normalizePath = (p: string): string => {
  if (p.startsWith("/")) {
    throw new ProjectFsError(
      "invalid-path",
      `Absolute path not allowed: "${p}"`,
      p,
    );
  }
  if (p.includes("..") || p.includes("\0")) {
    throw new ProjectFsError(
      "invalid-path",
      `Path contains forbidden segment: "${p}"`,
      p,
    );
  }
  return p.replace(/^\.\//, "").replace(/\/+/g, "/");
};

const createInMemoryProjectFs = (files: Map<string, string>): ProjectFs => {
  const fs: ProjectFs = {
    async readTextFile(path: string): Promise<string> {
      const norm = normalizePath(path);
      const v = files.get(norm);
      if (v === undefined) {
        throw new ProjectFsError("not-found", `File not found: ${norm}`, norm);
      }
      return v;
    },

    async writeTextFile(path: string, content: string): Promise<void> {
      const norm = normalizePath(path);
      files.set(norm, content);
    },

    async exists(path: string): Promise<boolean> {
      const norm = normalizePath(path);
      if (files.has(norm)) return true;
      const dirPrefix = norm.endsWith("/") ? norm : `${norm}/`;
      for (const k of files.keys()) {
        if (k.startsWith(dirPrefix)) return true;
      }
      return false;
    },

    async list(opts): Promise<FileEntry[]> {
      const root = opts.path ? normalizePath(opts.path) : "";
      const maxDepth = Math.min(Math.max(opts.maxDepth ?? 3, 1), 8);
      const recursive = opts.recursive ?? false;
      const prefix = root ? (root.endsWith("/") ? root : `${root}/`) : "";
      const seenDirs = new Set<string>();
      const entries: FileEntry[] = [];
      for (const [path, content] of files.entries()) {
        if (prefix && !path.startsWith(prefix)) continue;
        const rel = path.slice(prefix.length);
        const segments = rel.split("/");
        if (!recursive && segments.length > 1) {
          const dir = `${prefix}${segments[0]}`;
          if (!seenDirs.has(dir)) {
            seenDirs.add(dir);
            entries.push({ path: dir, type: "directory" });
          }
          continue;
        }
        if (segments.length > maxDepth) continue;
        // Накопить промежуточные dirs:
        for (let i = 1; i < segments.length; i++) {
          const dir = `${prefix}${segments.slice(0, i).join("/")}`;
          if (!seenDirs.has(dir)) {
            seenDirs.add(dir);
            entries.push({ path: dir, type: "directory" });
          }
        }
        entries.push({
          path,
          type: "file",
          size: Buffer.byteLength(content, "utf8"),
        });
      }
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return entries;
    },

    async search(opts): Promise<SearchResult[]> {
      const root = opts.path ? normalizePath(opts.path) : "";
      const prefix = root ? (root.endsWith("/") ? root : `${root}/`) : "";
      const maxResults = Math.min(Math.max(opts.maxResults ?? 100, 1), 500);
      const results: SearchResult[] = [];
      for (const [path, content] of files.entries()) {
        if (prefix && !path.startsWith(prefix)) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(opts.query)) {
            results.push({ file: path, line: i + 1, text: lines[i] });
            if (results.length >= maxResults) return results;
          }
        }
      }
      return results;
    },

    async remove(path: string): Promise<void> {
      const norm = normalizePath(path);
      if (files.has(norm)) {
        files.delete(norm);
        return;
      }
      const dirPrefix = norm.endsWith("/") ? norm : `${norm}/`;
      for (const k of Array.from(files.keys())) {
        if (k.startsWith(dirPrefix)) files.delete(k);
      }
    },

    async rename(from: string, to: string): Promise<void> {
      const fromNorm = normalizePath(from);
      const toNorm = normalizePath(to);
      if (files.has(fromNorm)) {
        const content = files.get(fromNorm)!;
        files.delete(fromNorm);
        files.set(toNorm, content);
        return;
      }
      const fromPrefix = fromNorm.endsWith("/") ? fromNorm : `${fromNorm}/`;
      const toPrefix = toNorm.endsWith("/") ? toNorm : `${toNorm}/`;
      for (const k of Array.from(files.keys())) {
        if (k.startsWith(fromPrefix)) {
          const content = files.get(k)!;
          files.delete(k);
          files.set(toPrefix + k.slice(fromPrefix.length), content);
        }
      }
    },

    async mkdir(_path: string): Promise<void> {
      // In-memory fs: directories are implicit. No-op.
    },
  };
  return fs;
};
