// PreviewProvider — адаптер превью-режима для проектов.
//
// Две производственные реализации:
//   - "static"  — vite build в ephemeral docker-runner'е, Caddy file_server.
//   - "sandbox" — long-running Docker container с dev-server'ом (текущая
//                 реализация через lib/adorable-vm.ts + sandbox-docker).
//
// Контракт зафиксирован в docs/preview-provider/CONTRACTS.md §1–10.
// Этот файл — exported types + factory; реализации лежат в
// preview-static.ts / preview-sandbox.ts / preview-mock.ts (lazy-import'ятся).
//
// Стиль повторяет SandboxProvider (lib/adapters/sandbox.ts):
//   - env-resolved provider name (PREVIEW_PROVIDER)
//   - async factory с lazy import
//   - mock variant для unit-тестов

// ===========================================================================
// §1. Capabilities
// ===========================================================================

/**
 * Декларативное описание возможностей превью-режима.
 * Pinit'ся в RepoMetadata.preview.capabilities при создании проекта,
 * чтобы capabilities новых сред не «утекали» в существующие репо
 * после смены global env (ADR-015).
 */
export interface PreviewCapabilities {
  /** LLM может выполнять shell-команды через bashTool. */
  shellAccess: boolean;
  /** Поддержка кастомных npm-зависимостей сверх boilerplate. */
  customDependencies: boolean;
  /** Поддержка серверного рантайма (API routes / server actions). */
  serverRuntime: boolean;
  /** Поддержка живого HMR без full rebuild. */
  hotReload: boolean;
  /** Manual rebuild по запросу пользователя/LLM. */
  manualRebuild: boolean;
}

export const STATIC_CAPABILITIES: PreviewCapabilities = {
  shellAccess: false,
  customDependencies: false,
  serverRuntime: false,
  hotReload: false,
  manualRebuild: true,
};

export const SANDBOX_CAPABILITIES: PreviewCapabilities = {
  shellAccess: true,
  customDependencies: true,
  serverRuntime: true,
  hotReload: true,
  manualRebuild: true,
};

// ===========================================================================
// §2. PreviewMetadata
// ===========================================================================

/**
 * То, что PreviewProvider.create() возвращает наружу.
 * UI и LLM ориентируются на этот тип. `terminalUrls` — только в sandbox-режиме.
 */
export interface PreviewMetadata {
  /** Идентификатор проекта (= repoId, существующий ID Gitea-репо). */
  projectId: string;
  /** Публичный URL preview'а (`<projectId>.preview.<base>`). */
  previewUrl: string;
  /**
   * Публичный URL опубликованной версии (`<projectId>.<base>`).
   * Указывает на `published` симлинк (ADR-025).
   */
  publishedUrl: string;
  /** ISO-timestamp последнего promote (если был). */
  publishedAt?: string;
  /**
   * Терминальные URL'ы — только в sandbox-режиме (3-хостная схема,
   * см. lib/adorable-vm.ts). UI должен проверять перед рендером.
   */
  terminalUrls?: {
    devCommand: string;
    additional: string;
  };
  /** Pinned копия provider.capabilities на момент create. */
  capabilities: PreviewCapabilities;
  /** ISO-timestamp создания. */
  createdAt: string;
}

// ===========================================================================
// §3. PreviewCreateOptions
// ===========================================================================

export interface PreviewCreateOptions {
  /** ID существующего Gitea-репо (= projectId). */
  repoId: string;
  /**
   * Версия boilerplate, на которой проект создаётся. Берётся из
   * templates/vite-react/VERSION в момент create. Pinit'ся в
   * RepoMetadata.boilerplateVersion (ADR-008).
   */
  boilerplateVersion: string;
  /** ActorId для audit-log. */
  userId?: string;
}

// ===========================================================================
// §4. BuildResult, BuildError, BuildWarning
// ===========================================================================

export type BuildErrorCode =
  | "module-not-found" // esbuild: Could not resolve "X"
  | "import-not-allowed" // module не в AVAILABLE_DEPS
  | "syntax-error"
  | "transform-error" // Vite/esbuild plugin failure
  | "config-error" // vite.config / postcss.config issue
  | "unknown";

export interface BuildError {
  code: BuildErrorCode;
  /** Human-readable message форматированный для LLM. */
  message: string;
  /** Относительный путь в /workspace/, если ошибка привязана к файлу. */
  file?: string;
  line?: number;
  column?: number;
  /** 3-5 строк контекста, если парсер смог их извлечь. */
  snippet?: string;
  /** Для module-not-found / import-not-allowed. */
  missingModule?: string;
  /** Для import-not-allowed: рекомендация замены (synonyms таблица). */
  suggestion?: string;
  /** Оригинальная строка из stderr, для отладки. */
  raw?: string;
}

export interface BuildWarning {
  /** В отличие от errors, warnings не имеют дискриминированного code. */
  message: string;
  file?: string;
  line?: number;
  raw?: string;
}

