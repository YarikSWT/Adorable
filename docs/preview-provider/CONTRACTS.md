# CONTRACTS.md — точные TypeScript-интерфейсы

Этот документ — **исходник правды** для будущей реализации. Каждый
интерфейс сопровождён ссылкой на ADR'ы, в которых он обоснован
(`Source: ADR-XXX`). Реализатор сверяется с этим файлом, не с
ARCHITECTURE.md (там — высокоуровневая картина без деталей сигнатур).

Все типы располагаются в файлах `adorable/lib/adapters/preview*.ts`,
`adorable/lib/preview/*.ts` (singleton, queue, parser), и в
расширении `adorable/lib/repo-types.ts` для `RepoMetadata`.

Стиль: повторяет паттерны существующих адаптеров
(`lib/adapters/sandbox.ts`, `lib/adapters/proxy.ts`,
`lib/adapters/git.ts`) — env-resolved provider name, async factory,
lazy import, mock impl для тестов.

---

## 1. Capabilities

```ts
/**
 * Декларативное описание возможностей превью-режима.
 * Провайдер декларирует своё значение как readonly. При создании
 * проекта значение копируется (pinned) в RepoMetadata.preview.
 *
 * Source: ADR-003 (toolset by capabilities), ADR-010 (system-prompt
 * by capabilities), ADR-015 (hybrid placement).
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
```

---

## 2. PreviewMetadata

```ts
/**
 * То, что PreviewProvider.create() возвращает наружу. Содержит
 * URL'ы и pinned capabilities. UI и LLM ориентируются на этот тип.
 *
 * `terminalUrls` отсутствует в static-режиме (ADR-014).
 *
 * Source: ADR-014 (capability-driven URL формат), ADR-015.
 */
export interface PreviewMetadata {
  /** Идентификатор проекта (= repoId, существующий ID Gitea-репо). */
  projectId: string;

  /** Публичный URL preview'а. Формат: `<projectId>.preview.<base>`. */
  previewUrl: string;

  /**
   * Публичный URL опубликованной версии. Формат: `<projectId>.<base>`.
   * Указывает на `published` симлинк (ADR-025). До первого promote
   * совпадает по содержимому с seed/placeholder.
   */
  publishedUrl: string;

  /** ISO-timestamp последнего promote (если был). */
  publishedAt?: string;

  /**
   * Терминальные URL'ы — только в sandbox-режиме (3-хостная схема,
   * см. lib/adorable-vm.ts). В static-режиме `terminalUrls`
   * отсутствует, UI должен это проверять перед рендером панелей.
   */
  terminalUrls?: {
    devCommand: string;
    additional: string;
  };

  /** Возможности этого превью; копия provider.capabilities на момент create. */
  capabilities: PreviewCapabilities;

  /** ISO-timestamp создания. */
  createdAt: string;
}
```

---

## 3. PreviewCreateOptions

```ts
/**
 * Source: ADR-017 (имя метода create), ADR-006 (scratch dir
 * создаётся внутри), ADR-008 (boilerplateVersion из RepoMetadata).
 */
export interface PreviewCreateOptions {
  /** ID существующего Gitea-репо (= projectId). */
  repoId: string;

  /**
   * Версия boilerplate, на которой проект создаётся. Берётся из
   * templates/vite-react/VERSION в момент create. Хранится в
   * RepoMetadata.boilerplateVersion (ADR-008).
   */
  boilerplateVersion: string;

  /** ActorId для audit-log. */
  userId?: string;
}
```

---

## 4. BuildResult, BuildError, BuildWarning

