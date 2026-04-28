# ARCHITECTURE.md — общая картина

Документ описывает целевую архитектуру **PreviewProvider** в форке
Adorable. Он не описывает существующий sandbox-only код (это
`CURRENT_STATE.md`); он описывает то, к чему мы переезжаем, и
показывает как новые компоненты ложатся поверх существующих
(GitProvider, ProxyProvider, audit-log, singleton-паттерн).

Все решения, на которых строится эта архитектура, зафиксированы в
`DECISIONS.md` (ADR-001 … ADR-016). Здесь — собственно картина:
компоненты, потоки, границы, trade-offs.

---

## 1. Высокоуровневая картина

```
┌──────────────────────────────────────────────────────────────────────┐
│                              UI (browser)                             │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌─────────────────┐    │
│  │  Chat    │  │ FileTree │  │ AssetUpload│  │ PreviewIframe   │    │
│  │  panel   │  │ (R/O)    │  │ (binary)   │  │ + status overlay│    │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘  └────────┬────────┘    │
└───────┼──────────────┼──────────────┼─────────────────┼─────────────┘
        │ POST /chat   │ GET ...      │ POST /upload    │ <iframe src=
        │ (streaming)  │              │ (multipart)     │  https://<id>.
        │              │              │                 │  preview.<base>>
        │              │              │                 │ + SSE on
        │              │              │                 │  /build-status
        │              │              │                 │
┌───────▼──────────────▼──────────────▼─────────────────▼─────────────┐
│                    Builder (single Next.js process)                   │
│                                                                       │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────┐  │
│  │  app/api/chat   │    │ app/api/projects │    │ app/api/repos  │  │
│  │  (LLM stream)   │    │  /[id]/upload    │    │  (create/list) │  │
│  │                 │    │  /[id]/build-    │    │                │  │
│  │                 │    │   status (SSE)   │    │                │  │
│  └────────┬────────┘    └────────┬─────────┘    └────────┬───────┘  │
│           │                      │                       │          │
│  ┌────────▼──────────────────────▼───────────────────────▼───────┐  │
│  │                  Singletons (HMR-safe)                         │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────┐│  │
│  │  │  LLM   │  │  Git   │  │ Proxy  │  │Preview │  │BuildQueue││  │
│  │  │Provider│  │Provider│  │Provider│  │Provider│  │          ││  │
│  │  │        │  │ (Gitea)│  │ (Caddy)│  │static/ │  │in-memory ││  │
│  │  │        │  │        │  │        │  │sandbox │  │          ││  │
│  │  └────────┘  └────┬───┘  └────┬───┘  └────┬───┘  └────┬─────┘│  │
│  └──────────────────┼──────────┼──────────┼──────────────┼──────┘  │
│                     │          │          │              │         │
└─────────────────────┼──────────┼──────────┼──────────────┼─────────┘
                      │          │          │              │
                      ▼          ▼          ▼              ▼
                ┌─────────┐  ┌──────┐  ┌────────────┐  ┌──────────┐
                │  Gitea  │  │Caddy │  │ /data fs   │  │  Docker  │
                │  (REST) │  │(Admin│  │ projects/  │  │  daemon  │
                │         │  │ API +│  │ static/    │  │          │
                │         │  │ HTTP)│  │ named vols │  │          │
                └─────────┘  └──────┘  └────────────┘  └──────────┘
                              ▲                            │
                              │ file_server                │ run --rm
                              │                            │ build-runner
                              ▼                            │ container
                       static dist/ via                    │
                       /data/static/<id>/current/<─────────┘
                                                    writes builds/<ts>/
```

### Что существенно изменилось от sandbox-only

1. **Появился `PreviewProvider`** — выше `SandboxProvider`. Sandbox
   становится одной из **двух** реализаций превью (другая —
   `static`). Бизнес-код (`chat/route.ts`, `repos/route.ts`)
   обращается только к `PreviewProvider`, не напрямую к sandbox.
2. **Появился `BuildQueue`** — нового типа компонент, который не имел
   эквивалента в sandbox-only. Он управляет асинхронным выполнением
   билдов с инвариантами «1 running + 1 queued» и «cancel + replace».
3. **Появилась SSE-поверхность** `/api/projects/<id>/build-status`
   для UI-overlay над iframe.
