# BUILD_PIPELINE.md — поток сборки в деталях

Описывает шаг за шагом всё, что происходит между «LLM завершил turn»
и «пользователь видит обновлённый preview». Документ для реализатора:
команды, схема монтирования, обработка ошибок, тайм-ауты, очистка.

Контракты и общая архитектура — `CONTRACTS.md` и `ARCHITECTURE.md`.
Здесь — операционные детали.

---

## 1. Сводный поток

```
trigger        ┐
  ┌─ chat onFinish ─────┐
  ├─ POST /rebuild ──── ┼── BuildQueue.enqueue ──┐
  ├─ requestRebuildTool─┘                         │
  └─ migration worker (skipCurrentSwap=true) ─────┤
                                                  ▼
                          ┌─────────────────────────────────────┐
                          │  BuildQueue (ADR-011, ADR-012)      │
                          │  invariant: max 1 running + 1 queued │
                          │  cancel + replace                    │
                          └────────────────┬─────────────────────┘
                                           ▼
                          ┌────────────────────────────────────┐
                          │  previewProvider.build(opts)        │
                          │  Static impl:                       │
                          │    1. allocate buildId, makedir     │
                          │    2. emit "running" SSE event      │
                          │    3. dockerode container.create    │
                          │    4. container.start + waitForStop │
                          │    5. parse stdout/stderr → errors[]│
                          │    6. on success: atomic symlink swap│
                          │    7. emit final SSE event          │
                          │    8. cleanup на cancel/fail        │
                          └────────────────┬───────────────────┘
                                           ▼
                          ┌────────────────────────────────────┐
                          │ Caddy file_server                   │
                          │ /data/static/<id>/current/  ────────┤───→ user iframe
                          └────────────────────────────────────┘
```

---

## 2. Триггеры билда

| Источник                          | Reason            | Capabilities check          |
|-----------------------------------|-------------------|------------------------------|
| `chat/route.ts` `onFinish`        | `turn-finished`   | всегда                       |
| `POST /api/projects/:id/rebuild`  | `manual`          | `manualRebuild === true`     |
| LLM `requestRebuildTool`          | `manual`          | `manualRebuild === true`     |
| `previewProvider.create()` initial| `initial`         | всегда (preheat)             |
| Migration worker (ADR-008)        | `migration`       | platform-team only           |

`chat/route.ts onFinish` enqueue **non-blocking** — не `await`.
Пользователь получает финальный текст LLM немедленно, билд идёт
в фоне.

```ts
// chat/route.ts (псевдокод)
streamText({
  ...,
  onFinish: async ({...}) => {
    // 1. Batch-commit накопленных изменений per turn (ADR-006)
    if (fileChanges.size > 0) {
      await gitProvider.commits.create({
        repoId, branch, files: Array.from(fileChanges.entries()),
        message: "...",
      });
      fileChanges.clear();
    }
    // 2. Non-blocking enqueue (ADR-011)
    void getBuildQueue().enqueue({
      projectId: repoId, reason: "turn-finished",
    });
  },
});
```

---

## 3. BuildQueue lifecycle

### 3.1. Состояния и переходы

```
        enqueue (no running)         start docker
queued ─────────────────────► running ───────► (waiting on container)
   │                              │
   │ enqueue (running existed,    │ container.kill
   │   no queued, was the queued) │
   │ ◄──── cancel + new queued ───┤
   │                              ▼
   │                         cancelled / failed / succeeded
   │
   │ enqueue (running + queued)
   ▼
superseded (старый queued)
```

### 3.2. Алгоритм enqueue (ADR-012)