```ts
/**
 * Результат одного билда. Содержит и raw логи, и структурированный
 * парсинг (best-effort). `getBuildLogsTool` возвращает этот объект
 * LLM'у; UI использует для overlay'а и панели логов.
 *
 * Source: ADR-018 (гибрид structured + raw).
 */
export interface BuildResult {
  /** Финальный статус билда. */
  status: BuildJobStatus;          // см. §6

  /** Exit code контейнера (-1 если cancelled до завершения). */
  exitCode: number;

  /** Длительность билда от start до exit, мс. */
  durationMs: number;

  /**
   * Абсолютный путь к директории артефакта на диске builder'а.
   * Только при `status === "succeeded"`.
   * Формат: `/data/static/<projectId>/builds/<timestamp>-<shortHash>/`.
   */
  artifactPath?: string;

  /**
   * `true`, если по успеху артефакт был атомарно переключён в
   * `current` симлинк. Может быть `false` для билда, инициированного
   * не для активной версии (например для миграции — ADR-008).
   * Source: ADR-004.
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

export type BuildErrorCode =
  | "module-not-found"      // esbuild: Could not resolve "X"
  | "import-not-allowed"    // module-not-found + module не в AVAILABLE_DEPS
  | "syntax-error"          // esbuild syntax / parse errors
  | "transform-error"       // плагин Vite/esbuild упал
  | "config-error"          // проблема в vite.config / postcss.config
  | "unknown";              // не распарсено

export interface BuildError {
  code: BuildErrorCode;
  /** Human-readable сообщение, форматированное для LLM. */
  message: string;
  /** Относительный путь в /workspace/, если ошибка привязана к файлу. */
  file?: string;
  line?: number;
  column?: number;
  /** 3-5 строк контекста, если парсер смог их извлечь. */
  snippet?: string;

  // Поля, специфичные для конкретных code:
  /** Для `module-not-found` / `import-not-allowed`. */
  missingModule?: string;
  /**
   * Для `import-not-allowed`: рекомендация чем заменить (например
   * "Используй встроенный fetch вместо axios"). Источник — таблица
   * synonyms в `lib/preview/available-deps.ts`.
   */
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
```

---

## 5. PreviewProvider — основной интерфейс

```ts
/**
 * Адаптер превью-режима. Две реализации:
 *   - "static"  — vite build в ephemeral контейнере, file_server в Caddy
 *   - "sandbox" — long-running Docker container с dev-server'ом
 *
 * Источник правды для всех бизнес-вызовов превью.
 *
 * Source: ADR-001 (build trigger), ADR-005 (build-runner ephemeral),
 * ADR-006 (scratch dir), ADR-014 (PreviewMetadata формат),
 * ADR-015 (capabilities), ADR-017 (create vs initialize).
 */
export interface PreviewProvider {
  /** "static" | "sandbox". */
  name: PreviewProviderName;

  /** Readonly декларация — pinится в RepoMetadata при создании проекта. */
  readonly capabilities: PreviewCapabilities;

  /**
   * Создать превью-окружение для проекта:
   *   static  — scratch dir + Caddy file_server роут + initial build enqueue
   *   sandbox — Docker container + 3 Caddy reverse_proxy роутов
   *
   * Идемпотентность: повторный вызов с тем же `repoId` НЕ создаёт
   * дубликат — возвращает существующее `PreviewMetadata`. Это
   * полезно при восстановлении после рестарта builder'а.
   */
  create(opts: PreviewCreateOptions): Promise<PreviewMetadata>;

  /**
   * Запросить (асинхронный) билд проекта. Реализация для static —
   * `docker run --rm` build-runner'а. Для sandbox — no-op (HMR сам
   * подхватывает изменения, явный билд не нужен; реализация может
   * вернуть `{status: "succeeded", durationMs: 0, ...}` стаб).
   *
   * Поддерживает отмену через AbortSignal — для cancel + replace
   * семантики из ADR-012.
   *
   * Source: ADR-005, ADR-009, ADR-012.
   */
  build(opts: BuildOptions): Promise<BuildResult>;

  /**
   * Снести превью-окружение. Идемпотентно.
   *   static  — rm -rf /data/projects/<id> + /data/static/<id>,
   *             removeRoute из Caddy
   *   sandbox — sandbox.destroy + removeSandboxRoutes
   *
   * Source: ADR-006, ADR-007 (включает scratch + cache cleanup).
   */
  destroy(projectId: string): Promise<void>;

  /**
   * Сообщить cleanup-worker'у про активность проекта. Обновляет
   * timestamp последнего use; cleanup-worker в TTL-логике использует.
   *
   * Source: ADR-006.
   */
  touch(projectId: string): Promise<void>;

  /**
   * Получить статичные файлы проекта (источник для LLM-tools, билда,
   * UI-tree). Возвращает `null` если проект не существует.
   *
   * Source: ADR-006 (scratch dir как ground truth), ADR-007 (whitelist).
   */
  getProjectFs(projectId: string): Promise<ProjectFs | null>;
}

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
   * (например для пред-валидации в migration worker'е).
   * Source: ADR-008.
   */
  skipCurrentSwap?: boolean;
}
```