4. **Появилась UI-upload поверхность** `/api/projects/<id>/upload` для
   бинарных ассетов.
5. **`/data/` структура** становится частью архитектуры, не побочной
   деталью реализации:
   - `/data/projects/<id>/` — scratch dir (per-project state).
   - `/data/static/<id>/` — артефакты билдов с симлинками.
   - Docker-volume `adorable_node_modules_react_<version>` — shared.
6. **Capabilities** становятся first-class: пинятся в `RepoMetadata`,
   видны UI и LLM, ветвят tool-set и system-prompt.

---

## 2. Главный поток: «LLM пишет файл — пользователь видит обновление»

Это **горячий путь** продукта. Все остальные потоки — производные.

```
[1] User → UI: "Сделай главный hero синим"
        │
        ▼
[2] UI → POST /api/chat (streaming)
    {messages: [...], projectId}
        │
        ▼
[3] Builder/chat/route.ts:
    a. previewProvider.touch(projectId)  // обновить activity для cleanup
    b. capabilities = repoMetadata.preview.capabilities
    c. tools = createTools(handle, {capabilities, onFileChange, onFileDelete})
    d. systemPrompt = getSystemPrompt(capabilities)
    e. streamLlmResponse(messages, tools, systemPrompt) → SSE к UI
        │
        ├─ во время стрима: LLM вызывает writeFileTool('src/pages/Home.jsx', ...)
        │   → Map.set(path, content)  + fs.writeFile('/data/projects/<id>/src/pages/Home.jsx')
        │   → onFileChange(path, content)
        │
        ▼
[4] onFinish (стрим закрылся):
    a. gitProvider.commits.create({batch from Map}) — один commit per turn
    b. Map.clear()
    c. buildQueue.enqueue({projectId, reason: "turn-finished"}) — non-blocking
    d. HTTP-ответ закрывается. UI видит финальный текст LLM немедленно.
        │
        ▼
[5] BuildQueue (background):
    a. cancel + replace семантика (см. ADR-012)
    b. previewProvider.build({projectId, abortSignal}) →
       docker run --rm build-runner-react:<v> с mounts:
         RO  adorable_node_modules_react_<v>:/workspace/node_modules
         RO  /data/projects/<id>/src:/workspace/src
         RO  /data/projects/<id>/public:/workspace/public
         RW  /data/projects/<id>/.vite:/workspace/.vite       (build cache)
         RW  /data/static/<id>/builds/<ts>:/workspace/dist
       + cgroup limits, --read-only rootfs, --user=1000:1000, no-new-privileges
    c. Контейнер выходит → exit code → BuildResult
    d. На успехе: atomic mv -T current.tmp current
       (current → builds/<ts>; previous → builds/<old>)
    e. SSE-emit к подписчикам: queued → running → succeeded
        │
        ▼
[6] UI listening on SSE /api/projects/<id>/build-status:
    a. queued → overlay "В очереди..."
    b. running → overlay "Обновляется..."
    c. succeeded → убрать overlay, iframe.contentWindow.location.reload()
    d. failed → overlay "Билд упал" + кнопка "Логи"; iframe продолжает показывать last-good
    e. cancelled / superseded → ждём следующий running

[7] Пользователь видит обновлённый сайт через
    https://<projectId>.preview.<base>  →  Caddy file_server  →
    /data/static/<projectId>/current/  →  builds/<ts>/index.html
```

### Key invariants главного потока

- **Стрим к UI закрывается до начала билда** — пользователь не ждёт
  билд для финального ответа LLM. UI отдельно подписывается на SSE.
- **LLM-турн всегда пишет в scratch dir сразу** — durability при
  падении процесса; нет «потерянного» состояния.
- **Один commit per turn** — Gitea не залит микро-коммитами.
- **Caddy не знает про статус билда** — он просто читает symlink.
  Логика «что показывать» — только в UI overlay'е.
- **Артефакт перезаписывается атомарно** — пользователь никогда не
  видит частично записанный билд (через `mv -T`).

---

## 3. Компоненты и их ответственности

### 3.1. PreviewProvider (новый, центральный)

```
adorable/lib/adapters/preview.ts                  — интерфейс
adorable/lib/adapters/preview-static.ts           — static impl
adorable/lib/adapters/preview-sandbox.ts          — wrapper над SandboxProvider
adorable/lib/preview/provider-singleton.ts        — HMR-safe singleton
```