export interface BuildResult {
  /** Финальный статус билда. */
  status: BuildJobStatus;
  /** Exit code контейнера (-1 если cancelled до завершения). */
  exitCode: number;
  /** Длительность билда от start до exit, мс. */
  durationMs: number;
  /**
   * Абсолютный путь к директории артефакта. Только при `status === "succeeded"`.
   * Формат: `/data/static/<projectId>/builds/<timestamp>-<shortHash>/`.
   */
  artifactPath?: string;
  /**
   * `true`, если по успеху артефакт был атомарно переключён в `current`.
   * `false` для билдов с `skipCurrentSwap` (миграция и т.п.).
   */
  wasSwapped: boolean;
  /** Распарсенные ошибки. Пустой массив при `succeeded`. */
  errors: BuildError[];
  /** Распарсенные предупреждения. */
  warnings: BuildWarning[];
  /** Сырой stdout, обрезанный по `BUILD_LOG_MAX_BYTES` (default 16 KB). */
  stdout: string;
  /** Сырой stderr, обрезанный по `BUILD_LOG_MAX_BYTES`. */
  stderr: string;
}

// ===========================================================================
// §5. PreviewProvider — основной интерфейс
// ===========================================================================

export interface BuildOptions {
  projectId: string;
  /**
   * Причина билда — попадает в audit-log, не влияет на семантику
   * (кроме случая `manualRebuild = false` в capabilities — тогда
   * BuildQueue игнорирует enqueue с reason ≠ "turn-finished").
   */
  reason: "turn-finished" | "manual" | "initial" | "migration";
  /** Сигнал отмены — пробрасывается в dockerode container.kill(). */
  signal?: AbortSignal;
  /** Опциональный override timestamp директории `builds/<ts>/`. */
  buildId?: string;
  /**
   * При `false` (default) после успеха симлинк `current` обновляется.
   * При `true` — артефакт пишется, но `current` не трогается
   * (например для пред-валидации в migration worker'е). Source: ADR-008.
   */
  skipCurrentSwap?: boolean;
}

export interface PreviewProvider {
  name: PreviewProviderName;
  /** Readonly декларация — pinit'ся в RepoMetadata при создании проекта. */
  readonly capabilities: PreviewCapabilities;

  /**
   * Создать превью-окружение для проекта.
   * Идемпотентность: повторный вызов с тем же `repoId` НЕ создаёт
   * дубликат — возвращает существующее `PreviewMetadata`.
   */
  create(opts: PreviewCreateOptions): Promise<PreviewMetadata>;

  /**
   * Запросить (асинхронный) билд проекта.
   * Static — `docker run --rm` build-runner'а.
   * Sandbox — no-op (HMR подхватывает); реализация может вернуть стаб
   * `{status: "succeeded", durationMs: 0, ...}`.
   */
  build(opts: BuildOptions): Promise<BuildResult>;

  /** Снести превью-окружение. Идемпотентно. */
  destroy(projectId: string): Promise<void>;

  /** Сообщить cleanup-worker'у об активности проекта. */
  touch(projectId: string): Promise<void>;

  /**
   * Получить статичные файлы проекта (источник для LLM-tools, билда, UI-tree).
   * Возвращает `null` если проект не существует.
   */
  getProjectFs(projectId: string): Promise<ProjectFs | null>;
}

// ===========================================================================
// §6. BuildJob и статусы
// ===========================================================================

export type BuildJobStatus =
  /** В очереди, ещё не запущен. */
  | "queued"
  /** Запущен, контейнер билдит. */
  | "running"
  /** Финальный успех. */
  | "succeeded"
  /** Финальный провал (exitCode != 0 без cancel). */
  | "failed"
  /** Получил cancel-сигнал, контейнер убит. */
  | "cancelled"
  /** Был queued, но новый enqueue вытеснил его до старта. */
  | "superseded";

/** Финальные статусы — после них job неизменен, события не приходят. */
export type FinalBuildJobStatus = Exclude<BuildJobStatus, "queued" | "running">;

export interface BuildJob {
  jobId: string;
  projectId: string;
  reason: BuildOptions["reason"];
  status: BuildJobStatus;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Заполняется когда status переходит в финальный. */
  result?: BuildResult;
}

// ===========================================================================
// §7. BuildQueue
// ===========================================================================

export interface BuildEvent {
  jobId: string;
  projectId: string;
  status: BuildJobStatus;
  /** Заполняется когда status — финальный. */
  result?: BuildResult;
  /** ISO-timestamp события. */
  at: string;
}

export interface BuildQueue {
  /**
   * Поставить билд в очередь. Семантика cancel + replace:
   *   - нет running → новый job становится running, запускается.
   *   - running без queued → cancel running, новый job становится queued.
   *   - running + queued → старый queued получает `superseded`,
   *     новый job заменяет его в queued.
   */
  enqueue(opts: {
    projectId: string;
    reason: BuildOptions["reason"];
  }): Promise<{ jobId: string; status: BuildJobStatus }>;

  /** Отменить все job'ы на projectId (running + queued). */
  cancel(projectId: string): Promise<void>;

  /** Текущий running job (если есть). */
  getActive(projectId: string): BuildJob | null;

  /** Queued job (если есть). */
  getQueued(projectId: string): BuildJob | null;

