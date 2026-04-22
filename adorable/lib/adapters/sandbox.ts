// SandboxProvider — адаптер над средой выполнения AI-сгенерированного кода.
//
// Контракт сознательно очень близок к Freestyle `Vm` (freestyle-sandboxes),
// чтобы callers (create-tools.ts, adorable-vm.ts, chat/route.ts) мигрировали
// без перекройки структуры. Существенные отличия:
//
//   1. `create()` возвращает наше полнотекстовое `SandboxHandle` сразу
//      (без отдельного `.ref()` — в Docker-реализации нет долго-живущих
//      VM-ID на стороне SaaS, а есть container ID, который мы знаем сразу).
//      Для совместимости с Freestyle-стилем добавлен `ref()`, который просто
//      hydratит handle из sandboxId.
//   2. `domains` — список, потому что у Adorable 3 публичных порта
//      (preview + 2 terminal). Proxy-роуты в Caddy добавляет не sandbox-
//      провайдер, а вышележащий уровень (после того как узнал containerPort).
//   3. `exec` всегда возвращает структурированный `ExecResult` —
//      без string-варианта, который был у Freestyle. Callers уже умеют
//      работать с объектом.
//
// Переключение через env `SANDBOX_PROVIDER`:
//   - "docker" — реализация в lib/adapters/sandbox-docker.ts (Phase 2).
//   - "mock"   — in-memory для тестов.
//   - undefined → "docker" в prod, "mock" в vitest (NODE_ENV === "test").

export interface SandboxDomainSpec {
  /** Logical port inside the sandbox container, e.g. 3000 for Next.js dev. */
  sandboxPort: number;
  /**
   * Public hostname that Caddy should route to this port, e.g.
   * `abc123.preview.localhost`. The sandbox provider itself does NOT publish
   * this — the caller (proxy adapter) does — but the provider records it for
   * audit + later lookup.
   */
  hostname: string;
  /** Optional role tag: "preview" | "devCommandTerminal" | "additionalTerminals" | string */
  role?: string;
}

export interface SandboxCreateOptions {
  /** Unique project/repo identifier — used for naming + audit + persistence. */
  repoId: string;
  /**
   * Optional existing sandboxId to rehydrate (e.g. if the project already has
   * a running container). Matches Freestyle `recreate: true` semantics when
   * omitted.
   */
  sandboxId?: string;
  /** Initial working directory inside the sandbox. Defaults to `/workspace`. */
  workdir?: string;
  /** Git repo clone URLs to seed the workspace. */
  git?: {
    repos: Array<{
      /** Absolute path inside the sandbox to clone into. */
      path: string;
      /** Either a Gitea repo identifier or a full clone URL. */
      repo: string;
    }>;
    config?: {
      user?: { name?: string; email?: string };
    };
  };
  /** Public domains to expose. Proxy adapter consumes these. */
  domains?: SandboxDomainSpec[];
  /**
   * Persistence strategy:
   *   - "sticky"    — container volume persists across stops (default).
   *   - "ephemeral" — auto-remove on stop; workspace lost.
   */
  persistence?: "sticky" | "ephemeral";
  /** Actor userId for audit log (optional). */
  userId?: string;
}

export interface SandboxHandle {
  sandboxId: string;
  repoId: string;
  workdir: string;
  domains: SandboxDomainSpec[];
  /** Container-internal port mapping for each role (populated after create). */
  ports: Record<string, number>;
  createdAt: string;
  /** One of "running" | "stopped" | "creating" | "error". */
  status: SandboxStatus;
  /** Exec arbitrary shell inside sandbox. */
  exec: (opts: ExecOptions) => Promise<ExecResult>;
  fs: SandboxFs;
  devServer: SandboxDevServer;
}

export type SandboxStatus =
  | "creating"
  | "running"
  | "stopped"
  | "error";

export interface ExecOptions {
  command: string;
  /** Optional cwd relative to workdir or absolute. */
  cwd?: string;
  /** Optional extra env for this command. */
  env?: Record<string, string>;
  /** Optional timeout in ms. Default 120000. */
  timeoutMs?: number;
}

export interface ExecResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  /** True when the command timed out. */
  timedOut?: boolean;
}

export interface SandboxFs {
  /** Read file as utf-8 text. Throws on missing file. */
  readTextFile: (path: string) => Promise<string>;
  /** Alias kept for Freestyle compatibility. */
  readFile: (path: string) => Promise<string>;
  /** Write utf-8 text file, creating directories as needed. */
  writeTextFile: (path: string, content: string) => Promise<void>;
  /** Check if a file exists. */
  exists: (path: string) => Promise<boolean>;
}

export interface SandboxDevServer {
  /** Dev server stdout/stderr since start. String or string[] accepted. */
  getLogs: () => Promise<string | string[]>;
}

export interface SandboxProvider {
  name: string;
  /** Create (or rehydrate) a sandbox for a repo. */
  create: (opts: SandboxCreateOptions) => Promise<SandboxHandle>;
  /** Reattach to an existing sandbox by id. */
  ref: (opts: { sandboxId: string; repoId?: string }) => Promise<SandboxHandle>;
  /** Destroy the sandbox and release resources. Idempotent. */
  destroy: (sandboxId: string) => Promise<void>;
  /** List all sandboxes known to this provider. */
  list: () => Promise<Array<Pick<SandboxHandle, "sandboxId" | "repoId" | "status" | "createdAt">>>;
}

export type SandboxProviderName = "docker" | "mock";

const normalizeProviderName = (
  raw?: string | null,
): SandboxProviderName | null => {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "docker" || v === "dockerode") return "docker";
  if (v === "mock" || v === "test" || v === "fake") return "mock";
  return null;
};

export const resolveSandboxProviderName = (
  override?: string,
): SandboxProviderName => {
  const explicit =
    normalizeProviderName(override) ??
    normalizeProviderName(process.env["SANDBOX_PROVIDER"]);
  if (explicit) return explicit;
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) return "mock";
  return "docker";
};

/**
 * Factory — async because `docker` impl dynamically imports dockerode.
 * Callers: `await createSandboxProvider()` once at server bootstrap, then
 * reuse the same instance for all requests.
 */
export const createSandboxProvider = async (
  options: { providerOverride?: string } = {},
): Promise<SandboxProvider> => {
  const name = resolveSandboxProviderName(options.providerOverride);
  switch (name) {
    case "mock": {
      const mod = await import("./sandbox-mock");
      return mod.createMockSandboxProvider();
    }
    case "docker": {
      // lazy-require so that mock tests don't pull in dockerode.
      const mod = await import("./sandbox-docker");
      return mod.createDockerSandboxProvider();
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown sandbox provider: ${_exhaustive as string}`);
    }
  }
};