Ответственности:
- `create({repoId})` — создать scratch dir, скопировать boilerplate,
  зарегистрировать proxy-роут (Caddy file_server для static), вернуть
  `PreviewMetadata`.
- `build(projectId, opts)` — запустить vite build в ephemeral
  контейнере; вернуть `BuildResult`. Поддержка `AbortSignal`.
- `destroy(projectId)` — снести scratch + static dirs, удалить
  proxy-роут.
- `touch(projectId)` — сообщить cleanup-worker'у про активность
  (паттерн повторяет `lib/sandbox/cleanup-worker.ts`).
- `capabilities` — readonly декларация возможностей провайдера
  (ADR-015).

`preview-sandbox.ts` — **обёртка** над текущим `SandboxProvider`
без изменения его контракта; адаптирует `VmRuntimeMetadata` →
`PreviewMetadata`. Capabilities sandbox: shell+customDeps+serverRuntime+hotReload.

### 3.2. BuildQueue (новый)

```
adorable/lib/preview/build-queue.ts           — singleton + EventEmitter API
```

In-memory очередь в процессе билдера. Не имеет persistence: при
рестарте билдера незавершённые job'ы отбрасываются (см. ADR-011).

API:
- `enqueue({projectId, reason}) → {jobId, status}`
- `cancel(projectId)` (для destroy)
- `subscribe(projectId, listener) → unsubscribe`
- `getStatus(projectId) → BuildJobStatus | null`

Семантика concurrency — ADR-012:
- max 1 running + 1 queued на projectId.
- новый enqueue с running без queued → cancel running, ставит queued.
- новый enqueue при running+queued → заменяет queued (старый
  получает `superseded`).

Cancel реализован через `dockerode container.kill()` (SIGTERM с
grace period → SIGKILL). Точные таймауты — `OPEN_QUESTIONS.md`.

### 3.3. ProxyProvider — расширение

Существующий `ProxyProvider` (caddy/mock) расширяется:
- Новый тип роута `file_server` — Caddy раздаёт файлы из директории.
  Existing `reverse_proxy` остаётся для sandbox.
- В `addRoute()` появляется поле `target: {type: "upstream", host} | {type: "static", path}`.
- Точная сигнатура — `CONTRACTS.md`.

Static-роуты регистрируются в `previewProvider.create()` и
указывают на стабильный путь `/data/static/<id>/current/`.

### 3.4. Scratch storage (новое — `/data/projects/`)

Per-project структура:
```
/data/projects/<projectId>/
├── src/             ← LLM пишет сюда; build-runner монтирует RO
├── public/          ← LLM пишет текст (whitelist) + UI грузит бинари; RO в build-runner
├── .vite/           ← build-cache (ADR-016); RW в build-runner
├── .cache/          ← резерв под другие per-project caches; RW в build-runner
└── (boilerplate-fixed files: package.json, vite.config.js, ...)
                       ↑ в образ build-runner'а пакуются эти файлы
                         из templates/vite-react/, в scratch dir не лежат —
                         LLM не должен их видеть и трогать (см. ADR-007)
```

Ground truth: scratch dir, не Gitea. Gitea получает batch-commit per turn.

Cleanup: дедицированный воркер по паттерну `lib/sandbox/cleanup-worker.ts`,
TTL по inactivity (`touch()`). Период TTL — `OPEN_QUESTIONS.md`.

### 3.5. Static artifacts (новое — `/data/static/`)

Per-project структура:
```
/data/static/<projectId>/
├── current        → builds/2026-04-27T14-22-08Z-a3f1/
├── previous       → builds/2026-04-27T14-15-33Z-9b2e/
├── builds/
│   ├── 2026-04-27T14-22-08Z-a3f1/    ← последний успешный
│   ├── 2026-04-27T14-15-33Z-9b2e/    ← предпредыдущий
│   └── ... (BUILD_HISTORY_LIMIT штук)
```

Atomic swap при успешном билде:
```sh
ln -sfn builds/<new> current.tmp
mv -T current.tmp current
# previous симлинк обновляется аналогично
```

GC-воркер удаляет всё в `builds/` старше `BUILD_HISTORY_LIMIT`,
кроме того на что указывают `current` и `previous`.

### 3.6. Build-runner (новый Docker-образ)