  /**
   * Подписаться на события для projectId. Возвращает unsubscribe.
   * Множественные подписки на один projectId — ОК.
   */
  subscribe(
    projectId: string,
    listener: (event: BuildEvent) => void,
  ): () => void;
}

// ===========================================================================
// §8. ProjectFs
// ===========================================================================

export interface FileEntry {
  /** Path relative to /workspace/ (или scratch dir). */
  path: string;
  type: "file" | "directory";
  /** Размер байт (только для файлов). */
  size?: number;
}

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export type ProjectFsErrorCode =
  | "path-not-writable" // whitelist отверг (ADR-007)
  | "not-found"
  | "invalid-path"
  | "io";

export class ProjectFsError extends Error {
  constructor(
    public readonly code: ProjectFsErrorCode,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "ProjectFsError";
  }
}

/**
 * Унифицированный fs-интерфейс над scratch dir (static) или sandbox-fs
 * (Docker tar API). createTools() использует этот тип как первичный
 * fs-источник. Source: ADR-003 (file-tools без bash), ADR-006 (scratch
 * dir), ADR-007 (whitelist).
 */
export interface ProjectFs {
  /** Read utf-8 text. Throws on missing file. */
  readTextFile(path: string): Promise<string>;

  /**
   * Write utf-8 text. Создаёт директории как нужно.
   * Применяет whitelist (ADR-007) — на запрещённый путь throws
   * `ProjectFsError(code = "path-not-writable")`.
   */
  writeTextFile(path: string, content: string): Promise<void>;

  exists(path: string): Promise<boolean>;

  /** Список файлов в директории. Pure-fs, без shell-exec. */
  list(opts: {
    path?: string;
    recursive?: boolean;
    /** 1..8, default 3. */
    maxDepth?: number;
  }): Promise<FileEntry[]>;

  /** Поиск текста в файлах. Pure-fs, без grep. */
  search(opts: {
    query: string;
    path?: string;
    /** 1..500, default 100. */
    maxResults?: number;
  }): Promise<SearchResult[]>;

  /** Удалить файл/директорию. Идемпотентно. */
  remove(path: string): Promise<void>;

  /** Переименовать/переместить. */
  rename(from: string, to: string): Promise<void>;

  /** Создать директорию (рекурсивно — `mkdir -p`). */
  mkdir(path: string): Promise<void>;
}

// ===========================================================================
// §10. Provider name + factory
// ===========================================================================

export type PreviewProviderName = "static" | "sandbox" | "mock";

const normalizeProviderName = (
  raw?: string | null,
): PreviewProviderName | null => {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "static") return "static";
  if (v === "sandbox" || v === "docker") return "sandbox";
  if (v === "mock" || v === "test" || v === "fake") return "mock";
  return null;
};

export const resolvePreviewProviderName = (
  override?: string,
): PreviewProviderName => {
  const explicit =
    normalizeProviderName(override) ??
    normalizeProviderName(process.env["PREVIEW_PROVIDER"]);
  if (explicit) return explicit;
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) {
    return "mock";
  }
  // Default stays "sandbox" until Phase 6 acceptance switches it to
  // "static" (MIGRATION_PATH.md §6). Operators who want static must
  // set PREVIEW_PROVIDER=static explicitly. The .env.example file
  // documents this default; the hardcode here is the safety net so
  // that a missing env var does not silently flip behavior.
  return "sandbox";
};

/**
 * If env says PREVIEW_PROVIDER=sandbox|docker but vitest forces "mock",
 * the mock should simulate sandbox semantics (shellAccess=true, hotReload).
 * Otherwise the mock simulates static semantics. This lets the existing
 * sandbox-flow tests (landing-flow-e2e) keep working with the mock by
 * simply setting `PREVIEW_PROVIDER=sandbox` in their setup.
 */
const mockCapabilitiesFromEnv = (): PreviewCapabilities | undefined => {
  const envName = (process.env["PREVIEW_PROVIDER"] ?? "").toLowerCase().trim();
  if (envName === "sandbox" || envName === "docker") return SANDBOX_CAPABILITIES;
  if (envName === "static") return STATIC_CAPABILITIES;
  return undefined; // fall through to mock's STATIC default
};

/**
 * Async factory — повторяет паттерн createSandboxProvider.
 * Lazy import — чтобы mock-тесты не подтягивали dockerode/caddy.
 */
export const createPreviewProvider = async (
  options: { providerOverride?: string } = {},
): Promise<PreviewProvider> => {
  const name = resolvePreviewProviderName(options.providerOverride);
  switch (name) {
    case "mock": {
      const mod = await import("./preview-mock");
      const envCaps = mockCapabilitiesFromEnv();
      return mod.createMockPreviewProvider(
        envCaps ? { capabilities: envCaps } : {},
      );
    }
    case "static": {
      const mod = await import("./preview-static");
      return mod.createStaticPreviewProvider();
    }
    case "sandbox": {
      const mod = await import("./preview-sandbox");
      return mod.createSandboxPreviewProvider();
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown preview provider: ${_exhaustive as string}`);
    }
  }
};