---

## 6. BuildJob и статусы

```ts
/**
 * Один job в BuildQueue. Идентифицируется `jobId` (uuid),
 * привязан к projectId. Несколько job'ов на projectId не могут быть
 * одновременно в running (ADR-012).
 *
 * Source: ADR-011 (BuildQueue), ADR-012 (concurrency).
 */
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
```

---

## 7. BuildQueue

```ts
/**
 * In-memory очередь билдов в процессе builder'а. Singleton.
 * Поддерживает инвариант: max 1 running + 1 queued на projectId.
 *
 * Source: ADR-011 (in-memory queue + SSE), ADR-012 (cancel + replace).
 */
export interface BuildQueue {
  /**
   * Поставить билд в очередь. Семантика cancel + replace:
   *   - нет running → новый job становится running, запускается.
   *   - running без queued → cancel running, новый job становится queued.
   *   - running + queued → старый queued получает событие
   *     `superseded`, новый job заменяет его в queued.
   *
   * Возвращает идентификатор поставленного job'а и его статус
   * сразу после enqueue. Для подписки на дальнейшие изменения —
   * subscribe().
   */
  enqueue(opts: {
    projectId: string;
    reason: BuildOptions["reason"];
  }): Promise<{ jobId: string; status: BuildJobStatus }>;

  /**
   * Отменить все job'ы на projectId (running + queued).
   * Используется из previewProvider.destroy().
   */
  cancel(projectId: string): Promise<void>;

  /**
   * Получить текущий running job (если есть).
   * Используется UI / SSE endpoint'ом для initial state.
   */
  getActive(projectId: string): BuildJob | null;

  /** Получить queued job (если есть). */
  getQueued(projectId: string): BuildJob | null;

  /**
   * Подписаться на события для projectId. Listener получает
   * `BuildEvent` при каждом изменении статуса любого job'а
   * этого проекта (включая `superseded` для вытесненного queued).
   *
   * Возвращает unsubscribe функцию.
   *
   * Множественные подписки на один projectId — ОК (UI-instance + LLM tool).
   */
  subscribe(
    projectId: string,
    listener: (event: BuildEvent) => void,
  ): () => void;
}

export interface BuildEvent {
  jobId: string;
  projectId: string;
  status: BuildJobStatus;
  /** Заполняется когда status — финальный. */
  result?: BuildResult;
  /** ISO-timestamp события. */
  at: string;
}
```

---

## 8. ProjectFs