```
docker/build-runner-react/Dockerfile
docker/build-runner-react/init-volume.sh
```

Содержит:
- node:22-slim
- pnpm/npm
- Зафиксированные boilerplate-файлы из `templates/vite-react/`
  (без `node_modules` — он в named volume).
- `vite` как entrypoint default (CMD `["vite", "build"]`).

Образ версионируется (`build-runner-react:1.2.3`) синхронно с
семантической версией `templates/vite-react/` (см. ADR-008).

Named volume `adorable_node_modules_react_<version>` заполняется при
build/upgrade образа init-контейнером, копирующим `node_modules` через
`cp -a` (сохраняет pnpm-симлинки). Тест на симлинки — обязательный
gate в CI (см. ADR-005).

### 3.7. Capabilities (новое — first-class)

```ts
interface PreviewCapabilities {
  shellAccess: boolean;
  customDependencies: boolean;
  serverRuntime: boolean;
  hotReload: boolean;
  manualRebuild: boolean;
}
```

Декларируется провайдером, **пинится** в `RepoMetadata.preview.capabilities`
при создании проекта (ADR-015). Используется:
- `createTools(handle, {capabilities})` — выбор tool-set'а.
- `getSystemPrompt(capabilities)` — выбор промпта (static vs sandbox).
- UI — рендер/скрытие панелей терминалов и кнопок.
- `BuildQueue` — игнорирует enqueue если `manualRebuild` false и
  reason ≠ "turn-finished" (защита от случайного API-вызова).

---

## 4. Поток создания проекта

```
[1] User → POST /api/repos {name, prompt?}
[2] Builder/repos/route.ts:
    a. gitProvider.createRepo(...)                    — пустой Gitea-репо
    b. seedTemplateRepo(gitea, repo)                  — initial commit с boilerplate
    c. previewProvider = await getPreviewProvider()
    d. metadata = await previewProvider.create({repoId})
       static impl:
         i.   mkdir -p /data/projects/<id>/{src,public,.vite,.cache}
         ii.  cp -r templates/vite-react/{src,public}/* /data/projects/<id>/
         iii. previewProvider регистрирует Caddy file_server роут
              на <id>.preview.<base> → /data/static/<id>/current/
         iv.  buildQueue.enqueue({projectId: id, reason: "initial"})
              (чтобы прешакать первый артефакт сразу после создания)
       sandbox impl: оборачивает существующий createVmForRepo
    e. metadata = await readRepoMetadata(repoId)
       metadata.preview = {
         provider: previewProvider.name,
         capabilities: previewProvider.capabilities,
         createdAt: now,
       }
       metadata.boilerplateVersion = "1.2.3"     // из templates/vite-react/VERSION
       writeRepoMetadata(repoId, metadata)
    f. return PreviewMetadata to UI
```

`PreviewProvider.create()` — это эквивалент текущей
`createVmForRepo()`, но без 3-хостной schema (для static). Возвращает
`PreviewMetadata` (ADR-014), не handle: для static нет living-state,
все последующие операции идут по `projectId`.

---

## 5. Поток уничтожения проекта

```
previewProvider.destroy(projectId):
  a. buildQueue.cancel(projectId)                       — отменить in-flight
  b. proxyProvider.removeRoute(static-route-id)         — снять Caddy роут
  c. rm -rf /data/projects/<projectId>                  — scratch + cache
  d. rm -rf /data/static/<projectId>                    — все билды + симлинки
  e. audit-log: project-destroyed
  (Gitea-репо НЕ удаляется здесь — это отдельное действие через
   gitProvider.deleteRepo, обычно явно из UI/API)
```

---

## 6. Параллельные потоки (UI uploads, manual rebuild)

### UI upload (бинарные ассеты)

```
UI drag-drop → POST /api/projects/<id>/upload (multipart)
  a. валидация: ≤5MB, whitelist расширений, magic-bytes (ADR-007)
  b. санитизация имени
  c. fs.writeFile('/data/projects/<id>/public/<safe-name>')
  d. НЕ enqueue билд автоматически — пользователь увидит файл
     при следующем turn'е LLM или при manual Rebuild.
  e. emit chat-event «загружен файл foo.png» (опционально)
  f. return {path: '/foo.png', size, mime}
```

### Manual Rebuild

