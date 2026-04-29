// Sandbox PreviewProvider — обёртка над текущим adorable-vm.ts +
// SandboxProvider. Позволяет коду который оперирует абстрактным
// PreviewProvider'ом работать с long-running Docker sandbox'ом без
// знания деталей.
//
// Контракт: docs/preview-provider/CONTRACTS.md §1–10.
// Capabilities: SANDBOX_CAPABILITIES (shellAccess + customDeps + serverRuntime
// + hotReload + manualRebuild).
//
// Build() в sandbox-режиме — no-op (HMR подхватывает изменения), возвращает
// stub-успех. Это намеренно: BuildQueue в sandbox-режиме не активен, явный
// rebuild не нужен.
//
// Phase 1 scope: тонкий wrapper. Идемпотентность create() — через in-memory
// Map<repoId,…>, потому что adorable-vm всегда создаёт новый sandboxId.
// Wire-up в репо/чат происходит в Phase 4 (MIGRATION_PATH §4).

import { createVmForRepo, type VmRuntimeMetadata } from "@/lib/adorable-vm";
import {
  getSandboxProvider,
  touchSandbox,
} from "@/lib/sandbox/provider-singleton";
import { getProxyProvider } from "@/lib/proxy/provider-singleton";

import type {
  BuildOptions,
  BuildResult,
  FileEntry,
  PreviewCreateOptions,
  PreviewMetadata,
  PreviewProvider,
  ProjectFs,
  SearchResult,
} from "./preview";
import { ProjectFsError, SANDBOX_CAPABILITIES } from "./preview";

interface SandboxPreviewState {
  meta: PreviewMetadata;
  /** sandboxId возвращённый SandboxProvider'ом (см. lib/adorable-vm.ts). */
  sandboxId: string;
}

export const createSandboxPreviewProvider = (): PreviewProvider => {
  const state = new Map<string, SandboxPreviewState>();

  const provider: PreviewProvider = {
    name: "sandbox",
    capabilities: SANDBOX_CAPABILITIES,

    async create(opts: PreviewCreateOptions): Promise<PreviewMetadata> {
      const existing = state.get(opts.repoId);
      if (existing) return existing.meta;
      const vm: VmRuntimeMetadata = await createVmForRepo(opts.repoId);
      const meta: PreviewMetadata = {
        projectId: opts.repoId,
        previewUrl: vm.previewUrl,
        // Sandbox не имеет отдельного "published" артефакта — preview === published.
        // Это будет переосмыслено в Phase 4/5 когда появится promote-flow.
        publishedUrl: vm.previewUrl,
        terminalUrls: {
          devCommand: vm.devCommandTerminalUrl,
          additional: vm.additionalTerminalsUrl,
        },
        capabilities: SANDBOX_CAPABILITIES,
        createdAt: new Date().toISOString(),
      };
      state.set(opts.repoId, { meta, sandboxId: vm.vmId });
      return meta;
    },

    async build(opts: BuildOptions): Promise<BuildResult> {
      // Sandbox использует HMR — явный билд не нужен. Возвращаем stub
      // успеха чтобы caller'ы которые ожидают BuildResult не падали.
      // wasSwapped=false потому что в sandbox нет static current symlink.
      void opts;
      return {
        status: "succeeded",
        exitCode: 0,
        durationMs: 0,
        wasSwapped: false,
        errors: [],
        warnings: [],
        stdout: "",
        stderr: "",
      };
    },

    async destroy(projectId: string): Promise<void> {
      const entry = state.get(projectId);
      if (!entry) return;
      try {
        const sandboxProvider = await getSandboxProvider();
        await sandboxProvider.destroy(entry.sandboxId);
      } catch (err) {
        // Sandbox мог уже умереть от cleanup-worker'а — это идемпотентно.
        process.stderr.write(
          `preview-sandbox: destroy(${projectId}) sandbox cleanup failed (${(err as Error).message})\n`,
        );
      }
      try {
        const proxy = await getProxyProvider();
        await proxy.removeSandboxRoutes(entry.sandboxId);
      } catch (err) {
        process.stderr.write(
          `preview-sandbox: destroy(${projectId}) proxy cleanup failed (${(err as Error).message})\n`,
        );
      }
      state.delete(projectId);
    },

    async touch(projectId: string): Promise<void> {
      const entry = state.get(projectId);
      if (!entry) return;
      touchSandbox(entry.sandboxId);
    },

    async getProjectFs(projectId: string): Promise<ProjectFs | null> {
      const entry = state.get(projectId);
      if (!entry) return null;
      const sandboxProvider = await getSandboxProvider();
      const handle = await sandboxProvider.ref({ sandboxId: entry.sandboxId });
      return adaptSandboxFsToProjectFs(handle);
    },
  };

  return provider;
};

// ---------------------------------------------------------------------------
// SandboxFs → ProjectFs adapter
//
// SandboxFs (lib/adapters/sandbox.ts) экспортирует только базовые операции
// (read/write/exists). Расширенные операции (list/search/remove/rename/
// mkdir) в sandbox-режиме реализуются через `exec` (shell). Эта адаптация
// делает их доступными через ProjectFs API, чтобы createTools() мог
// единообразно работать в обеих средах.
//
// Phase 1 scope: реализуем read/write/exists через SandboxFs напрямую,
// list/search/remove/rename/mkdir через exec. mkdir через `mkdir -p`,
// remove через `rm -rf`, rename через `mv`, list через `find -maxdepth`,
// search через `grep -rn`. Это работает только пока shellAccess=true
// (что и есть в sandbox-режиме).
// ---------------------------------------------------------------------------