```ts
/**
 * Унифицированный fs-интерфейс над scratch dir (static) или
 * sandbox-fs (Docker tar API). Один и тот же набор методов
 * для обеих реализаций. createTools() использует этот тип
 * как первичный fs-источник.
 *
 * Source: ADR-003 (file-tools без bash), ADR-006 (scratch dir),
 * ADR-007 (whitelist).
 */
export interface ProjectFs {
  /** Read utf-8 text. Throws on missing file. */
  readTextFile(path: string): Promise<string>;

  /**
   * Write utf-8 text. Создаёт директории как нужно.
   * Применяет whitelist (ADR-007) — на запрещённый путь возвращает
   * thrown ProjectFsError с code = "path-not-writable".
   */
  writeTextFile(path: string, content: string): Promise<void>;

  exists(path: string): Promise<boolean>;

  /**
   * Список файлов в директории. Pure-fs, без shell-exec.
   * Source: ADR-003.
   */
  list(opts: {
    path?: string;
    recursive?: boolean;
    /** 1..8, default 3. */
    maxDepth?: number;
  }): Promise<FileEntry[]>;

  /**
   * Поиск текста в файлах. Pure-fs, без grep.
   * Source: ADR-003.
   */
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
  | "path-not-writable"   // whitelist отверг (ADR-007)
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
  }
}
```

---

## 9. Whitelist для writeFileTool

```ts
/**
 * Pure-функция, проверяющая может ли LLM писать в этот путь.
 * Используется ProjectFs.writeTextFile перед записью.
 *
 * Source: ADR-007.
 */
export const isWritablePath = (relPath: string): boolean => {
  // Запрещено всё вне src/, public/, functions/.
  if (!/^(src|public|functions)\//.test(relPath)) return false;
  // Path traversal:
  if (relPath.includes("..")) return false;
  if (relPath.includes("\0")) return false;
  if (relPath.startsWith("/")) return false;

  // src/** — все JS/TS-расширения разрешены (ADR-024).
  // Vite + esbuild сами процессят .ts/.tsx без TS-валидации.
  if (/^src\/.+\.(js|jsx|ts|tsx|css|scss|html|json)$/.test(relPath)) {
    return true;
  }
  // public/** — только разрешённые текстовые расширения
  if (/^public\/.+\.(svg|json|xml|txt|html|webmanifest)$/.test(relPath)) {
    return true;
  }
  // functions/** — TypeScript edge-handler'ы (ADR-021).
  // tsconfig.json в functions/ — фиксированный, LLM не пишет.
  if (/^functions\/.+\.(ts|json)$/.test(relPath) &&
      relPath !== "functions/tsconfig.json") {
    return true;
  }
  // Бинарные расширения в public/, JS в functions/, TS в src/ — запрещено
  return false;
};

/**
 * Хелпер для генерации сообщения ошибки с подсказкой пользователя.
 * Используется ProjectFs.writeTextFile при отклонении.
 */
export const explainNonWritable = (relPath: string): string => {
  if (!relPath.match(/^(src|public|functions)\//)) {
    return `Path "${relPath}" is outside writable directories. Only src/**, public/**, and functions/** are writable.`;
  }
  if (/\.(jpg|jpeg|png|webp|gif|mp4|webm|woff|woff2|ttf|otf|eot)$/.test(relPath)) {
    return `Path "${relPath}" is a binary asset. Binary files must be uploaded by the user via the UI.`;
  }
  if (relPath === "functions/tsconfig.json") {
    return `Path "${relPath}" is a fixed boilerplate file and cannot be edited.`;
  }
  return `Path "${relPath}" is not writable in this project.`;
};
```

---

## 10. Provider name + factory

```ts
/**
 * Стиль повторяет SandboxProvider/ProxyProvider/GitProvider.
 *
 * Source: ARCHITECTURE.md §3.1, паттерн адаптеров.
 */
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
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) return "mock";
  return "static";   // default — главное решение всей сессии
};

/**
 * Async factory — повторяет паттерн createSandboxProvider.
 * Lazy import — чтобы mock-тесты не подтягивали dockerode.
 */