```
UI click "Rebuild" → POST /api/projects/<id>/rebuild
  (client-side debounce ~500мс)
  a. buildQueue.enqueue({projectId, reason: "manual"})
  b. response: {jobId}
  c. UI продолжает слушать SSE
```

LLM имеет аналогичный `requestRebuildTool`, который вызывает то же
самое — но system-prompt ограничивает: «вызывать только если
пользователь явно просит пересборку» (ADR-001).

---

## 7. Границы и trade-offs

### Что новая архитектура даёт

1. **Дешёвый превью** — нет долгоживущих контейнеров на проект.
   Ephemeral build-runner на 2–5 секунд раз в turn. Простаивающий
   проект ничего не стоит.
2. **Простая security-модель** — RO node_modules + RO src + read-only
   rootfs + caps drop + non-root user. Атакующая поверхность
   ограничена `vite build`. Подробнее — `SECURITY.md`.
3. **Atomic preview swap** — пользователь никогда не видит
   полусырого билда; old artifact показывается до момента готовности.
4. **Reusable build-runner** — один shared volume на framework,
   `node_modules` инсталлируется один раз при upgrade образа.
5. **Capability-driven UI/LLM** — единый код, два режима. Будущий
   третий режим (например serverless deploy) добавляется через
   capability-флаг + новую реализацию provider'а.

### Что новая архитектура **не** даёт

1. **HMR/hot-reload** — каждое изменение это full vite build с тёплым
   cache. Скорее всего 2–5 секунд (точная метрика —
   `OPEN_QUESTIONS.md`). Это **продуктовое решение** (ADR-009), не
   баг.
2. **Custom npm-зависимости** — пользователь не может добавить
   произвольную библиотеку. Только то, что в boilerplate'е (ADR-002,
   ADR-010). Расширение списка — централизованное решение
   platform-team (ADR-008).
3. **Server runtime** — никаких API routes / server actions / Express.
   Бэкенд — отдельный продукт (managed BaaS), вне scope текущей
   спеки (см. `OPEN_QUESTIONS.md`).
4. **Горизонтальное масштабирование билдера на старте** — single-
   instance модель из ADR-006. План масштабирования — sticky
   sessions → S3-compat — в `OPEN_QUESTIONS.md`.

### Что осталось от sandbox-режима

`PREVIEW_PROVIDER=sandbox` — fallback для:
- Отладки самой архитектуры (сравнение поведения).
- Будущих fullstack-проектов (когда понадобится живой Node-рантайм).
- Power-user сценариев, требующих shell-доступа.

В этом режиме код и инфра практически не меняются — добавляется
только тонкая обёртка `preview-sandbox.ts`, адаптирующая контракт.

---

## 8. Соответствие спек-документов компонентам

| Документ              | Описывает                                              |
|-----------------------|--------------------------------------------------------|
| `ARCHITECTURE.md`     | Эта картина (компоненты, потоки, границы)             |
| `CONTRACTS.md`        | Точные TS-интерфейсы: PreviewProvider, BuildResult, ProjectFile, Capabilities, ProxyProvider extension, BuildQueue |
| `BOILERPLATE.md`      | Что лежит в `templates/vite-react/`, версионирование, миграции (ADR-008) |
| `DEPENDENCIES.md`     | Список зависимостей boilerplate'а; AVAILABLE_DEPS.md для system-prompt |
| `BUILD_PIPELINE.md`   | Поток build'а в деталях: mounts, atomic swap, cancel, cache, error handling |
| `SECURITY.md`         | Модель угроз; static vs sandbox защиты; UI uploads validation |
| `MIGRATION_PATH.md`   | План миграции с текущего sandbox-only кода; параллельная работа sandbox/static |
| `VERIFICATION.md`     | Реальные продуктовые сценарии (промпт → сайт) + инфра-проверки |
| `LIMITATIONS.md`      | Границы static-режима для понимания пользователя       |
| `OPEN_QUESTIONS.md`   | Что осталось нерешённым (сейчас 18 пунктов)           |
| `DECISIONS.md`        | ADR-журнал — 16 решений раундов 1–4                   |
| `CURRENT_STATE.md`    | Снимок текущего кода на момент начала спек-сессии      |

---

_Last updated: 2026-04-27. Раунд 4 — все архитектурные развилки закрыты,
готово к детализации в CONTRACTS / BUILD_PIPELINE / SECURITY._