```ts
enqueue({projectId, reason}):
  const running = registry.getActive(projectId);
  const queued  = registry.getQueued(projectId);
  const newJob  = {jobId: uuid(), projectId, reason, status: "queued", enqueuedAt: now()};

  if (!running && !queued) {
    promote(newJob);  // → running
    return {jobId: newJob.jobId, status: "running"};
  }
  if (running && !queued) {
    cancel(running);  // SIGTERM, allow grace, потом SIGKILL
    registry.setQueued(projectId, newJob);
    emit({...newJob, status: "queued"});
    return {jobId: newJob.jobId, status: "queued"};
  }
  // running + queued — заменяем queued
  emit({...queued, status: "superseded"});
  registry.setQueued(projectId, newJob);
  emit({...newJob, status: "queued"});
  return {jobId: newJob.jobId, status: "queued"};

# В promote/runningJob completion handler:
onJobFinish(job, finalResult):
  emit({...job, status: finalResult.status, result: finalResult});
  registry.clearActive(projectId);
  const next = registry.popQueued(projectId);
  if (next) promote(next);
```

### 3.3. Cancel signal

```ts
cancel(job):
  job.abortController.abort();
  // dockerode container.kill('SIGTERM') если контейнер уже стартовал
  if (job.containerId) {
    docker.getContainer(job.containerId).kill({signal: 'SIGTERM'}).catch(noop);
    setTimeout(() => {
      docker.getContainer(job.containerId).kill({signal: 'SIGKILL'}).catch(noop);
    }, BUILD_CANCEL_GRACE_MS);  // default 2000
  }
```

После выхода контейнера — `partial cleanup` (см. §6.5).

---

## 4. Per-build последовательность (static)

### 4.1. Подготовка (до docker run)

```
1. buildId = `${ISO8601}-${uuid().slice(0,4)}`
   например: 2026-04-27T14-22-08Z-a3f1
   ISO с заменой ":" на "-" — для имени директории.
2. artifactDir = `/data/static/<projectId>/builds/<buildId>/`
3. mkdir -p artifactDir
4. registry.setRunning(projectId, {jobId, buildId, startedAt: now()})
5. emit SSE event: {status: "running", jobId, projectId, at: now()}
6. audit-log: build-started {jobId, projectId, reason}
```

### 4.2. Docker run (через dockerode)

Полная схема (соответствует ADR-005, дополнено ADR-016 / ADR-029):

```ts
docker.createContainer({
  Image: `build-runner-react:${boilerplateVersion}`,
  // ADR-029: vite.config.js relocation в /tmp + NODE_PATH workaround.
  // Vite на каждом билде пишет sibling-файл `vite.config.js.timestamp-*.mjs`
  // в директорию конфига; ReadonlyRootfs=true блокирует этот write
  // (EACCES), и билд падает до вывода артефактов. Решение:
  //   1) копируем доверенный /workspace/vite.config.js в writable tmpfs
  //      /tmp/vite.config.js,
  //   2) запускаем `npx vite build --config /tmp/vite.config.js`,
  //   3) NODE_PATH=/workspace/node_modules даёт Node fallback search
  //      root, чтобы относительный конфиг в /tmp всё ещё находил
  //      `vite`/`@vitejs/plugin-react` в named volume.
  // Конфиг по-прежнему контролируется образом — operator не может
  // подменить (read-only mount of project source).
  Cmd: [
    "sh", "-c",
    "cp /workspace/vite.config.js /tmp/vite.config.js && exec npx vite build --config /tmp/vite.config.js",
  ],
  WorkingDir: "/workspace",
  Tty: false,
  AttachStdout: true,
  AttachStderr: true,
  User: "1000:1000",                              // non-root
  HostConfig: {
    NetworkMode: "adorable_build",                 // изолированная internal-сеть
    AutoRemove: true,                              // --rm
    ReadonlyRootfs: true,                          // --read-only
    Memory: BUILD_RUNNER_MEMORY,                   // default 2 GiB
    NanoCPUs: BUILD_RUNNER_CPUS * 1e9,             // default 2 cores
    PidsLimit: BUILD_RUNNER_PIDS,                  // default 512
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges:true"],
    Tmpfs: { "/tmp": "size=200m" },
    Binds: [
      // Boilerplate node_modules — RO, общий per-version:
      `adorable_node_modules_react_${boilerplateVersion}:/workspace/node_modules:ro`,
      // Project source files — RO:
      `/data/projects/${projectId}/src:/workspace/src:ro`,
      `/data/projects/${projectId}/public:/workspace/public:ro`,
      // Vite cache — RW per-project (ADR-016):
      `/data/projects/${projectId}/.vite:/workspace/.vite:rw`,
      // Output:
      `${artifactDir}:/workspace/dist:rw`,
    ],
    Ulimits: [{ Name: "nofile", Soft: 4096, Hard: 4096 }],
  },
  Env: [
    "NODE_ENV=production",
    `VITE_PROJECT_ID=${projectId}`,                 // прокидываем в env билда
    `VITE_BUILD_ID=${buildId}`,                     // для трассировки
    "NODE_PATH=/workspace/node_modules",            // см. ADR-029
  ],
});
```

