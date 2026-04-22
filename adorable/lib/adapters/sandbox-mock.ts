// In-memory mock SandboxProvider. Используется в unit-тестах и в режиме
// VITEST / NODE_ENV=test. Хранит файлы в Map, exec отвечает через
// скриптованную таблицу (или дефолтный `echo-ish` fallback).
//
// Эта реализация НЕ имитирует реальный shell — только тот узкий набор
// команд, который Adorable-агент дёргает чаще всего: `git rev-parse`,
// `ls`, `find`, `grep`, `mkdir`, `mv`, `rm`. Покрытие избирательное:
// contract-тесты проверяют только поведение, которое гарантируется
// интерфейсом `SandboxProvider`.

import type {
  ExecOptions,
  ExecResult,
  SandboxCreateOptions,
  SandboxDevServer,
  SandboxDomainSpec,
  SandboxFs,
  SandboxHandle,
  SandboxProvider,
  SandboxStatus,
} from "./sandbox";

type MockState = {
  repoId: string;
  workdir: string;
  domains: SandboxDomainSpec[];
  ports: Record<string, number>;
  createdAt: string;
  status: SandboxStatus;
  files: Map<string, string>;
  devServerLogs: string[];
  execLog: Array<{ command: string; at: string }>;
  /** Optional custom exec handler — tests can install their own. */
  execHandler?: (opts: ExecOptions) => ExecResult | Promise<ExecResult>;
};

export interface MockSandboxProvider extends SandboxProvider {
  /** Test helper — set files inline. */
  seedFiles: (sandboxId: string, files: Record<string, string>) => void;
  /** Test helper — install a custom exec responder. */
  setExecHandler: (
    sandboxId: string,
    handler: (opts: ExecOptions) => ExecResult | Promise<ExecResult>,
  ) => void;
  /** Peek internal state (tests only). */
  inspect: (sandboxId: string) => MockState | undefined;
}

const DEFAULT_PORTS: Record<string, number> = {
  preview: 3000,
  devCommandTerminal: 3010,
  additionalTerminals: 3020,
};

const normalizePath = (path: string, workdir: string): string => {
  if (path.startsWith("/")) return path;
  if (path === "." || path === "./") return workdir;
  return `${workdir.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
};

const buildHandle = (
  sandboxId: string,
  state: MockState,
  store: Map<string, MockState>,
): SandboxHandle => {
  const fs: SandboxFs = {
    readTextFile: async (path: string) => {
      const key = normalizePath(path, state.workdir);
      const v = state.files.get(key);
      if (v === undefined) {
        throw new Error(`mock-sandbox: file not found: ${key}`);
      }
      return v;
    },
    readFile: async (path: string) => {
      // Same as readTextFile in mock — real impl would return bytes.
      return fs.readTextFile(path);
    },
    writeTextFile: async (path: string, content: string) => {
      const key = normalizePath(path, state.workdir);
      state.files.set(key, content);
    },
    exists: async (path: string) => {
      const key = normalizePath(path, state.workdir);
      return state.files.has(key);
    },
  };

  const devServer: SandboxDevServer = {
    getLogs: async () => [...state.devServerLogs],
  };

  const exec = async (opts: ExecOptions): Promise<ExecResult> => {
    state.execLog.push({ command: opts.command, at: new Date().toISOString() });
    if (state.execHandler) {
      return await state.execHandler(opts);
    }
    // Default fallback — return empty stdout + ok.
    return {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      command: opts.command,
    };
  };

  return {
    sandboxId,
    repoId: state.repoId,
    workdir: state.workdir,
    domains: state.domains,
    ports: state.ports,
    createdAt: state.createdAt,
    get status() {
      // Re-read from store so destroy() becomes visible to existing handles.
      return store.get(sandboxId)?.status ?? "error";
    },
    exec,
    fs,
    devServer,
  };
};

export const createMockSandboxProvider = (): MockSandboxProvider => {
  const store = new Map<string, MockState>();
  let counter = 0;

  const mintId = (repoId: string): string =>
    `mock-sbx-${repoId}-${++counter}`;

  const create = async (
    opts: SandboxCreateOptions,
  ): Promise<SandboxHandle> => {
    const sandboxId = opts.sandboxId ?? mintId(opts.repoId);
    const workdir = opts.workdir ?? "/workspace";
    const domains = opts.domains ?? [];
    const ports: Record<string, number> = { ...DEFAULT_PORTS };
    for (const d of domains) {
      if (d.role) ports[d.role] = d.sandboxPort;
    }

    const state: MockState = {
      repoId: opts.repoId,
      workdir,
      domains,
      ports,
      createdAt: new Date().toISOString(),
      status: "running",
      files: new Map(),
      devServerLogs: [],
      execLog: [],
    };
    store.set(sandboxId, state);
    return buildHandle(sandboxId, state, store);
  };

  const ref = async ({
    sandboxId,
    repoId,
  }: {
    sandboxId: string;
    repoId?: string;
  }): Promise<SandboxHandle> => {
    const state = store.get(sandboxId);
    if (!state) {
      throw new Error(`mock-sandbox: unknown sandboxId ${sandboxId}`);
    }
    if (repoId && state.repoId !== repoId) {
      throw new Error(
        `mock-sandbox: sandboxId ${sandboxId} belongs to repo ${state.repoId}, not ${repoId}`,
      );
    }
    return buildHandle(sandboxId, state, store);
  };

  const destroy = async (sandboxId: string): Promise<void> => {
    const state = store.get(sandboxId);
    if (!state) return;
    state.status = "stopped";
    store.delete(sandboxId);
  };

  const list = async () => {
    return Array.from(store.entries()).map(([sandboxId, s]) => ({
      sandboxId,
      repoId: s.repoId,
      status: s.status,
      createdAt: s.createdAt,
    }));
  };

  const seedFiles = (
    sandboxId: string,
    files: Record<string, string>,
  ): void => {
    const state = store.get(sandboxId);
    if (!state) throw new Error(`mock-sandbox: unknown sandboxId ${sandboxId}`);
    for (const [path, content] of Object.entries(files)) {
      state.files.set(normalizePath(path, state.workdir), content);
    }
  };

  const setExecHandler: MockSandboxProvider["setExecHandler"] = (
    sandboxId,
    handler,
  ) => {
    const state = store.get(sandboxId);
    if (!state) throw new Error(`mock-sandbox: unknown sandboxId ${sandboxId}`);
    state.execHandler = handler;
  };

  const inspect = (sandboxId: string) => store.get(sandboxId);

  return {
    name: "mock",
    create,
    ref,
    destroy,
    list,
    seedFiles,
    setExecHandler,
    inspect,
  };
};