export const createPreviewProvider = async (
  options: { providerOverride?: string } = {},
): Promise<PreviewProvider> => {
  const name = resolvePreviewProviderName(options.providerOverride);
  switch (name) {
    case "mock": {
      const mod = await import("./preview-mock");
      return mod.createMockPreviewProvider();
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
```

---

## 11. ProxyProvider — расширение (file_server)

```ts
/**
 * Существующий ProxyProvider (lib/adapters/proxy.ts) расширяется:
 * вместо `upstream: string` теперь дискриминированный `target`.
 * Это breaking change для внутреннего API; миграция — в MIGRATION_PATH.md.
 *
 * Source: ADR-004 (file_server для static), ARCHITECTURE.md §3.3.
 */
export interface ProxyRouteSpec {
  id: string;
  hostname: string;

  /** Что Caddy раздаёт по этому хосту. */
  target: ProxyRouteTarget;

  /** Опциональная привязка к sandbox для cascade-cleanup. */
  sandboxId?: string;

  labels?: Record<string, string>;
}

export type ProxyRouteTarget =
  | {
      /** Reverse-proxy на upstream:port. Текущая реализация для sandbox. */
      type: "upstream";
      address: string;     // "10.0.0.5:3000" / "sandbox-name:5173"
      healthCheck?: {
        path?: string;
        intervalSec?: number;
        timeoutSec?: number;
        expectStatusMin?: number;
        expectStatusMax?: number;
      };
    }
  | {
      /** file_server из директории. Используется static-режимом. */
      type: "static";
      /**
       * Абсолютный путь, который Caddy раздаёт. ОБЯЗАТЕЛЬНО стабильный
       * (например /data/static/<id>/current/) — atomic swap происходит
       * через симлинк, Caddy об этом не знает (ADR-004).
       */
      rootDir: string;
      /**
       * Default ["{path}", "{path}/", "/index.html"] — SPA fallback
       * для react-router-dom.
       */
      tryFiles?: string[];
    };

export interface ProxyRouteInfo {
  id: string;
  hostname: string;
  target: ProxyRouteTarget;
  sandboxId?: string;
}

// ProxyProvider методы — те же что были (addRoute, removeRoute, ...).
// Сигнатуры не меняются, меняется только тип ProxyRouteSpec.target.
```

---

## 12. RepoMetadata — расширение

```ts
/**
 * Существующий RepoMetadata (lib/repo-types.ts) расширяется
 * двумя полями: `boilerplateVersion` (ADR-008) и `preview` (ADR-015).
 *
 * Эти поля **обязательны** для свежесозданных проектов; для существующих
 * (созданных до миграции) — заполняются миграционным воркером
 * при первом обращении (см. MIGRATION_PATH.md).
 */
export interface RepoMetadata {
  // ... (существующие поля repoId, name, deployments, ...)

  /**
   * Семантическая версия boilerplate'а на момент последнего успешного
   * билда. Формат "1.2.3" из templates/vite-react/VERSION.
   * Source: ADR-008.
   */
  boilerplateVersion: string;

  /**
   * Pinned состояние превью-провайдера на момент создания проекта.
   * Source: ADR-015.
   */
  preview: {
    /** "static" | "sandbox" — какой провайдер был активен. */
    provider: PreviewProviderName;
    /** Pinned копия provider.capabilities. */
    capabilities: PreviewCapabilities;
    /** ISO-timestamp создания превью-окружения. */
    createdAt: string;
    /**
     * Migration status (для случая когда global env сменился, но
     * проект ещё на старом провайдере). Default "ok".
     * Возможные: "ok" | "needs-review" | "migrating".
     * Source: ADR-008 + ADR-015.
     */
    migrationStatus?: "ok" | "needs-review" | "migrating";
    /** ISO-timestamp последнего promote через POST /repos/<id>/promote. */
    publishedAt?: string;
    /** buildId на который указывает `published` симлинк. */
    publishedBuildId?: string;
  };
}
```

---

## 13. createTools — обновлённая сигнатура

```ts
/**
 * Generates LLM tool set in зависимости от capabilities. В static-
 * режиме часть tools отсутствует, system-prompt ветвится отдельно.
 *
 * Source: ADR-003 (toolset by capabilities), ADR-018 (getBuildLogs).
 */
export interface CreateToolsOptions {
  fs: ProjectFs;
  /** Только если capabilities.shellAccess. */
  exec?: ProjectExec;
  capabilities: PreviewCapabilities;

  /** Существующие callbacks для batch-commit. */
  onFileChange?: (path: string, content: string) => void;
  onFileDelete?: (path: string) => void;

  /** Для getBuildLogsTool и requestRebuildTool. */
  buildQueue?: BuildQueue;
  projectId: string;

  /** Метаданные для commit-tool / deployment tracking. */
  sourceRepoId?: string;
  metadataRepoId?: string;
}

export interface ProjectExec {
  exec(opts: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    command: string;
    timedOut?: boolean;
  }>;
  devServer: {
    getLogs(): Promise<string | string[]>;
  };
}

/**
 * Возвращает объект с tools, ключи которого зависят от capabilities.
 * UI / chat/route.ts должны использовать всё что вернётся, не делать
 * предположений о наличии конкретных tools.
 */
export const createTools = (opts: CreateToolsOptions) => {
  const tools: Record<string, unknown> = {};

  // Всегда:
  tools.readFileTool = ...;        // через opts.fs.readTextFile
  tools.writeFileTool = ...;       // через opts.fs.writeTextFile + onFileChange
  tools.replaceInFileTool = ...;   // pure-fs
  tools.appendToFileTool = ...;    // pure-fs
  tools.listFilesTool = ...;       // через opts.fs.list — pure-fs (ADR-003)
  tools.searchFilesTool = ...;     // через opts.fs.search — pure-fs (ADR-003)
  tools.makeDirectoryTool = ...;   // через opts.fs.mkdir — pure-fs
  tools.movePathTool = ...;        // через opts.fs.rename — pure-fs
  tools.deletePathTool = ...;      // через opts.fs.remove — pure-fs
  tools.commitTool = ...;          // server-side через gitProvider, не git push

  if (opts.capabilities.manualRebuild && opts.buildQueue) {
    tools.requestRebuildTool = ...;  // ADR-001 — только по запросу пользователя
    tools.getBuildLogsTool = ...;    // ADR-018 — возвращает BuildResult последнего job'а
  }

  if (opts.capabilities.shellAccess && opts.exec) {
    tools.bashTool = ...;            // через opts.exec.exec
    tools.checkAppTool = ...;        // sandbox-only
    tools.devServerLogsTool = ...;   // через opts.exec.devServer.getLogs
  }

  return tools;
};
```

---

## 14. system-prompt — branched

```ts
/**
 * Source: ADR-003 + ADR-010 (ARCHITECTURE CONSTRAINT блок только в static).
 *
 * Существующий exported SYSTEM_PROMPT превращается в функцию.
 */
export const getSystemPrompt = (
  capabilities: PreviewCapabilities,
): string => {
  if (capabilities.shellAccess) {
    return SANDBOX_SYSTEM_PROMPT;     // существующий, с поправками
  }
  return STATIC_SYSTEM_PROMPT;        // новый, с ARCHITECTURE CONSTRAINT блоком
};

const STATIC_SYSTEM_PROMPT = `
You are Adorable, an AI app builder. The project is a Vite + React + Tailwind
static SPA. You write source files only — the toolchain handles everything else.

ARCHITECTURE CONSTRAINT
This project runs as a static SPA built with Vite. Available technologies:
- React 18 with hooks
- React Router DOM 6 for routing
- Tailwind CSS 3 for styling
- lucide-react for icons
- (см. AVAILABLE_DEPS.md для полного списка)

NOT AVAILABLE:
- Server-side rendering, API routes, server actions
- Real backend (no Express, Fastify, no databases)
- Native modules requiring node-gyp
- Custom npm packages outside the listed dependencies

For data persistence, use localStorage or sessionStorage.
For external APIs, use fetch directly from the browser (CORS-permitting).
For backend functionality, the user must connect to our managed BaaS.
Don't generate server code yourself — it won't run.

WORKFLOW
You write files in src/** and public/** only. No npm install, no shell.
After your turn ends, the project rebuilds automatically. To force a rebuild
(only if user explicitly asks), call requestRebuildTool. To inspect last
build's errors, call getBuildLogsTool — it returns structured BuildError[].

(дальше — file-tools usage, communication style, как в текущем
SYSTEM_PROMPT, минус npm/dev-server/curl упоминания.)
`;

const SANDBOX_SYSTEM_PROMPT = `
(существующий SYSTEM_PROMPT с минимальными правками — упоминание
'cd ${WORKDIR} && npm install && npm run dev' и npm install <pkg>
оставляется как есть)
`;
```

---

## 15. SSE endpoint contract

```
GET /api/projects/:projectId/build-status
Accept: text/event-stream

Response: SSE stream

event: status
data: {"jobId":"...", "projectId":"...", "status":"queued", "at":"..."}

event: status
data: {"jobId":"...", "projectId":"...", "status":"running", "at":"..."}

event: status
data: {"jobId":"...", "projectId":"...", "status":"succeeded", "at":"...",
       "result": {...BuildResult...}}

# Сервер шлёт keep-alive каждые 30с:
:keep-alive

# Клиент отписывается через abort fetch'а.
```

`BuildEvent` (см. §7) сериализуется как JSON в `data:` поле.

При reconnect (после рестарта builder'а) клиент получает текущее
состояние (running/queued, если есть) одним event'ом немедленно после
подписки. Если нет активного job'а — никаких events до следующего
enqueue.

Source: ADR-011, ADR-012.

---

## 16. Upload endpoint contract

```
POST /api/projects/:projectId/upload
Content-Type: multipart/form-data

Form field: "file" — один файл.

Server validation (ADR-007):
1. Размер ≤ UPLOAD_MAX_BYTES (default 5 * 1024 * 1024)
2. Расширение в whitelist:
   .jpg, .jpeg, .png, .webp, .gif, .svg, .mp4, .webm,
   .woff, .woff2, .ttf
3. Magic-bytes соответствуют расширению (через file-type или
   аналог). Mismatch → 400.
4. Имя санитизируется: lower-case, не-латиница → транслит,
   спецсимволы → "-", запрещены ".." и ведущие "/".

On success:
- File saved to /data/projects/<projectId>/public/<safeName>
- (опционально) chat event emitted via существующий мессадж-stream

Response 200:
{
  "path": "/photo.jpg",          // путь, по которому LLM будет ссылаться
  "size": 524288,
  "mime": "image/jpeg"
}

Response 400 — validation failed:
{ "error": "size-exceeded" | "ext-not-allowed" | "magic-bytes-mismatch" | "invalid-name", "details": "..." }
```

Source: ADR-007.

---

## 17. Manual rebuild endpoint

```
POST /api/projects/:projectId/rebuild
Content-Type: application/json
Body: {} (пусто)

Response 200:
{
  "jobId": "uuid",
  "status": "queued" | "running"
}
```

Server side: проверяет `repoMetadata.preview.capabilities.manualRebuild`,
если false → 403. Иначе `buildQueue.enqueue({projectId, reason: "manual"})`.

UI делает client-side debounce ~500мс перед вызовом (ADR-012).

LLM имеет аналогичный `requestRebuildTool` — внутри вызывает то же
самое.

Source: ADR-001, ADR-012.

---

## 18. Singleton API

```ts
/**
 * adorable/lib/preview/provider-singleton.ts
 *
 * HMR-safe singleton. Паттерн идентичен
 * lib/sandbox/provider-singleton.ts и lib/proxy/provider-singleton.ts.
 *
 * Source: ARCHITECTURE.md §3.1.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ADORABLE_PREVIEW_PROVIDER__: PreviewProvider | undefined;
  // eslint-disable-next-line no-var
  var __ADORABLE_BUILD_QUEUE__: BuildQueue | undefined;
}

export const getPreviewProvider = async (): Promise<PreviewProvider> => {
  if (!globalThis.__ADORABLE_PREVIEW_PROVIDER__) {
    globalThis.__ADORABLE_PREVIEW_PROVIDER__ = await createPreviewProvider();
  }
  return globalThis.__ADORABLE_PREVIEW_PROVIDER__;
};

export const getBuildQueue = (): BuildQueue => {
  if (!globalThis.__ADORABLE_BUILD_QUEUE__) {
    globalThis.__ADORABLE_BUILD_QUEUE__ = createInMemoryBuildQueue();
  }
  return globalThis.__ADORABLE_BUILD_QUEUE__;
};
```

---

## 19. Резюме новых файлов

| Файл                                            | Содержимое                                  |
|-------------------------------------------------|---------------------------------------------|
| `lib/adapters/preview.ts`                       | `PreviewProvider`, `PreviewMetadata`, capabilities, factory |
| `lib/adapters/preview-static.ts`                | static impl                                 |
| `lib/adapters/preview-sandbox.ts`               | wrapper над SandboxProvider                 |
| `lib/adapters/preview-mock.ts`                  | mock для тестов                             |
| `lib/preview/provider-singleton.ts`             | HMR-safe singleton'ы                        |
| `lib/preview/build-queue.ts`                    | in-memory очередь                           |
| `lib/preview/build-error-parser.ts`             | парсер esbuild/vite errors → BuildError     |
| `lib/preview/available-deps.ts`                 | таблица AVAILABLE_DEPS + synonyms suggestions |
| `lib/preview/project-fs.ts`                     | `ProjectFs` impl over node fs (для static)  |
| `app/api/projects/[id]/build-status/route.ts`   | SSE endpoint                                |
| `app/api/projects/[id]/upload/route.ts`         | UI upload endpoint                          |
| `app/api/projects/[id]/rebuild/route.ts`        | Manual rebuild endpoint                     |
| `docker/build-runner-react/Dockerfile`          | Образ build-runner'а                        |
| `docker/build-runner-react/init-volume.sh`      | заполнение named volume через cp -a         |
| `templates/vite-react/VERSION`                  | семантическая версия boilerplate'а          |
| `templates/vite-react/AVAILABLE_DEPS.md`        | сгенерированный список для system-prompt    |

Изменяются:
| Файл                                            | Что меняется                                |
|-------------------------------------------------|---------------------------------------------|
| `lib/adapters/proxy.ts`                         | `target` дискриминированный union           |
| `lib/adapters/proxy-caddy.ts`                   | поддержка file_server                       |
| `lib/adapters/proxy-mock.ts`                    | поддержка file_server                       |
| `lib/repo-types.ts`                             | `boilerplateVersion`, `preview` поля        |
| `lib/system-prompt.ts`                          | `getSystemPrompt(capabilities)` функция     |
| `lib/create-tools.ts`                           | новая `CreateToolsOptions` сигнатура        |
| `lib/template-seeder.ts`                        | убираются `seedSandboxFromTemplate` / `seedSandboxFromSourceRepo` (нужны только для sandbox-режима, перенести туда) |
| `lib/adorable-vm.ts`                            | переименовать в `preview-sandbox.ts` или ассимилировать |
| `app/api/repos/route.ts`                        | использовать `getPreviewProvider().create()` |
| `app/api/chat/route.ts`                         | `onFinish` → `getBuildQueue().enqueue()` non-blocking |
| `docker-compose.yml`                            | named volume `adorable_node_modules_react_<v>` |

---

_Last updated: 2026-04-27. Раунд 5 — все ключевые контракты зафиксированы.
Остаётся: BOILERPLATE / DEPENDENCIES / BUILD_PIPELINE / SECURITY /
MIGRATION_PATH / VERIFICATION / LIMITATIONS / OPEN_QUESTIONS._