> Все boilerplate-fixed файлы (`package.json`, `vite.config.js`,
> `tailwind.config.js`, `postcss.config.js`, `index.html`,
> `jsconfig.json`, `init-volume.sh`) уже лежат **в образе** на
> `/workspace/` (см. Dockerfile build-runner'а). Bind-mounts
> перекрывают только `src/`, `public/`, `node_modules/`, `.vite/`,
> `dist/`. `init-volume.sh` (внутри образа) запускается отдельно с
> `-u 0:0` для первичного заполнения named volume — ADR-005.

### 4.3. Запуск и ожидание

```ts
const container = await docker.createContainer({...});
job.containerId = container.id;

// Stream logs в memory-buffer (с лимитом BUILD_LOG_MAX_BYTES)
const logsStream = await container.logs({stdout: true, stderr: true, follow: true});
const stdoutBuf = new SizeBoundedBuffer(BUILD_LOG_MAX_BYTES);
const stderrBuf = new SizeBoundedBuffer(BUILD_LOG_MAX_BYTES);
container.modem.demuxStream(logsStream, stdoutBuf, stderrBuf);

await container.start();

const waitTimeout = setTimeout(() => {
  // Hard timeout — контейнер всё ещё крутится дольше ожидаемого
  container.kill({signal: 'SIGKILL'}).catch(noop);
}, BUILD_RUNNER_TIMEOUT_MS);  // default 120000 = 2 min

let exitInfo;
try {
  exitInfo = await container.wait();   // ожидание выхода
} finally {
  clearTimeout(waitTimeout);
}
const durationMs = Date.now() - startTime;
```

`SizeBoundedBuffer` — кольцевой буфер с обрезкой по
`BUILD_LOG_MAX_BYTES` (default 16 KB). Ничего не пишется на диск
(stdout/stderr только в памяти и SSE-эвенте).

### 4.4. Parse результата

```ts
const stdout = stdoutBuf.toString();
const stderr = stderrBuf.toString();
const exitCode = exitInfo.StatusCode;

const errors = parseBuildErrors({stdout, stderr, projectId, boilerplateVersion});
const warnings = parseBuildWarnings({stdout, stderr});
```

`parseBuildErrors` (ADR-018) — лежит в `lib/preview/build-error-parser.ts`.
Регэкспы:

```
"Could not resolve \"X\""
  → если X в AVAILABLE_DEPS.deny  → code = "import-not-allowed"
                                    + suggestion из synonyms таблицы
  → иначе                         → code = "module-not-found"

"ERROR: Expected ... but got ..."     → code = "syntax-error"
"ERROR: ... at <file>:<line>:<col>"   → fill file/line/column
"vite plugin error"                   → code = "transform-error"
"failed to load config"               → code = "config-error"
unparsed                              → один {code: "unknown", message: stderr.slice(0, 2000)}
```

### 4.5. Atomic swap (при success)

`status === "succeeded" && !skipCurrentSwap`:

```sh
# В Node-коде через fs.promises.symlink + fs.promises.rename:
ln -sfn builds/<buildId> /data/static/<projectId>/current.tmp
mv -T /data/static/<projectId>/current.tmp /data/static/<projectId>/current

# Аналогично для previous (если current до этого был валидный):
mv -T /data/static/<projectId>/current.previous-tmp /data/static/<projectId>/previous
```

`mv -T` гарантирует атомарность rename'а на POSIX. Реализация в
Node — `fs.rename` (одинаково атомарна).

```ts
async function atomicSwap(projectId, newBuildId) {
  const base = `/data/static/${projectId}`;
  // Запоминаем предыдущий current (если есть)
  let oldCurrentTarget = null;
  try {
    oldCurrentTarget = await fs.readlink(`${base}/current`);
  } catch (e) { /* нет предыдущего — ОК */ }

  // 1. Создаём новый симлинк во временном имени
  await fs.symlink(`builds/${newBuildId}`, `${base}/current.tmp`);
  // 2. Атомарный rename на основное имя
  await fs.rename(`${base}/current.tmp`, `${base}/current`);

  // 3. Обновляем previous
  if (oldCurrentTarget) {
    await fs.symlink(oldCurrentTarget, `${base}/previous.tmp`);
    await fs.rename(`${base}/previous.tmp`, `${base}/previous`);
  }
}
```

### 4.6. Финал — emit SSE event

```ts
const result: BuildResult = {
  status: cancelled ? "cancelled" : (exitCode === 0 ? "succeeded" : "failed"),
  exitCode,
  durationMs,
  artifactPath: result.status === "succeeded" ? artifactDir : undefined,
  wasSwapped: !skipCurrentSwap && result.status === "succeeded",
  errors,
  warnings,
  stdout,
  stderr,
};

emit({jobId, projectId, status: result.status, result, at: now()});
registry.clearActive(projectId);
audit-log: build-finished {jobId, projectId, status, durationMs, exitCode};

// Если есть queued — promote
const next = registry.popQueued(projectId);
if (next) promote(next);
```

### 4.7. Build history GC

После успешного swap:

```ts
const builds = await fs.readdir(`/data/static/${projectId}/builds`);
const sorted = builds.sort().reverse();  // новейшие первыми (ISO сортировка)
const protect = new Set([currentTarget, previousTarget]);  // simlink targets
const toDelete = sorted.slice(BUILD_HISTORY_LIMIT).filter(b => !protect.has(b));
for (const b of toDelete) {
  await fs.rm(`${base}/builds/${b}`, {recursive: true, force: true});
}
```

`BUILD_HISTORY_LIMIT` — env, default 5.

---

## 5. Ошибочные пути

### 5.1. Контейнер упал (exitCode != 0)

- artifactDir остаётся на диске — нужен для `getBuildLogsTool`-tail
  (но `current` не переключается).
- В audit-log: `build-failed {jobId, exitCode, errors[].length}`.
- SSE emit `failed` с полным `BuildResult`.
- artifactDir будет вычищен следующим успешным билдом через
  GC (§4.7), потому что `BUILD_HISTORY_LIMIT` не считает failed
  отдельно — все директории под `builds/`. Можно опционально
  аннотировать имя: `<ts>-failed-<shortHash>` чтобы GC агрессивнее
  убирал failed раньше success'а.

### 5.2. Hard timeout (контейнер не выходит)

- При наступлении `BUILD_RUNNER_TIMEOUT_MS` (default 2 мин) шлём SIGKILL.
- exitCode = 137 (signal 9).
- status → `failed`.
- В `errors[]` добавляем `{code: "unknown", message: "Build timed out after 2 minutes."}`.

### 5.3. Cancel mid-flight

- abortController триггерит SIGTERM → grace period
  `BUILD_CANCEL_GRACE_MS` → SIGKILL.
- exitCode = 143 (SIGTERM) или 137 (SIGKILL).
- status → `cancelled`.
- artifactDir → удаляется (`rm -rf`) сразу после контейнера, даже
  если в нём что-то записалось — частичный билд не валиден.
- audit-log: `build-cancelled {jobId, reason: "superseded" | "destroy"}`.

### 5.4. dockerode исключение (контейнер не создался)

- exitCode = -1 (sentinel).
- artifactDir удаляется.
- status → `failed`.
- В `errors[]` — `{code: "unknown", message: <error.message>}`.
- audit-log с error stacktrace.

### 5.5. Atomic swap упал после успеха

Маловероятно (fs.rename atomic), но защищаем:
- Если `fs.rename(current.tmp → current)` упал → `wasSwapped = false`,
  `status = succeeded` остаётся (артефакт-то готов), но в errors
  добавляется `{code: "unknown", message: "Atomic swap failed: ..."}`.
- UI получает `succeeded` + `wasSwapped: false` → может показать
  баннер «билд готов, но не активирован — попробуйте Rebuild».

### 5.6. Node.js fs.write для scratch dir упал (заполнен диск)

Не относится к билду — относится к `writeFileTool` ранее. Но если
build-runner упал на чтении (например permissions issue из-за гонки
с cleanup-worker'ом), это всплывёт как dockerode или vite ошибка —
обычная failed branch.

---

## 6. Build cache (ADR-009, ADR-016)

`/data/projects/<projectId>/.vite/` — bind-mount RW в `/workspace/.vite/`.
Vite сам управляет содержимым (deps cache, optimizer cache).

Стратегия инвалидации — **не наша**. Vite инвалидирует cache по
`vite.config.js` hash + boilerplate version в `package.json`. Когда
обновляется build-runner image (новая версия boilerplate'а) —
старый cache становится неконсистентным, но Vite это сам обнаружит
и пересоберёт.

В `OPEN_QUESTIONS.md`:
- Размер cache при долгом проекте (>1GB?). Триггер cold-rebuild
  через `rm -rf .vite/` периодически или по storage-quota.
- Метрика hit-rate cache'а (для понимания насколько работает).

---

## 7. Build cancel — полный flow

```
[t=0]  enqueue(B) при running A:
       cancel(A) → A.abortController.abort()
       A.containerId уже есть → docker kill SIGTERM(A)
       setTimeout SIGKILL(A) через BUILD_CANCEL_GRACE_MS

[t=2s] (если SIGTERM проигнорирован) docker kill SIGKILL(A)
       A.exitInfo приходит, status → "cancelled"
       artifactDir(A) → rm -rf
       emit SSE: A → cancelled
       registry.clearActive
       popQueued → B → promote
       B → running
       emit SSE: B → running

[t=5s] B finishes, status → "succeeded"
       atomic swap, emit SSE: B → succeeded
```

`BUILD_CANCEL_GRACE_MS` env, default 2000 мс. В `OPEN_QUESTIONS.md`
вопрос: что если SIGKILL не помог (kernel hung) — двойной kill?
Реалистично: dockerode уже бросит exception, мы пометим `failed`.

---

## 8. SSE event ordering

**Жёсткая гарантия**: SSE-emit событий должен происходить **в том же
async-контексте**, что и переходы в registry. Иначе UI может увидеть
`succeeded` до того как `current` симлинк переключился, и
`iframe.reload()` отдаст старый артефакт.

```ts
// ПРАВИЛЬНО:
await atomicSwap(projectId, buildId);  // 1. сначала swap
emit({status: "succeeded", ...});       // 2. потом event

// НЕПРАВИЛЬНО:
emit({status: "succeeded", ...});       // 1. сначала event
await atomicSwap(projectId, buildId);   // 2. потом swap — race!
```

Это инвариант; нарушать нельзя.

Аналогично для `failed`/`cancelled` — сначала cleanup partial
artifact, потом emit.

---

## 9. Audit log entries

Каждое значимое событие билда пишется в audit-log
(`lib/sandbox/audit-log.ts` уже существует, переиспользуем).

| Event              | Поля                                                   |
|--------------------|--------------------------------------------------------|
| `build-enqueued`   | jobId, projectId, reason, queueDepth, replacedJobId?   |
| `build-started`    | jobId, projectId, buildId, boilerplateVersion          |
| `build-finished`   | jobId, status, exitCode, durationMs, errors.length     |
| `build-cancelled`  | jobId, reason ("superseded" \| "destroy" \| "manual")  |
| `build-swap`       | jobId, oldCurrent?, newCurrent                         |
| `build-gc`         | projectId, deletedBuilds[]                             |

В audit-log одна строка на event, JSON.

---

## 10. Параметры env

Полный список переменных, которые конфигурируют build pipeline.
В `.env.example` добавятся.

| Env                          | Default        | Описание                                    |
|------------------------------|----------------|---------------------------------------------|
| `PREVIEW_PROVIDER`           | `static`       | `static` \| `sandbox` \| `mock`             |
| `BUILD_RUNNER_IMAGE_PREFIX`  | `build-runner-`| Prefix имени образа: `<prefix>react:1.2.3`  |
| `BUILD_RUNNER_MEMORY`        | `2147483648`   | Memory limit байт (2 GiB)                   |
| `BUILD_RUNNER_CPUS`          | `2`            | NanoCPUs / 1e9                              |
| `BUILD_RUNNER_PIDS`          | `512`          | --pids-limit                                |
| `BUILD_RUNNER_TIMEOUT_MS`    | `120000`       | Hard timeout на билд (2 мин)                |
| `BUILD_WAIT_DEADLINE_BUFFER_MS` | `5000`      | Запас на `container.wait()` сверх timeoutMs+2*cancelGraceMs. Если deadline миновал — force-remove контейнера. |
| `BUILD_RUNNER_NETWORK`       | `adorable_build`| Имя isolated docker сети                   |
| `BUILD_CANCEL_GRACE_MS`      | `2000`         | SIGTERM grace до SIGKILL                    |
| `BUILD_LOG_MAX_BYTES`        | `16384`        | Cap на stdout/stderr (16 KB)                |
| `BUILD_HISTORY_LIMIT`        | `5`            | Сколько `builds/<ts>/` хранить              |
| `UPLOAD_MAX_BYTES`           | `5242880`      | UI upload size cap (5 MiB)                  |
| `SCRATCH_DIR_TTL_DAYS`       | `30`           | TTL по inactivity (см. OPEN_QUESTIONS)      |
| `STATIC_DIR_TTL_DAYS`        | `90`           | TTL для готовых артефактов (см. OPEN_Q)     |
| `PROJECTS_ROOT`              | `/data/projects` | Override корня scratch dir                |
| `STATIC_ROOT`                | `/data/static` | Override корня артефактов на хосте          |
| `CADDY_STATIC_ROOT`          | `/data/static` | Container-internal путь, который видит adorable-caddy. См. ADR-031: STATIC_ROOT bind-маунтится в этот путь, и `file_server` route использует именно его. |

---

## 11. Что в спеку **не** входит

- Точные значения `SCRATCH_DIR_TTL_DAYS` и `STATIC_DIR_TTL_DAYS` —
  открытый вопрос (`OPEN_QUESTIONS.md`).
- Метрика hit-rate Vite cache'а (open question).
- Конкретные регэкспы парсера ошибок — это `lib/preview/build-error-parser.ts`,
  с unit-тестами на корпусе примеров. Этот документ декларирует
  только существование парсера и его выход (`BuildError[]`).
- Конкретный Dockerfile для build-runner'а — `BOILERPLATE.md`.
- Конкретный список зависимостей в `templates/vite-react/` —
  `DEPENDENCIES.md`.

---

_Last updated: 2026-04-27. Покрывает ADR-001, ADR-004, ADR-005,
ADR-006, ADR-008, ADR-009, ADR-011, ADR-012, ADR-016, ADR-018._