const adaptSandboxFsToProjectFs = (handle: {
  fs: {
    readTextFile: (path: string) => Promise<string>;
    writeTextFile: (path: string, content: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
  };
  exec: (opts: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<{
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    command: string;
  }>;
  workdir: string;
}): ProjectFs => {
  const ensureSafePath = (path: string): string => {
    if (path.includes("..") || path.includes("\0")) {
      throw new ProjectFsError(
        "invalid-path",
        `Path contains forbidden segment: "${path}"`,
        path,
      );
    }
    return path;
  };

  const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

  const fs: ProjectFs = {
    async readTextFile(path: string): Promise<string> {
      ensureSafePath(path);
      try {
        return await handle.fs.readTextFile(path);
      } catch (err) {
        throw new ProjectFsError(
          "not-found",
          `File not readable: ${path} (${(err as Error).message})`,
          path,
        );
      }
    },

    async writeTextFile(path: string, content: string): Promise<void> {
      ensureSafePath(path);
      await handle.fs.writeTextFile(path, content);
    },

    async exists(path: string): Promise<boolean> {
      ensureSafePath(path);
      return handle.fs.exists(path);
    },

    async list(opts): Promise<FileEntry[]> {
      const path = opts.path ? ensureSafePath(opts.path) : "";
      const maxDepth = Math.min(Math.max(opts.maxDepth ?? 3, 1), 8);
      const recursive = opts.recursive ?? false;
      const targetDir = path || ".";
      const cmd = recursive
        ? `find ${shellQuote(targetDir)} -maxdepth ${maxDepth} -mindepth 1 -printf '%y %P %s\\n' 2>/dev/null`
        : `find ${shellQuote(targetDir)} -maxdepth 1 -mindepth 1 -printf '%y %P %s\\n' 2>/dev/null`;
      const res = await handle.exec({ command: cmd, cwd: handle.workdir });
      if (!res.ok) {
        throw new ProjectFsError(
          "io",
          `list(${path}) failed: ${res.stderr || res.stdout}`,
          path,
        );
      }
      const entries: FileEntry[] = [];
      for (const line of res.stdout.split("\n")) {
        if (!line) continue;
        const [type, name, sizeStr] = line.split(" ");
        if (!type || !name) continue;
        const fullPath = path ? `${path}/${name}` : name;
        if (type === "d") {
          entries.push({ path: fullPath, type: "directory" });
        } else if (type === "f") {
          const size = Number.parseInt(sizeStr ?? "0", 10);
          entries.push({
            path: fullPath,
            type: "file",
            size: Number.isFinite(size) ? size : 0,
          });
        }
      }
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return entries;
    },

    async search(opts): Promise<SearchResult[]> {
      const path = opts.path ? ensureSafePath(opts.path) : ".";
      const maxResults = Math.min(Math.max(opts.maxResults ?? 100, 1), 500);
      const target = path || ".";
      const cmd = `grep -rnI --binary-files=without-match -m ${maxResults} -- ${shellQuote(opts.query)} ${shellQuote(target)} 2>/dev/null | head -n ${maxResults}`;
      const res = await handle.exec({ command: cmd, cwd: handle.workdir });
      // grep returns exit 1 if no match; that's not an error from our POV.
      const results: SearchResult[] = [];
      for (const line of res.stdout.split("\n")) {
        if (!line || results.length >= maxResults) break;
        const m = line.match(/^([^:]+):(\d+):(.*)$/);
        if (!m) continue;
        results.push({
          file: m[1].replace(/^\.\//, ""),
          line: Number.parseInt(m[2], 10),
          text: m[3],
        });
      }
      return results;
    },

    async remove(path: string): Promise<void> {
      ensureSafePath(path);
      const res = await handle.exec({
        command: `rm -rf -- ${shellQuote(path)}`,
        cwd: handle.workdir,
      });
      if (!res.ok) {
        throw new ProjectFsError(
          "io",
          `remove(${path}) failed: ${res.stderr || res.stdout}`,
          path,
        );
      }
    },

    async rename(from: string, to: string): Promise<void> {
      ensureSafePath(from);
      ensureSafePath(to);
      const res = await handle.exec({
        command: `mkdir -p -- ${shellQuote(parentDir(to))} && mv -f -- ${shellQuote(from)} ${shellQuote(to)}`,
        cwd: handle.workdir,
      });
      if (!res.ok) {
        throw new ProjectFsError(
          "io",
          `rename(${from} -> ${to}) failed: ${res.stderr || res.stdout}`,
          from,
        );
      }
    },

    async mkdir(path: string): Promise<void> {
      ensureSafePath(path);
      const res = await handle.exec({
        command: `mkdir -p -- ${shellQuote(path)}`,
        cwd: handle.workdir,
      });
      if (!res.ok) {
        throw new ProjectFsError(
          "io",
          `mkdir(${path}) failed: ${res.stderr || res.stdout}`,
          path,
        );
      }
    },
  };
  return fs;
};

const parentDir = (path: string): string => {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "." : path.slice(0, idx);
};
