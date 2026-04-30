# DECISIONS.md — ADR-журнал спек-сессии

Каждое решение — короткий ADR: контекст, решение, альтернативы,
последствия. Решения принимаются **в этой сессии**; реализация — после.

Формат:
- **Status**: accepted / superseded / deprecated
- **Date**: дата принятия
- **Context**: что заставляет принять решение
- **Decision**: что выбрали
- **Alternatives**: что не выбрали и почему
- **Consequences**: что меняется, что появляется, что нужно учесть

---

## ADR-001: Триггер билда — конец turn'а LLM + manual rebuild

**Status**: accepted
**Date**: 2026-04-27

### Context

В static-модели нет живого dev-сервера; превью обновляется через
`vite build`. Нужен явный триггер: на каждую запись файла, на
завершение turn'а, или по запросу.

### Decision

**Билд запускается в `onFinish` стрима LLM-чата** — ровно один билд
на завершённый turn агента. **Дополнительно** пользователь имеет
кнопку «Rebuild preview» в UI, которая принудительно перезапускает
билд того же набора файлов (например, после внешнего изменения
зависимостей или для проверки гипотез). LLM **может вызвать тот же
manual-rebuild через tool**, если пользователь явно попросил
«пересобери» — но не вправе делать это самостоятельно как часть
обычного workflow.

### Alternatives

- **Per-file-write debounced** — ближе к HMR. Отвергнуто: сложная
  семантика cancel-and-restart, нагрузка на build-runner, нет
  выигрыша в UX (пользователь читает стриминг ответа, а не смотрит
  iframe в реальном времени).
- **Чисто LLM-controlled** — отдельный tool, агент решает когда
  билдить. Отвергнуто: ненадёжно (LLM может забыть / билдить лишний
  раз), и неочевидно для пользователя когда ждать обновления.

### Consequences

- В `chat/route.ts` `onFinish`-хук дополнительно дёргает
  `previewProvider.build({repoId})`. Существующий batch-commit через
  `onFileChange` Map тоже остаётся в `onFinish` — порядок: commit → build.
- В `PreviewProvider` контракте `build()` асинхронная, идемпотентная,
  возвращает `BuildResult` (статус, stdout/stderr, длительность).
- Очередь / coalescing билдов — concurrent build на тот же `repoId`
  должен заменять предыдущий (cancel + replace), не плодить параллельные.
  Концепция уйдёт в `BUILD_PIPELINE.md`.
- LLM получает дополнительный tool типа `requestRebuildTool` или
  `rebuildPreviewTool` — но в system-prompt'е написано: вызывать его
  **только** если пользователь явно попросил пересборку.
  Капабилити для UI: `manualRebuild: true` в обоих режимах (static и sandbox).
- Iframe во время билда — отдельное решение (см. ADR-004 ниже).

---

## ADR-002: MVP — один фреймворк (React)

**Status**: accepted
**Date**: 2026-04-27

### Context

В кикоффе упоминались React/Vue/Svelte. В репо лежит только
`templates/vite-react/`. Решение влияет на наличие framework-dispatch
в контрактах, наличие пикера в UI, объём `BOILERPLATE.md`.

### Decision

**MVP поддерживает только React.** Один `templates/vite-react/`
шаблон, один build-runner image. UI без пикера фреймворка. Vue/Svelte
**не закладываются как отдельные templates на старте**.

### Alternatives

- **React + Vue + Svelte с самого начала** — отвергнуто: тройная
  поверхность тестирования, тройной build-runner image, тройной
  список зависимостей, который надо обновлять синхронно.
  Несоразмерно для MVP.
- **React + один абстрактный «framework»-слот, реально один шаблон**
  — компромисс. Отвергнуто: «лишняя» абстракция под несуществующую
  задачу (см. принцип «адаптеры — для замены провайдеров, не для
  расширения»).

### Consequences

- В `PreviewProvider` контракте **нет** поля `framework` в
  `PreviewCreateOptions`. Контракт описывает «какой шаблон» неявно —
  через привязку к одному текущему build-runner'у.
- В `RepoMetadata` поле `framework` **не вводим** на MVP. Когда
  понадобится Vue/Svelte — это будет аддитивный change (поле появится
  опциональным, default `react`, существующие репо мигрируют без
  правок).
- `BOILERPLATE.md` описывает только `templates/vite-react/`.
- `DEPENDENCIES.md` тоже один список зависимостей (для React-шаблона).
- `system-prompt.ts` остаётся React-специфичным; не нужно условной
  логики «если фреймворк X».

---

## ADR-003: LLM-toolset зависит от режима PreviewProvider

**Status**: accepted
**Date**: 2026-04-27

### Context

Из 13 текущих LLM-tools 9 завязаны на live container/dev-server.
В static-режиме контейнер **во время редактирования не существует** —
LLM пишет только файлы. В sandbox-режиме (fallback) всё остаётся
по-старому.

### Decision

**Toolset формируется динамически в зависимости от
`previewProvider.capabilities`.**

- В **static**-режиме LLM получает только file-tools (read, write,
  replace, append, list, search, mkdir, move, delete) + `commitTool`
  (server-side через `gitProvider.commits.create`) + новый
  `getBuildLogsTool` (returns last build's stdout/stderr/errors).
  **Никакого `bashTool`, `checkAppTool`, `devServerLogsTool`** —
  они скрыты от LLM, system-prompt про них не упоминает.
- В **sandbox**-режиме LLM получает полный набор из 13 текущих
  tools, включая `bashTool`. Поведение и контракт совпадают с
  текущей реализацией.

В контракте `PreviewProvider` добавляется capabilities-флаг
`shellAccess: boolean`, который влияет на `createTools()`.
`createTools(handle, {capabilities, ...})` сам решает какие tools
эксп ortить.

### Alternatives

- **Полностью убрать bashTool из обоих режимов** — отвергнуто:
  sandbox-режим существует именно для случаев, когда нужен
  runtime-доступ (отладка, fullstack-проекты в будущем). Без bashTool
  он становится бесполезным.
- **Оставить bashTool в static, но запускать в build-runner'е
  ephemeral'но** — отвергнуто: добавляет сложность (управление exec
  state, безопасность, тайм-ауты) под несуществующее требование.
  Если в будущем понадобится — добавим как `staticShell` capability.
- **Свой набор tools на каждый режим без общей основы** — отвергнуто:
  file-tools идентичны в обоих режимах, дублировать не нужно.

### Consequences

- `lib/create-tools.ts` рефакторится: shell-зависимые tools
  (`bashTool`, `listFilesTool`, `searchFilesTool`, `makeDirectoryTool`,
  `movePathTool`, `deletePathTool`, `checkAppTool`, `devServerLogsTool`)
  переписываются на pure-fs реализации **там, где это возможно**, либо
  скрываются за capability-флагом.
  - `listFilesTool`, `searchFilesTool`, `mkdir`, `move`, `delete` →
    переписываются на pure-fs (в обоих режимах работают через
    `handle.fs`, без `exec`).
  - `bashTool`, `checkAppTool`, `devServerLogsTool` → остаются
    sandbox-only, capability `shellAccess: true`.
- `commitTool` в static-режиме **не запускает `git push`** изнутри
  контейнера (потому что контейнера нет). Реализация: tool вызывает
  callback, который делает `gitProvider.commits.create` server-side
  (как уже сделано через `onFileChange` batch-commit, только с явной
  семантикой commit-on-demand).
- Новый `getBuildLogsTool` в static-режиме — читает stdout/stderr
  последнего билда (хранит `PreviewProvider`).
- `system-prompt.ts` ветвится: один промпт для static-режима
  (без упоминаний npm/dev-server/curl), второй для sandbox-режима
  (текущий, с поправками). Имплементация ветвления — `getSystemPrompt(capabilities)`.
- В UI: панели «dev terminal» и «additional terminals» **скрываются**
  в static-режиме. Capabilities → UI ownership.

---

## ADR-004: Iframe rendering policy — last-good + UI overlay через atomic symlink swap

**Status**: accepted (раунд 3)
**Date**: 2026-04-27

### Context

Что iframe показывает, пока `vite build` идёт или падает? Решение
оттягивалось до появления lifecycle артефактов (см. ADR-008 — там
появились `dist-previous/` и понятие версионируемых артефактов).
Теперь решаем.

### Decision

**Combined: last-good артефакт всегда + UI-overlay «обновляется» через
отдельный канал.**

#### Разделение ответственностей

- **Caddy** ничего не знает про статус билда. Он просто `file_server`
  на текущий артефакт через стабильный путь:
  `/data/static/<projectId>/current/`. Это **симлинк** на конкретную
  билд-директорию.
- **Builder** пишет каждый билд в новую директорию
  `/data/static/<projectId>/builds/<timestamp>/` (или `<buildId>`).
  По успеху — атомарно переключает `current` симлинк через
  `ln -sfn <new> current.tmp && mv -T current.tmp current` (две команды,
  но `mv -T` сам по себе атомарен на POSIX).
  Старая директория, на которую `current` указывал до swap,
  становится `dist-previous/` (ещё один симлинк), доступной для
  rollback в ADR-008.
- **UI** знает статус билда через SSE-стрим `/api/projects/<id>/build-status`
  (см. ADR-011). Когда билд `running` → рисует overlay «Обновляется...»
  поверх iframe'а. Когда `succeeded` → убирает overlay, делает
  `iframe.contentWindow.location.reload()` (или просто refresh src,
  если та же URL — сменился контент за симлинком).
- При упавшем билде `current` **не переключается**, остаётся прошлая
  версия. UI показывает overlay/баннер «билд упал, показан предыдущий
  результат» с диплинком на логи через `getBuildLogsTool` или
  отдельную панель.

#### Структура `/data/static/<projectId>/`

```
/data/static/<projectId>/
├── current        → builds/2026-04-27T14-22-08Z-a3f1/   (symlink)
├── previous       → builds/2026-04-27T14-15-33Z-9b2e/   (symlink, для rollback)
├── builds/
│   ├── 2026-04-27T14-22-08Z-a3f1/    ← последний успешный
│   ├── 2026-04-27T14-15-33Z-9b2e/    ← предпредыдущий
│   ├── 2026-04-27T14-08-19Z-7c4d/    ← старее
│   └── ...
```

`builds/` хранит N последних артефактов (точное N — открытый вопрос,
default 5). GC-воркер удаляет всё старше N (но не `current` и не
`previous`). Это даёт надёжный rollback без exotic версий volume'ов.

### Alternatives

- **Last-good всегда (без overlay)** — `current` симлинк всегда,
  UI не знает что билд идёт. Отвергнуто: пользователь не понимает
  «обновился ли результат», смотрит на старый и ждёт.
- **Building-placeholder страница в Caddy** — пока билд идёт, Caddy
  отдаёт спецстраницу. Отвергнуто: дополнительный state в Caddy,
  координация момента переключения, плохо для пользователя
  (спокойно ждать на старом результате лучше, чем смотреть на
  заглушку).

### Consequences

- В `BUILD_PIPELINE.md` — раздел «Атомарное переключение артефакта»:
  `mv -T` для атомарного rename симлинка, поведение при упавшем билде
  (current не трогаем).
- В `CONTRACTS.md` — `BuildResult` содержит `artifactPath` (путь к
  только что созданной build-директории) и `wasSwapped` (true если
  current переключён).
- В Caddy `proxy-caddy.ts` — добавляется новый тип роута
  `file_server` (вместо `reverse_proxy` для sandbox-режима). Точная
  схема — `CONTRACTS.md` ProxyProvider extension.
- Структура `/data/static/<projectId>/builds/<timestamp>/` — заменяет
  плоский `dist/` из ADR-005. Схема монтирования в build-runner'е
  обновляется: вместо `-v /data/static/<projectId>:/workspace/dist:rw`
  будет `-v /data/static/<projectId>/builds/<timestamp>:/workspace/dist:rw`.
- GC-воркер для старых builds в `/data/static/<id>/builds/` —
  параметр `BUILD_HISTORY_LIMIT` (default 5).
- В `OPEN_QUESTIONS.md`: точное N для истории, политика
  при rollback (manual button vs автоматический при критических
  ошибках), что показывать в overlay при cancel'е (см. ADR-012).

---

## ADR-005: Build-runner — ephemeral container per build с RO node_modules volume

**Status**: accepted
**Date**: 2026-04-27

### Context

Подтверждение ответа на Q4 + детализация схемы монтирования. Целевой
продукт — base44-style: полностью статические превью, build-runner
не должен быть hot path с сохранением state между билдами.

### Decision

Каждый билд исполняется в **ephemeral контейнере**, создаваемом
`docker run --rm` непосредственно перед билдом и удаляемом сразу
после. `node_modules` шарится через **read-only named Docker volume**,
один на framework: `adorable_node_modules_react`,
`adorable_node_modules_vue`, ... (имена зарезервированы; на MVP
существует только `_react` — см. ADR-002).

#### Заполнение named volume

При сборке (или обновлении) build-runner-образа однократно запускается
init-контейнер, который копирует prebuilt `node_modules` в named
volume через `cp -a` (сохраняет pnpm-симлинки и timestamps).
Использовать bind-mount директории `node_modules` из образа **нельзя** —
ломает pnpm-симлинки. Использовать слой в самом образе **нежелательно**
— добавляет copy-on-write overhead на каждый старт контейнера.

#### Базовая схема монтирования

```
docker run --rm \
  --network adorable_build \
  --memory=2g --cpus=2 --pids-limit=512 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  --user=1000:1000 \
  --read-only \
  --tmpfs /tmp:size=200m \
  -v adorable_node_modules_react:/workspace/node_modules:ro \
  -v /data/projects/<projectId>/src:/workspace/src:ro \
  -v /data/projects/<projectId>/public:/workspace/public:ro \
  -v /data/static/<projectId>:/workspace/dist:rw \
  build-runner-react:<version> \
  vite build
```

Точные значения лимитов настраиваются env-переменными
(`BUILD_RUNNER_MEMORY`, `BUILD_RUNNER_CPUS`, ...). Значения выше — defaults.

`/workspace` сам по себе — это смесь монтирований (`/src`, `/public`,
`/dist`, `/node_modules`); в образе должны лежать только фиксированные
файлы шаблона (`package.json`, `vite.config.js`, `tsconfig.json`,
`tailwind.config.js`, `postcss.config.js`, `index.html`,
`jsconfig.json`). Они идут из `templates/vite-react/` и копируются в
образ при сборке.

### Alternatives

- **Long-running pool** — отвергнуто: нет выигрыша, добавляет
  state-cleanup, restart-стратегию, риск memory leaks в Vite.
- **In-process через child_process** — отвергнуто: любая RCE
  в Vite/esbuild → доступ к ключам, БД, сессиям пользователей.
  Build-runner перестаёт быть версионируемой единицей.

### Consequences

- В `PreviewProvider` контракте появляется `build({projectId})` →
  `BuildResult`. Реализация: docker socket вызов + ожидание exit code.
- `BuildResult` содержит `exitCode`, `stdout`, `stderr`, `durationMs`,
  `artifactPath`, `errors[]` (parsed). Точная сигнатура — `CONTRACTS.md`.
- Появляется новый Docker-образ `build-runner-react:<version>` с
  Dockerfile под `templates/vite-react/`.
- Появляется init-контейнер / make-target для (пере)заполнения
  `adorable_node_modules_react` volume через `cp -a`.
- В `docker-compose.yml` декларируется новый named volume
  `adorable_node_modules_react`. Сеть `adorable_build` (отдельная,
  internal-only — у build-runner'а не должно быть исходящего
  интернета).
- В `BUILD_PIPELINE.md` нужны: схема mounts, процесс обновления
  named volume, тест на сохранение pnpm-симлинков (это типовой
  источник weird-bugs), замер реального overhead.
- Build-cache (Vite/esbuild) — открытый вопрос: per-project named
  volume `adorable_build_cache_<projectId>` mounted RW в `/workspace/.vite`,
  чтобы инкрементальные билды одного проекта были быстрее. Точная
  стратегия — `BUILD_PIPELINE.md` + `OPEN_QUESTIONS.md` (целевая
  метрика времени incremental build).

---

## ADR-006: File flow — scratch dir + Map + commit per turn

**Status**: accepted
**Date**: 2026-04-27

### Context

LLM пишет файлы в рамках turn'а. Эти файлы должны (1) попасть в
build-runner (через bind-mount), (2) выживать рестарт билдера до
commit'а, (3) попасть в Gitea **одним** commit'ом per turn, не
по-одному.

### Decision

**Гибридная модель: scratch dir на локальном диске + in-memory Map +
один git-commit per turn.**

```
LLM tool writeFile(path, content):
  1. Map.set(path, content)              ← внутри turn'а — для diff/build invalidation
  2. await fs.writeFile(/data/projects/<projectId>/<path>, content)  ← durability + bind-mount source

LLM в конце turn'a (commitTool ИЛИ onFinish):
  1. gitProvider.commits.create(batch из Map.entries())  ← один commit
  2. Map.clear()
```

Build-runner монтирует `/data/projects/<projectId>/{src,public}` как
read-only bind-mounts. На момент билда там лежит актуальное состояние
файлов, обновлённое последним `writeFileTool`-ом, независимо от того,
успел ли LLM закоммитить.

### Alternatives

- Gitea как source of truth с самого начала — отвергнуто: дорого
  (commit на каждый write), замусоривает историю, замедляет turn LLM.
- In-memory + tar-stream в build-runner — отвергнуто: теряем
  durability при рестарте билдера до commit'а.

### Consequences

- Появляется `/data/projects/<projectId>/{src,public}` как ground truth
  для активного проекта. Структура внутри идентична `templates/vite-react/`
  (за вычетом `node_modules`, который монтируется отдельно).
- Сохраняется существующий паттерн `onFileChange` Map в `chat/route.ts`
  (см. `create-tools.ts`). Расширяется: write-через-tool теперь делает
  и Map.set, и `fs.writeFile` в scratch dir.
- В `commitTool` из ADR-003 семантика становится явной: server-side
  батч из накопленного Map. Не выполняется `git push` из контейнера
  (контейнера и нет в static).
- При `PreviewProvider.destroy(projectId)` — `rm -rf /data/projects/<projectId>`
  обязательно. Новый dedicated cleanup-worker аналогичный
  `lib/sandbox/cleanup-worker.ts`, но для scratch dirs (TTL по
  inactivity).
- Перезапуск билдера scratch dirs **не теряет** — это feature, важно
  для durability. В `lib/sandbox/cleanup-worker.ts` паттерн уже есть,
  переиспользовать.

#### Известное ограничение и план масштабирования

**Single-instance билдер.** Scratch dir на локальном диске => все
LLM-сессии и build-runner'ы работают на одной машине.

Когда упрёмся (десятки конкурентных пользователей):
1. Sticky sessions через load balancer — простое промежуточное
   решение.
2. Объектное хранилище (Yandex Object Storage / MinIO S3-compatible)
   — долгосрочно, для горизонтального масштабирования.

В `BUILD_PIPELINE.md` фиксируем текущую модель и явно отмечаем как
single-instance. План масштабирования живёт в `OPEN_QUESTIONS.md`.
**Не пытаемся** решить заранее.

---

## ADR-007: Assets — LLM пишет текст с whitelist путей, UI грузит бинари

**Status**: accepted
**Date**: 2026-04-27

### Context

Где хранятся / как создаются ассеты (`public/*.png`, `public/*.svg`,
шрифты, видео)? base64 в LLM tool — нерабочий вариант (один JPG 500KB
≈ 180K токенов).

### Decision

**(b) Разделение по типам файлов.**

#### Whitelist `writeFileTool` для LLM

**Разрешено:**
- `src/**/*.{js,jsx,css,scss,html,json}` — UI-код в JSX (см. ADR-013).
  TS-расширения **не разрешены** в `src/` — frontend остаётся JSX-only.
- `public/**/*.{svg,json,xml,txt,html,webmanifest}`
- `functions/**/*.{ts,json}` — серверные/edge-функции (TypeScript,
  см. ADR-013 раунд 6). `*.js` тут **не разрешены** — functions
  стандартизованы на TypeScript.

**Запрещено** (tool возвращает понятную ошибку):
- `package.json`, `vite.config.{ts,js}`, `tsconfig.json`, `jsconfig.json`,
  `pnpm-lock.yaml`, `package-lock.json`, `.npmrc`,
  `tailwind.config.*`, `postcss.config.*`, `index.html` (root),
  `VERSION`, `AVAILABLE_DEPS.md`, `functions/tsconfig.json` —
  фиксированный boilerplate (см. ADR-002, ADR-008, ADR-021).
- `public/**/*.{jpg,jpeg,png,webp,gif,mp4,webm,woff,woff2,ttf,otf,eot}`
  — бинарь, через UI-upload.
- `src/**/*.{ts,tsx}` — frontend это JSX, не TS (ADR-013).
- Всё вне `src/`, `public/`, `functions/` (включая корневые конфиги,
  `node_modules`, `.git`).

#### UI-upload endpoint

`POST /api/projects/<projectId>/upload` (multipart/form-data):
- Лимит размера: ≤5MB на файл.
- Whitelist расширений: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`,
  `.svg`, `.mp4`, `.webm`, `.woff`, `.woff2`, `.ttf`.
- **Magic-bytes проверка** (не только расширение).
- Санитизация имени (никаких `../`, спецсимволов; latinize или nano-id).
- Файл кладётся в `/data/projects/<projectId>/public/`.
- Событие в LLM-чат: «загружен файл `photo.jpg` (520KB), путь `/photo.jpg`».
  LLM узнаёт о наличии через chat-events и `listFilesTool`.

#### Pre-existing assets из boilerplate

Файлы из `templates/vite-react/public/` копируются в scratch dir при
`PreviewProvider.initialize(projectId)`. LLM может их перезаписать
(если whitelist-разрешён по расширению) или удалить через
`deletePathTool('public/vite.svg')`.

### Alternatives

- `writeBinaryFileTool(path, base64)` — отвергнуто: 180K токенов
  на один JPG нереально.
- LLM генерирует SVG inline в JSX — допустимо, но не как основная
  стратегия (мы это и так не запрещаем).

### Consequences

- В `CONTRACTS.md`: `writeFileTool` имеет явный whitelist regex для
  путей, поведение при попытке писать в запрещённый путь —
  `{ok: false, error: "Path not writable: ..."}`.
- В `BUILD_PIPELINE.md` раздел «Источники файлов в scratch dir»:
  (1) копирование из `templates/<framework>/` при initialize,
  (2) запись от LLM через whitelisted writeFileTool,
  (3) upload через UI endpoint.
- В `SECURITY.md` раздел «UI uploads»: размер, расширения,
  magic-bytes, санитизация имён.
- `[Ответственность: UI]` — drag-and-drop, превью загруженных файлов
  в чате, прогресс/ошибки.
- `[Ответственность: Backend]` — endpoint, валидация, fs-write
  в scratch dir.
- Открытый вопрос: ClamAV / антивирус для uploads. Зависит от
  threat model нашей аудитории. Пока фиксируем magic-bytes + size cap
  как baseline. Пишем в `OPEN_QUESTIONS.md`.

---

## ADR-008: Boilerplate — версионируемый продукт + миграционный воркер

**Status**: accepted
**Date**: 2026-04-27

### Context

base44-style: состав зависимостей в `templates/vite-react/`
управляется командой централизованно. Когда обновляем — все
существующие проекты должны получить новые зависимости (security
patches, bug fixes в Vite/Tailwind).

### Decision

#### Версионирование

`templates/vite-react/` имеет **семантическую версию** в файле
`templates/vite-react/VERSION` (например `1.2.3`). Версия привязывается
к Docker-образу build-runner'а (`build-runner-react:1.2.3`) и к
named volume (`adorable_node_modules_react_1_2_3`).

Каждый проект хранит метаданные «на какой версии boilerplate был
последний успешный build» — поле `boilerplateVersion` в `RepoMetadata`.

#### Миграционный воркер

Когда выпускается новая версия `templates/vite-react/`:

1. CI собирает новый `build-runner-react:1.3.0` образ + создаёт
   `adorable_node_modules_react_1_3_0` named volume.
2. Запускается **миграционный воркер**, который пробегает по всем
   проектам с `boilerplateVersion < 1.3.0` партиями (rate-limited):
   - Для каждого проекта: `vite build` под новой версией.
   - Если успех → обновить статику в `/data/static/<projectId>/`,
     поднять `boilerplateVersion` в metadata, в `dist-previous/`
     остаётся прошлый артефакт для rollback'а.
   - Если падает → проект помечается `migrationStatus: needs_review`,
     пользователь видит баннер «ваш проект требует ручного review».
3. Постепенный rollout (партиями, не all-at-once) — снижает blast
   radius неудачной миграции.

#### Ручная миграция

UI показывает: «ваш проект использует boilerplate v1.2.3, доступна v1.3.0».
Кнопка «Обновить» — запускает миграцию для одного проекта вне
воркера-партии.

#### Rollback

При неудаче автомиграции — артефакт остаётся в
`/data/static/<projectId>/dist-previous/`. Caddy роут указывает на
актуальный `dist/`, но system может переключить на `dist-previous/`
при выявлении проблемы.

### Alternatives

- **Не мигрировать существующие проекты** — pin к версии boilerplate
  на момент создания. Отвергнуто: не получаем security patches
  централизованно, противоречит base44-подходу.
- **All-at-once migration** — отвергнуто: одна сломанная миграция
  ломает всех пользователей. Партии безопаснее.

### Consequences

- В `BOILERPLATE.md` раздел «Жизненный цикл версий boilerplate»:
  семантическое версионирование, формат `VERSION`-файла, привязка
  к Docker-образу и named volume.
- В `MIGRATION_PATH.md` раздел «Rollout миграций»: схема партий,
  rollback через `dist-previous/`, UI-баннеры.
- `[Ответственность: Platform Team]` — управление версиями,
  релизы, мониторинг success rate миграций.
- В `OPEN_QUESTIONS.md`: частота автомиграций (по cron? при каждой
  новой версии? только manual trigger?). Default-предложение:
  manual trigger от platform-team на новую версию + ручной баннер
  пользователю.

---

## ADR-009: Long sessions — остаёмся на static, оптимизируем через build-cache

**Status**: accepted
**Date**: 2026-04-27

### Context

Альтернатива: для активных «долгих» сессий (пользователь редактирует
проект минут 30 подряд) переключаться в sandbox-режим с живым
dev-сервером. Технически возможно, но добавляет архитектурную
сложность.

### Decision

**Не переключаемся.** Каждое изменение → `vite build` через ephemeral
build-runner. Sandbox-режим остаётся **только** для отладки и future
fullstack-проектов, не активируется автоматически.

UX-приемлемость обеспечивается:
- Build-cache между билдами одного проекта (Vite/esbuild cache
  в named volume `adorable_build_cache_<projectId>` mounted RW в
  `/workspace/.vite` или эквивалент).
- Quick feedback в UI: «билдю...» с прогрессом.
- Логи билда в чате при падении — не молчаливая ошибка.

### Alternatives

- **Адаптивно переключаться static↔sandbox по эвристике** — отвергнуто:
  два пути рендера превью, два mental model для пользователя, два
  набора lifecycle bug'ов.
- **Sandbox по умолчанию для долгих сессий** — отвергнуто:
  противоречит базовой стратегии base44-style + не даёт security-выгод
  static (см. SECURITY.md).

### Consequences

- В `BUILD_PIPELINE.md` раздел «Build cache»: per-project named volume
  для `.vite/` и `node_modules/.vite/`. Стратегия инвалидации.
- В `LIMITATIONS.md` явно: «нет HMR, каждое изменение = full rebuild
  с тёплым cache». Это особенность, не баг.
- В `OPEN_QUESTIONS.md`: целевая метрика incremental build (1 / 3 / 5 с?).
  От ответа зависит acceptable UX и решения вокруг кешей.
- ADR-004 (iframe rendering policy) более актуален: iframe должен
  показывать last-good при rebuild + indicator «обновляется...».

---

## ADR-010: Capability tier — explicit constraints в LLM-промпте

**Status**: accepted
**Date**: 2026-04-27

### Context

LLM нужно явно понимать границы доступного. По примеру Bolt'овского
"WEBCONTAINER CONSTRAINT" — даём architecture constraint в системном
промпте.

### Decision

В **static**-варианте system-prompt'а добавляется блок:

```
ARCHITECTURE CONSTRAINT
This project runs as a static SPA built with Vite. Available technologies are LIMITED to:
- React 18 with hooks
- React Router DOM 6 for routing
- Tailwind CSS 3 for styling
- lucide-react for icons
- (полный список из templates/AVAILABLE_DEPS.md)

NOT AVAILABLE:
- Server-side rendering, API routes, server actions
- Real backend (no Express, Fastify, no databases)
- Native modules requiring node-gyp
- Custom npm packages outside the listed dependencies

For data persistence, use localStorage or sessionStorage.
For external APIs, use fetch directly from the browser (CORS-permitting).
For backend functionality, the user must connect to our managed BaaS — don't generate server code yourself.
```

Список зависимостей живёт в **одном источнике правды**:
`templates/vite-react/package.json` + сгенерированный из него
`templates/vite-react/AVAILABLE_DEPS.md` (для LLM-промпта). Генерация
— часть build pipeline boilerplate'а.

### Alternatives

- Не сообщать LLM про границы — отвергнуто: LLM генерирует код,
  предполагающий бэкенд/server-actions/etc., билд падает,
  пользователь страдает.
- Хардкодить список в system-prompt — отвергнуто: списки расходятся
  с реальными deps, source of truth размывается.

### Consequences

- В `DEPENDENCIES.md` — список разрешённых зависимостей с
  примерами use cases. Источник: `templates/vite-react/package.json`.
- В `LIMITATIONS.md` — что точно не поддерживается + конкретные
  user-facing сообщения для случаев когда LLM сгенерировал
  unsupported код (build error → human-readable хелп).
- В `BUILD_PIPELINE.md` раздел «Validation»: что мы делаем когда
  билд падает на unsupported import (например импорт `express`
  в SPA-проекте → понятное сообщение, а не просто esbuild stderr).
- Дополнение к ADR-003: для static-режима system-prompt включает
  ARCHITECTURE CONSTRAINT блок; для sandbox-режима — нет.

---

## ADR-011: Build orchestration — in-memory queue + SSE для UI

**Status**: accepted
**Date**: 2026-04-27

### Context

ADR-001 решил «когда триггерить билд» (end-of-turn). Сейчас решаем
«как» — синхронно в request-thread или отдельный воркер.

### Decision

**Background worker внутри процесса билдера: in-memory очередь +
SSE endpoint для UI.**

- В процессе билдера живёт singleton `BuildQueue` (HMR-safe, тот же
  паттерн что у sandbox/proxy/git provider singleton'ов).
- `chat/route.ts` `onFinish` делает **non-blocking enqueue**:
  `buildQueue.enqueue({projectId, reason: "turn-finished"})` и
  закрывает стрим к фронту немедленно. Не дожидается завершения
  билда.
- UI после получения финального чата подписывается на SSE
  `/api/projects/<projectId>/build-status` — получает события
  `queued` / `running` / `succeeded` / `failed` / `cancelled`.
- Воркер queue'и крутится как `setInterval`/loop в том же процессе,
  выполняет следующий job через `previewProvider.build()` (который
  делает `docker run`).

#### Никаких отдельных процессов / Redis / BullMQ

Single-instance билдер (см. ADR-006) → нет необходимости в
distributed queue. Простой in-memory с persistence через scratch dir
(если процесс упал — incoming turn перезапишет файлы, при следующем
турне снова enqueue). State queue не сохраняется между restart'ами,
это feature: упавшая очередь не плодит зомби-билды.

### Alternatives

- **Синхронно в request-thread** — `onFinish` await'ит build. Стрим
  закрывается только после билда. Отвергнуто: 3–10 секунд turn'а LLM
  не отдаёт результат пользователю, плохой UX, плюс HTTP-таймауты.
- **Отдельный worker-процесс / Redis queue** — отвергнуто: для
  single-instance overkill, мы не масштабируемся горизонтально на
  MVP.

### Consequences

- В `lib/preview/build-queue.ts` (новый файл) — singleton.
- В `lib/preview/provider-singleton.ts` — singleton `PreviewProvider`,
  который queue использует.
- В `app/api/projects/[id]/build-status/route.ts` — SSE endpoint.
  Стрим читает события из queue'и (queue экспортит EventEmitter-like
  API: `subscribe(projectId, listener)` / `unsubscribe`).
- В `BuildQueue` контракте: `enqueue`, `cancel`, `subscribe`,
  `getStatus`. Точные сигнатуры — `CONTRACTS.md`.
- `chat/route.ts` `onFinish` обновляется: после batch-commit делает
  `buildQueue.enqueue()` и **не** await'ит результат.
- Persistent state queue не нужен — scratch dir всегда в актуальном
  состоянии (см. ADR-006), при перезапуске билдера потерявшийся
  in-flight job просто пропадёт; следующий turn LLM поставит новый.
- В `OPEN_QUESTIONS.md`: что показывать в SSE-стриме при перезапуске
  билдера (no-op? «соединение потеряно»? автопересоединение?).

---

## ADR-012: Concurrency — cancel + replace, max 1 running + 1 queued

**Status**: accepted
**Date**: 2026-04-27

### Context

Что делать когда новые билды приходят пока текущий идёт? LLM может
завершить два turn'а подряд, пользователь жмёт Rebuild многократно,
manual rebuild может пересечься с end-of-turn.

### Decision

**Единая стратегия: cancel + replace**, с инвариантом
**максимум 1 running + 1 queued** на проект.

#### Семантика

- При `enqueue({projectId})`:
  - Если для `projectId` нет ничего в работе → ставится в running,
    сразу запускается.
  - Если есть running + нет queued → новый job становится queued,
    `cancel(running)` отправляется немедленно. Когда running получает
    SIGKILL и завершается (`docker kill <containerId>`) — queued
    становится running.
  - Если есть running + queued → **новый job заменяет queued**
    (старый queued просто отбрасывается, его SSE-подписки получают
    `superseded` событие). Cancel running'а уже отправлен ранее —
    не дублируется.

То есть инвариант поддерживается: на проекте не может быть >2 jobs
в системе. Третий запрос «съедает» предыдущий queued.

#### Debounce для UI Rebuild

UI-кнопка «Rebuild» имеет client-side debounce ~500 мс — пользователь
не может нажать 10 раз за секунду и положить очередь cancel'ами.
End-of-turn enqueue (от LLM) debounce не нужен — он уже редкий по
определению.

#### Cancel mechanic

`cancel(job)` шлёт `docker kill <containerId>` через dockerode
(SIGTERM с graceful timeout 2 с → SIGKILL). После завершения
контейнера build-runner'а — статус `cancelled` в SSE, артефакт
не пишется (мы пишем в `builds/<timestamp>/`, при cancel — частичную
директорию удаляем).

### Alternatives

- **Per-project lock (FIFO)** — простое, но второй turn LLM ждёт
  пока первый build закончится. Отвергнуто: устаревшие билды, пустая
  трата ресурсов и ожидания.
- **Coalesce без cancel** — отбрасываем новый запрос если уже есть
  queued. Отвергнуто: при cancel + replace последний build всегда
  актуальный по содержимому scratch dir, что критично — cancel
  спасает несколько секунд compute.

### Consequences

- В `BuildQueue` контракте: `enqueue` возвращает `{jobId, status}`.
  Если запрос вытеснил предыдущий queued → SSE подписчики старого
  получают `superseded`.
- `previewProvider.build()` теперь принимает `AbortSignal` и
  пробрасывает его в dockerode (`container.kill()`).
- В `BUILD_PIPELINE.md` — раздел «Concurrency и cancel»: SIGTERM/SIGKILL
  таймауты, чистка частичных артефактов в `builds/<timestamp>/`,
  поведение SSE-стрима.
- В `CONTRACTS.md` — `BuildJob` и `BuildJobStatus` enum:
  `queued | running | succeeded | failed | cancelled | superseded`.
- В `OPEN_QUESTIONS.md`: точные таймауты SIGTERM grace period,
  поведение если cancel завис (двойной SIGKILL?), что попадает в
  audit-log.

---

## ADR-013: JSX-only для frontend, TS только в `functions/`

**Status**: accepted (refined в раунде 6)
**Date**: 2026-04-27

### Context

Текущий `templates/vite-react/` — JSX без TypeScript (`jsconfig.json`,
`*.jsx`). Решение шло от ограничений Docker-VM (SWC binary). В static
этого ограничения нет — можно мигрировать на TS, можно оставить JSX.

### Decision

**Frontend (`src/**`) — JSX без TypeScript.** Файлы LLM пишет как
`*.jsx` / `*.js`. Это применяется к UI-коду, который ходит в
бандл `vite build`'а.

**Серверные/edge-функции (`functions/**`) — TypeScript (`*.ts`).**
LLM пишет их как Deno-style serverless handlers (см. структуру в
`docs/preview-provider/research/example-base44/functions/`).
Эти файлы **не входят** в Vite bundle; они хранятся в scratch dir
и попадают в Gitea вместе с frontend'ом, а в рантайме исполняются
будущей BaaS-интеграцией (см. OPEN_QUESTIONS — Appwrite-аналог).

`@types/*` + `typescript` пакеты **остаются** в boilerplate'е —
они нужны для (а) IDE-typecheck'а функций, (б) будущего BaaS-deploy
конвейера. На MVP они **не выполняются** в build pipeline (functions
не билдятся), но присутствуют для разработки.

Обоснование:
- Frontend остаётся JSX: продукт целится в клиентские SPA
  (лендинги, TODO, калькуляторы) — типобезопасность не критична для
  UI; меньше токенов LLM, меньше source-of-failure билда.
- Functions — TypeScript: серверный код требует типов сильнее
  (контракт с BaaS-API, типизация request/response, лучшая
  поддержка LLM-генерации серверной логики).
- Это **гибрид**, но границы чёткие: расширение файла = режим.

### Alternatives

- **TypeScript для всего (включая src/)** — отвергнуто: дороже токены
  на UI-код, чаще ошибки билда от типов, не даёт product-выгод для
  целевой SPA-аудитории.
- **JSX для всего (включая functions/)** — отвергнуто: серверный
  код выигрывает от типов сильнее, чем UI; LLM пишет API-handler'ы
  чище с TypeScript.

### Consequences

- В `BOILERPLATE.md` — структура шаблона разделяет `src/` (JSX) и
  `functions/` (TS), фиксирует whitelist и tsconfig для functions.
- В `DEPENDENCIES.md` — `typescript`, `@types/node`, `@types/react`,
  `@types/react-dom` **присутствуют** в devDependencies.
- В `ADR-007` (assets whitelist) — добавляется `functions/**/*.ts`
  в writable paths.
- В `ADR-019` — TS-deps больше **не** strip'аются.
- В `system-prompt.ts` static-вариант — упоминает что
  «UI код пишется в `src/` как JSX, серверные функции — в
  `functions/` как TypeScript Deno-handler'ы».
- На MVP `functions/**` **не билдятся** (Vite их не трогает) и **не
  деплоятся**; они существуют как файлы в scratch dir + Gitea-репо.
  Реализация рантайма — после BaaS-интеграции, отдельная задача.
- В `LIMITATIONS.md` — явно: «functions/ доступны как файлы, но не
  исполняются на MVP — поддержка ожидается с BaaS-интеграцией».
- В `BUILD_PIPELINE.md` — `functions/` не входит в build-mounts
  build-runner'а (только `src/`, `public/`).

---

## ADR-014: Public URL — capability-driven `PreviewMetadata`

**Status**: accepted
**Date**: 2026-04-27

### Context

Sandbox-режим возвращает три URL (preview + 2 терминала). Static
имеет только preview. Нужен общий контракт без мнимой совместимости.

### Decision

**`PreviewMetadata` — общий тип возврата `PreviewProvider.create()`**:

```ts
interface PreviewMetadata {
  projectId: string;
  previewUrl: string;             // всегда есть
  terminalUrls?: {                // только sandbox-режим
    devCommand: string;
    additional: string;
  };
  capabilities: PreviewCapabilities;  // см. ADR-015
}
```

URL формат:
- **static**: `<projectId>.preview.<base>` — один хост на проект.
  Caddy роутит file_server на `/data/static/<projectId>/current/`.
- **sandbox**: остаётся существующая 3-хостная схема
  (`<sandboxId>.preview.<base>` + `dev-command-<sandboxId>...` +
  `terminals-<sandboxId>...`). `terminalUrls` заполнено.

В static-режиме `terminalUrls` отсутствует → UI не рисует панели
терминалов. Условный рендер на стороне UI.

Существующий `VmRuntimeMetadata` остаётся **внутренним** типом
sandbox-провайдера. На границе `PreviewProvider` он адаптируется в
`PreviewMetadata` (`vmId` → `projectId`, остальные URL в опциональный
блок).

### Alternatives

- **Один хост `<id>.preview.<base>` для обоих режимов** — отвергнуто:
  ломает sandbox-режим (теряет терминальные URL'ы).
- **Тот же 3-хостный API с 404 на терминалах в static** — отвергнуто:
  мнимая совместимость, UI ходит к non-existent endpoint'ам.

### Consequences

- В `CONTRACTS.md` — точная сигнатура `PreviewMetadata` с TSDoc.
- В `app/api/repos/route.ts` — возвращаемый JSON в новом формате;
  существующий `VmRuntimeMetadata` мапится на лету.
- В UI: смотрит на `metadata.terminalUrls` — рисует панели только
  если есть.
- В `proxy-caddy.ts` появляется `addRoute` с типом `file_server`
  (см. ADR-004) для static-режима. Существующий `reverse_proxy` —
  для sandbox.

---

## ADR-015: Capabilities — hybrid (provider declares, RepoMetadata pins)

**Status**: accepted
**Date**: 2026-04-27

### Context

Capability-driven архитектура (ADR-003, ADR-010) требует знать «что
доступно для проекта». Где capabilities живут.

### Decision

**Hybrid: `PreviewProvider` декларирует свои capabilities, но при
создании проекта они зашиваются в `RepoMetadata`.**

```ts
// Контракт PreviewProvider:
interface PreviewProvider {
  name: "static" | "sandbox";
  capabilities: PreviewCapabilities;  // фиксированные для провайдера
  // ... + create/build/destroy/...
}

// При создании проекта:
const repo = await createRepo({...});
const preview = await previewProvider.create({repoId: repo.id});
const metadata: RepoMetadata = {
  ...repo,
  preview: {
    provider: previewProvider.name,
    capabilities: previewProvider.capabilities,  // pinned
    createdAt: new Date().toISOString(),
  },
};
```

Когда позже глобальный `PREVIEW_PROVIDER` меняется (например static →
sandbox), **существующие проекты остаются на своём провайдере** до
**явной миграции** через инструмент аналогичный boilerplate-миграции
(ADR-008). Свежесозданные проекты получают новый default.

#### Какие capabilities

```ts
interface PreviewCapabilities {
  /** LLM может выполнять shell-команды в среде. */
  shellAccess: boolean;
  /** Поддержка кастомных npm-зависимостей сверх boilerplate. */
  customDependencies: boolean;
  /** Поддержка серверного рантайма (API routes / server actions). */
  serverRuntime: boolean;
  /** Поддержка живого HMR (без full rebuild). */
  hotReload: boolean;
  /** Manual rebuild по запросу пользователя/LLM (см. ADR-001). */
  manualRebuild: boolean;
}

// static:
{ shellAccess: false, customDependencies: false, serverRuntime: false,
  hotReload: false, manualRebuild: true }

// sandbox:
{ shellAccess: true, customDependencies: true, serverRuntime: true,
  hotReload: true, manualRebuild: true }
```

`createTools(handle, {capabilities})` смотрит сюда и выдаёт нужный
toolset (см. ADR-003). `getSystemPrompt(capabilities)` ветвится
аналогично (ADR-010 ARCHITECTURE CONSTRAINT блок).

### Alternatives

- **Только на провайдере** (a) — отвергнуто: при глобальной смене
  провайдера старые проекты внезапно теряют/получают возможности
  без явного действия пользователя; разрушает предсказуемость.
- **Только в RepoMetadata** (b) — отвергнуто: дублирует логику
  «default capabilities при создании», провайдер всё равно
  единственный источник правды.

### Consequences

- В `CONTRACTS.md` — `PreviewCapabilities` interface, `PreviewProvider.capabilities`
  как readonly, `RepoMetadata.preview` поле с pinned копией.
- В `RepoMetadata` миграция: для существующих проектов (на момент
  включения static) capabilities seed'ятся из текущего провайдера
  при первом обращении. Идемпотентно.
- При переключении провайдера в env — UI/LLM продолжают видеть старые
  capabilities проекта; для миграции нужен инструмент (skript/voider /
  endpoint), как в ADR-008. Запись в `MIGRATION_PATH.md`.
- В `CONTRACTS.md` — расширение `RepoMetadata` (там сейчас
  `boilerplateVersion` из ADR-008; добавляется `preview` блок).
- В `OPEN_QUESTIONS.md`: что делать когда provider'а из metadata
  больше нет в системе (например `static` deprecated и удалён) —
  fallback на текущий default? error? UI prompt?

---

## ADR-016: Build-cache — подкаталог в scratch dir

**Status**: accepted
**Date**: 2026-04-27

### Context

ADR-009 ввёл build-cache между билдами одного проекта без конкретики
по хранению. Два варианта: per-project named Docker volume или
подкаталог в scratch dir.

### Decision

**Подкаталог `/data/projects/<projectId>/.vite/`**, монтируется
bind'ом в build-runner как RW.

Также `/data/projects/<projectId>/.cache/` зарезервирован под
другие per-project caches (esbuild, postcss и т.п.) если понадобятся
в будущем.

### Alternatives

- **Per-project named Docker volume** `adorable_build_cache_<projectId>` —
  отвергнуто: лишний volume на проект, отдельный cleanup, не даёт
  выгод в single-instance модели.

### Consequences

- Build-runner mounts: добавляется `-v /data/projects/<id>/.vite:/workspace/.vite:rw`
  в схему из ADR-005.
- При `PreviewProvider.destroy(projectId)` — `rm -rf /data/projects/<id>`
  чистит и cache (один путь, один cleanup; см. ADR-006).
- В `BUILD_PIPELINE.md` — раздел «Build cache» фиксирует структуру
  scratch dir как `src/`, `public/`, `.vite/`, `.cache/`. Стратегия
  инвалидации — Vite/esbuild сами managed; мы их не трогаем.
- Открытый вопрос: размер cache на длинных проектах. Если разрастётся —
  периодический `rm -rf .vite/` со cold rebuild. В `OPEN_QUESTIONS.md`.

---

## ADR-017: Имя метода — `PreviewProvider.create()`, не `initialize()`

**Status**: accepted
**Date**: 2026-04-27

### Context

Существующие провайдеры (`SandboxProvider`, `GitProvider`) используют
`create(opts) → Handle`. Для `PreviewProvider` под static-режимом
«создание» — это подготовка scratch dir + регистрация Caddy-роута,
не создание контейнера/репо. Семантически ближе `initialize`.

### Decision

Используем **`create(opts) → PreviewMetadata`** для согласованности
с другими провайдерами форка.

### Consequences

- В `CONTRACTS.md` метод называется `create()`.
- `ARCHITECTURE.md` обновляется: все упоминания `initialize` →
  `create`.
- В `repos/route.ts`: `previewProvider.create({repoId})`.

---

## ADR-018: BuildResult — структурированные ошибки + raw fallback

**Status**: accepted
**Date**: 2026-04-27

### Context

Open question #1: что возвращает `getBuildLogsTool` LLM'у. Сырой
stderr/stdout vs распарсенный список ошибок.

### Decision

**Гибрид**: `BuildResult` всегда содержит сырые stdout/stderr +
структурированный `errors[]` + `warnings[]`, заполняемый best-effort
парсером для популярных классов ошибок.

```ts
type BuildErrorCode =
  | "module-not-found"      // esbuild: Could not resolve "X"
  | "import-not-allowed"    // module-not-found + module в нашем denylist
  | "syntax-error"          // esbuild syntax errors
  | "transform-error"       // плагин Vite/esbuild упал
  | "config-error"          // проблема в vite.config / postcss
  | "unknown";              // не распарсено

interface BuildError {
  code: BuildErrorCode;
  message: string;          // human-readable
  file?: string;            // относительный путь в /workspace/
  line?: number;
  column?: number;
  snippet?: string;         // 3-5 строк контекста, если есть
  // дискриминирующие поля по code:
  missingModule?: string;   // для module-not-found / import-not-allowed
  suggestion?: string;      // для import-not-allowed: «используйте Y вместо X»
  raw?: string;             // оригинальная строка из stderr (для отладки)
}
```

#### Парсер

Живёт в `adorable/lib/preview/build-error-parser.ts`. Принимает
`{stdout, stderr, projectFiles}` → `BuildError[]`. Реализация:

1. Регэкспы под известные сообщения (esbuild «Could not resolve»,
   «Expected ... but found ...», Vite «Cannot find package»).
2. Для `module-not-found` — проверка против `AVAILABLE_DEPS.md` (если
   модуль не в списке → trans-form в `import-not-allowed` с
   suggestion'ом из таблицы синонимов где возможно).
3. Если ничего не распарсено → один элемент `{code: "unknown",
   message: stderr.slice(0, 2000)}`.

Парсер **best-effort**: при изменении версии esbuild/vite если регэксп
сломается — fallback'ом будет `unknown`. Это acceptable degradation.

#### `getBuildLogsTool` контракт

```ts
{
  name: "getBuildLogs",
  result: {
    status: BuildJobStatus,
    durationMs: number,
    artifactPath?: string,    // если success
    errors: BuildError[],     // [] если success
    warnings: BuildWarning[], // [] если нет
    stdout: string,           // raw, обрезанный по N KB
    stderr: string,           // raw, обрезанный по N KB
  }
}
```

Лимит на размер stdout/stderr (например 16 KB на каждый) — защита
от over-stuffed контекста LLM. Лимит конфигурируется env'ом
`BUILD_LOG_MAX_BYTES` (default 16384).

### Alternatives

- **Только raw stdout/stderr** — отвергнуто: LLM тратит токены и
  внимание на парсинг ошибок, упускает паттерны типа «import не из
  AVAILABLE_DEPS».
- **Только структурированно** — отвергнуто: парсер не покрывает 100%
  кейсов, без fallback'а LLM получает пустой результат на edge-case.

### Consequences

- В `CONTRACTS.md` — точные TS-определения `BuildError`,
  `BuildWarning`, `BuildResult`.
- В `lib/preview/build-error-parser.ts` (новый файл) — парсер с unit-
  тестами на корпусе примеров stdout/stderr.
- В `lib/preview/available-deps.ts` (новый файл) — табличка
  «AVAILABLE_DEPS + suggestions», источник правды для парсера.
  Генерируется из `templates/vite-react/package.json` + ручной
  таблицы synonyms (`lodash → встроенные методы Array.prototype`,
  `axios → fetch`, и т.д.).
- В `BUILD_PIPELINE.md` — раздел «Парсинг ошибок» с примерами
  стандартных стрингов.
- В `OPEN_QUESTIONS.md`: какие ещё классы ошибок добавлять в
  `BuildErrorCode` (например `out-of-memory`, `tailwind-class-not-found`).

---

## ADR-019: Состав зависимостей `templates/vite-react/` — battery-included из base44

**Status**: accepted (с оговоркой по TS — см. Consequences)
**Date**: 2026-04-27

### Context

Решено (Q17) брать список зависимостей из `example/` (base44-style),
чтобы получить максимальное покрытие типичных use-case'ов нашей
аудитории (лендинги, TODO, калькуляторы, демо UI, портфолио,
дашборды).

### Decision

Зависимости `templates/vite-react/` берутся из base44-копии **с
явными strip'ами**:

#### Принято в `dependencies`

```
@hello-pangea/dnd            ^17.0.0
@hookform/resolvers          ^4.1.2
@radix-ui/react-accordion       ^1.2.3
@radix-ui/react-alert-dialog    ^1.1.6
@radix-ui/react-aspect-ratio    ^1.1.2
@radix-ui/react-avatar          ^1.1.3
@radix-ui/react-checkbox        ^1.1.4
@radix-ui/react-collapsible     ^1.1.3
@radix-ui/react-context-menu    ^2.2.6
@radix-ui/react-dialog          ^1.1.6
@radix-ui/react-dropdown-menu   ^2.1.6
@radix-ui/react-hover-card      ^1.1.6
@radix-ui/react-label           ^2.1.2
@radix-ui/react-menubar         ^1.1.6
@radix-ui/react-navigation-menu ^1.2.5
@radix-ui/react-popover         ^1.1.6
@radix-ui/react-progress        ^1.1.2
@radix-ui/react-radio-group     ^1.2.3
@radix-ui/react-scroll-area     ^1.2.3
@radix-ui/react-select          ^2.1.6
@radix-ui/react-separator       ^1.1.2
@radix-ui/react-slider          ^1.2.3
@radix-ui/react-slot            ^1.1.2
@radix-ui/react-switch          ^1.1.3
@radix-ui/react-tabs            ^1.1.3
@radix-ui/react-toast           ^1.2.2
@radix-ui/react-toggle          ^1.1.2
@radix-ui/react-toggle-group    ^1.1.2
@radix-ui/react-tooltip         ^1.1.8
@stripe/react-stripe-js      ^3.0.0
@stripe/stripe-js            ^5.2.0
@tanstack/react-query        ^5.84.1
canvas-confetti              ^1.9.4
class-variance-authority     ^0.7.1
clsx                         ^2.1.1
cmdk                         ^1.0.0
date-fns                     ^3.6.0
embla-carousel-react         ^8.5.2
framer-motion                ^11.16.4
html2canvas                  ^1.4.1
input-otp                    ^1.4.2
jspdf                        ^4.0.0
jszip                        ^3.10.1
lodash                       ^4.17.21
lucide-react                 ^0.475.0
moment                       ^2.30.1
next-themes                  ^0.4.4
react                        ^18.2.0
react-day-picker             ^8.10.1
react-dom                    ^18.2.0
react-hook-form              ^7.54.2
react-hot-toast              ^2.6.0
react-leaflet                ^4.2.1
react-markdown               ^9.0.1
react-quill                  ^2.0.0
react-resizable-panels       ^2.1.7
react-router-dom             ^6.26.0
recharts                     ^2.15.4
sonner                       ^2.0.1
tailwind-merge               ^3.0.2
tailwindcss-animate          ^1.0.7
three                        ^0.171.0
uuid                         ^9.0.0
vaul                         ^1.1.2
zod                          ^3.24.2
```

#### Принято в `devDependencies`

```
@vitejs/plugin-react   ^4.3.4
autoprefixer           ^10.4.20
postcss                ^8.5.3
tailwindcss            ^3.4.17
vite                   ^6.1.0
```

#### Принято в `devDependencies` (дополнительно — TS для functions/)

ADR-013 (раунд 6 refinement) фиксирует: TS остаётся для `functions/**`.
Поэтому возвращаются:

```
typescript        ^5.8.2
@types/node       ^22.13.5
@types/react      ^18.2.66
@types/react-dom  ^18.2.22
```

Они нужны для (а) IDE-typecheck'а функций, (б) будущего BaaS-deploy
pipeline. На MVP build-runner их **не использует** (`vite build` идёт
только по `src/`, который JSX). Запуск `tsc --noEmit functions/**/*.ts`
как отдельный pipeline-этап — открытый вопрос (вне scope MVP).

#### Strip'нуто (с обоснованием)

| Пакет                          | Группа          | Причина strip                                       |
|--------------------------------|-----------------|-----------------------------------------------------|
| `@eslint/js`                   | devDeps         | В нашем build pipeline нет lint-этапа (см. BUILD_PIPELINE.md). Мёртвый вес. |
| `eslint`                       | devDeps         | То же.                                              |
| `eslint-plugin-react`          | devDeps         | То же.                                              |
| `eslint-plugin-react-hooks`    | devDeps         | То же.                                              |
| `eslint-plugin-react-refresh`  | devDeps         | То же.                                              |
| `eslint-plugin-unused-imports` | devDeps         | То же.                                              |
| `globals`                      | devDeps         | Используется только eslint-конфигом — strip'ается с eslint. |
| `baseline-browser-mapping`     | devDeps         | Не используется build pipeline (Vite сам определяет browserslist'ом). |

### Замеченные риски (не блокеры, но стоит понимать)

- **`three` (~600 KB gzip)** — самый тяжёлый пакет в списке.
  Потянется в bundle если LLM сгенерирует 3D-сцену; tree-shaking
  для `three` ограничен (он сам по себе монолит). Для типичного
  лендинга/TODO он будет dead weight. Открыто: считаем ли допустимым
  иметь его в boilerplate'е.
- **`react-leaflet` + `leaflet`** — карты. ~120 KB gzip.
  Аналогично: dead weight для проектов без карт. **NB**: в base44
  списке только `react-leaflet`, без peer-dependency `leaflet`.
  Если оставляем — добавить `leaflet` сам в deps. → OPEN_QUESTIONS.
- **`react-quill`** — известны peer-dep issues с React 18+; на
  React 19 не работает. На React 18 (наш выбор) — OK.
- **`moment`** — deprecated. У нас уже есть `date-fns`. → дублирование.
  Кандидат на strip в следующей итерации.
- **`lodash`** (CJS, ~70 KB gzip) — у `lodash-es` лучше tree-shaking.
  Кандидат на замену в следующей итерации.
- **Точные версии React/Vite** — base44 указывает `react@18.2.0`,
  `vite@6.1.0`. Текущий шаблон `react@18.3.1`, `vite@5.4.8`.
  Решение: берём базовые **минорки base44** (^18.2.0, ^6.1.0); на
  install подтянутся свежие patches.

### Strip-policy на будущее

`templates/vite-react/package.json` — единственный источник правды.
Любое изменение списка (добавить, удалить, обновить minor) — это
**version bump boilerplate'а** (ADR-008) с миграционным воркером
по всем существующим проектам.

### Alternatives

- **Минимальный набор (текущий: 7 deps)** — отвергнуто: LLM приходится
  генерировать UI-примитивы руками; качество страдает.
- **Полный base44 без strip'ов** — отвергнуто: TS-deps конфликтуют
  с ADR-013, eslint-deps мёртвый вес.

### Consequences

- В `templates/vite-react/package.json` — обновлённый список (см. выше).
- В `templates/vite-react/AVAILABLE_DEPS.md` — генерируется из этого
  списка + ручной таблицы synonyms (см. ADR-018, `lib/preview/available-deps.ts`).
  Это используется в system-prompt и парсере ошибок.
- В Dockerfile build-runner'а — `pnpm install --frozen-lockfile` на
  всём списке. Существенно увеличивает размер named volume
  (~250 MB → ~600 MB по предварительной оценке). Это acceptable
  цена за coverage.
- В `DEPENDENCIES.md` — раздел «Тиры зависимостей»: что используется
  часто (lucide, radix, react-router), что редко (three, leaflet).
- Init-volume скрипт работает дольше — `pnpm install` на 60+ deps
  ~90 сек вместо ~15. Делается один раз при сборке образа.
- В `OPEN_QUESTIONS.md`:
  - Решение по `three` / `react-leaflet` / `react-quill` /
    `moment` / `lodash` — оставлять или strip'нуть в следующем
    bump'е.
  - Lint в pipeline — нужен ли (отдельная фича, не блокер).

#### Резолюция по TypeScript (раунд 6)

ADR-013 уточнён в раунде 6: frontend `src/` остаётся JSX, но
`functions/**` — TypeScript. Поэтому `typescript` + `@types/*`
**возвращаются** в devDependencies. Strip больше не применяется к
ним.

---

## ADR-020: `example/` → `docs/preview-provider/research/example-base44/`

**Status**: accepted
**Date**: 2026-04-27

### Context

В корне репо лежал `example/` — копия base44-шаблона, в коде на
неё никто не ссылался. С учётом того что её состав фактически стал
исходником ADR-019 — она имеет ценность как **референс**, не как
часть продукта.

### Decision

Перемещён в `docs/preview-provider/research/example-base44/`.
Там же будут жить будущие research-снепшоты (например, аналоги для
Vue/Svelte когда дойдём до multi-framework).

### Consequences

- В `docs/preview-provider/research/` создан подкаталог
  `example-base44/` с полным содержимым старого `example/`.
- Корень репо очищен от untracked `example/`.
- Будущие research-материалы кладутся туда же.

---

## ADR-021: `functions/` директория — TypeScript edge-handler'ы, не билдятся на MVP

**Status**: accepted
**Date**: 2026-04-27

### Context

Раунд 6 уточнил: помимо JSX-frontend в `src/`, в проектах живут
TypeScript-функции в `functions/**/*.ts`. По форме — Deno-style
edge handler'ы (см. `docs/preview-provider/research/example-base44/functions/`),
исполняемые в будущем BaaS-рантайме (Appwrite Functions / аналог).

На MVP их **рантайм не реализован**, но файлы должны
существовать в репо чтобы:
1. LLM мог их генерировать (продуктовая фича — UI типа «добавить
   API endpoint»).
2. При появлении BaaS-интеграции они мгновенно становятся
   рабочими — без миграции структуры репо.

### Decision

#### Расположение

```
adorable/templates/vite-react/
├── functions/                       ✏️ USER — LLM пишет TS handlers
│   └── (пусто на MVP, юзер добавляет)
└── functions/tsconfig.json          ⭐ ФИКС — TS-конфиг под Deno-runtime
```

`functions/tsconfig.json` — отдельный tsconfig **только** для папки
`functions/`. Корневой проект остаётся на `jsconfig.json` для Vite
(JSX, alias `@/`). Пример конфига:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["es2022", "dom"],
    "types": ["@types/node"]
  },
  "include": ["**/*.ts"]
}
```

#### Lifecycle на MVP

- LLM пишет файлы через `writeFileTool` (whitelist расширен —
  ADR-007).
- Файлы попадают в scratch dir `/data/projects/<id>/functions/` и
  далее в Gitea при batch-commit.
- `vite build` **не трогает** `functions/` — bind-mount RO в
  build-runner есть только для `src/` и `public/`.
- Никакого typecheck'а в pipeline (на MVP). Это compromise: LLM
  может оставить тип-баги, они проявятся только при BaaS-deploy.
  Если станет проблемой — добавим `tsc --noEmit functions/**/*.ts`
  как отдельный validation-step.

#### Rasporyaqdok после BaaS-интеграции (out of scope MVP)

Когда (если) появится BaaS-провайдер:
- Новый `DeployProvider` (или расширение `PreviewProvider`) принимает
  `functions/**/*.ts` и публикует на BaaS endpoint.
- В `RepoMetadata.preview` добавляется поле `functionsDeployedAt`
  и список published-функций.
- Capabilities обновляется: `serverRuntime: true` через BaaS,
  без изменения static-режима для frontend.

### Alternatives

- **`functions/` в JS** — отвергнуто: серверный код выигрывает
  от типов; LLM генерирует чище.
- **Не вводить `functions/` на MVP вовсе, добавить с BaaS позже** —
  отвергнуто: пользователь хочет иметь возможность писать функции
  заранее (хранить, версионировать), даже если рантайм появится
  позже.
- **Один общий tsconfig.json для всего проекта** — отвергнуто:
  ломает Vite's JSX-only режим в `src/`; разделение конфигов
  чище.

### Consequences

- В `BOILERPLATE.md` раздел структуры — `functions/` отдельная USER-
  директория, `functions/tsconfig.json` фиксированный.
- В `template-seeder.ts` IGNORED_ENTRIES добавляется
  `functions/tsconfig.json` (не копируется в scratch dir, остаётся
  в build-runner image как фиксация). Сама `functions/` копируется
  пустой при `previewProvider.create()`.
- В `CONTRACTS.md` `isWritablePath` — `functions/**/*.ts` разрешено,
  `functions/tsconfig.json` запрещено.
- В `BUILD_PIPELINE.md` mounts остаются как есть (no functions in
  build-runner). Явно отмечено что `functions/` не билдится.
- В `system-prompt.ts` (static вариант) — упоминание о `functions/`
  и Deno-style API; что не выполняется на MVP, но будет позже.
- В `LIMITATIONS.md` — explicit: «functions написаны но не
  исполняются на MVP».
- В `OPEN_QUESTIONS.md`:
  - Точная BaaS-интеграция (Appwrite vs альтернативы).
  - Нужен ли `tsc --noEmit functions/**/*.ts` step в build pipeline
    как best-effort валидация (даже без runtime).
  - Как функции вызываются из frontend'а на MVP — простой
    `fetch('/api/<name>')` placeholder, который ничего не делает,
    или явный сигнал «не работает пока»?

---

## ADR-022: `PreviewProvider.create()` идемпотентен по `repoId`

**Status**: accepted (резолюция ASSUMPTIONS.md H1)
**Date**: 2026-04-29

### Decision

Повторный вызов `create({repoId})` с уже существующим `repoId` —
**не ошибка**, не создаёт дубликат, возвращает существующее
`PreviewMetadata`. Полезно для crash recovery: при рестарте билдера
`repos/route.ts` может безусловно дёргать `create()`, провайдер сам
определит «уже существует».

### Consequences

- В `CONTRACTS.md` §5 — `create()` явно помечен идемпотентным
  (формулировка «повторный вызов с тем же `repoId` НЕ создаёт
  дубликат — возвращает существующее `PreviewMetadata`» — уже там).
- Реализация `preview-static.ts.create()`: проверить наличие
  `/data/projects/<repoId>/`; если есть и Caddy-роут активен —
  hydratить metadata из RepoMetadata + return.
- Реализация `preview-sandbox.ts.create()`: делегирует
  `sandboxProvider.ref({sandboxId})` если sandbox существует.

---

## ADR-023: Initial preheat build при `create()`

**Status**: accepted (резолюция ASSUMPTIONS.md H2)
**Date**: 2026-04-29

### Decision

При `previewProvider.create({repoId})` сразу делается
`buildQueue.enqueue({reason: "initial"})`. Пользователь моментально
видит preview без ожидания первого LLM-turn'а.

### Sequencing concerns

До завершения первого билда `current` симлинка ещё нет — Caddy
file_server отдаст 404. Решение:

1. При первом `previewProvider.create()` сразу создаётся
   `/data/static/<id>/builds/seed/` — это **prebuilt index.html**
   из template'а (заглушка «Готовим ваш проект...» с auto-refresh
   через 3 секунды).
2. `current` симлинк сразу указывает на `seed/` — Caddy отдаёт
   эту заглушку.
3. Initial билд по завершении заменяет `current` атомарно (как
   обычно).
4. Если initial билд упал — `current` остаётся на `seed/`,
   пользователь видит «Подготовка не удалась, нажмите Rebuild»
   через UI overlay.

`seed/` — единственный артефакт без шага Vite-билда; готовится
наперёд и кладётся в build-runner image.

### Consequences

- В `BUILD_PIPELINE.md` — добавить раздел про `seed/` placeholder.
- В Dockerfile build-runner'а — копировать pre-baked
  `seed-index.html` в образ, доступный через bind/copy при `create()`.
- В `preview-static.create()`: создать `builds/seed/` симлинком на
  это же место (или копированием), `current → seed`, потом enqueue.
- Open question: кто рендерит «Подготовка не удалась» overlay при
  failed initial — UI smart-detect'ит по seed-content или Caddy
  отдаёт спец-страницу. Default: UI smart-detect через `<meta>` тег
  `<meta name="adorable-state" content="seed">` в seed-index.html.

---

## ADR-024: Разрешаем `*.ts/*.tsx` в `src/` — Vite их сам processит

**Status**: accepted (резолюция ASSUMPTIONS.md H3 — refines ADR-013)
**Date**: 2026-04-29

### Decision

ADR-013 (раунд 6) разделял: `src/` — JSX, `functions/` — TS. Раунд 7
показал риск: LLM натренирован на TypeScript и постоянно создаёт
`Foo.tsx`, получая `path-not-writable` reject — UX страдает,
LLM-токены расходуются на retry.

**Whitelist для `src/**` расширяется на `*.ts` и `*.tsx`**.
Vite + esbuild сами умеют процессить `.tsx` без TypeScript-конфига
(они трактуют файлы по расширению). Никаких правок vite.config.js
не требуется. Тип-проверки **не делается** — это as-is JSX-mode,
просто с альтернативными расширениями.

### Practical impact

- LLM может писать `Foo.tsx`, `bar.ts`, `Foo.jsx`, `bar.js` — все
  работают.
- Тип-аннотации в TS-файлах будут проигнорированы рантаймом (esbuild
  их strip'ает).
- `@types/*` в boilerplate'е (которые мы возвращали для `functions/`)
  теперь полезны и для IDE-typecheck `src/**/*.tsx` тоже.
- Никаких изменений в build pipeline — Vite уже это умеет.

### Whitelist обновление

`src/**/*.{ts,tsx,js,jsx,css,scss,html,json}` — все четыре
JS-расширения разрешены.

### Alternatives

- **Silent transcode `.tsx` → `.jsx`** — отвергнуто: добавляет
  middleware, где-то надо ронять типы, неочевидно. Vite справляется
  нативно.
- **Жёсткий reject** (текущий ADR-013) — отвергнуто: UX страдает.

### Consequences

- `CONTRACTS.md` §9 (`isWritablePath`) — regexp обновляется.
- ADR-013 уточняется: «JSX-only» означает «**без TypeScript-runtime
  валидации**», но расширения `.ts/.tsx` приемлемы. Functions-папка
  всё ещё standardised на `.ts`.
- `system-prompt.ts` static-вариант — упоминание «TypeScript types
  are stripped at build time, no runtime checking».
- В `LIMITATIONS.md` — обновить раздел 1.3.

---

## ADR-025: Promote-flow остаётся для static — `published` симлинк

**Status**: accepted (резолюция ASSUMPTIONS.md H4)
**Date**: 2026-04-29

### Context

В существующем форке есть `app/api/repos/[repoId]/promote/route.ts`
для перехода preview → published. На MVP я предполагал убрать promote
для упрощения; пользователь подтвердил что **promote-flow нужен**.

### Decision

Хранение для static расширяется ещё одним симлинком — `published`:

```
/data/static/<projectId>/
├── current        → builds/<latest-success>/      ← preview URL
├── previous       → builds/<previous-success>/    ← rollback
├── published      → builds/<promoted>/            ← stable URL (для шаринга)
├── builds/
│   ├── ...
```

#### Два URL на проект

- **Preview** — `<projectId>.preview.<base>` → file_server
  `/data/static/<projectId>/current/`. Обновляется на каждый
  successful build. Это рабочая среда LLM↔пользователь.
- **Published** — `<projectId>.<base>` (без «preview» поддомена) →
  file_server `/data/static/<projectId>/published/`. Обновляется
  **только** при явном `POST /api/repos/<id>/promote`. Это
  shareable «production» URL.

#### Promote API

`POST /api/repos/<repoId>/promote` (существующий endpoint
адаптируется):
1. Валидация: `current` симлинк существует и указывает на
   валидный `builds/<id>/`.
2. Atomic swap `published.tmp` → `published` (как `current` в ADR-004).
3. Запись в `RepoMetadata.publishedAt = now()`,
   `publishedBuildId = current target`.
4. Audit-log: `promote {projectId, fromBuildId, toBuildId, userId}`.

#### Caddy роуты

- При `previewProvider.create()` регистрируется **два** static-роута:
  - `<id>.preview.<base>` → `current/`
  - `<id>.<base>` → `published/`
- При первом `create()` оба симлинка указывают на `seed/` (ADR-023);
  `published` остаётся на `seed/` пока пользователь не сделает первый
  promote.

### Consequences

- `PreviewMetadata` (CONTRACTS.md §2) расширяется:
  ```ts
  publishedUrl: string;       // всегда есть, даже если ещё не promoted
  publishedAt?: string;       // ISO timestamp последнего promote
  ```
- `RepoMetadata.preview` (CONTRACTS.md §12):
  ```ts
  publishedAt?: string;
  publishedBuildId?: string;
  ```
- `ProxyProvider.addRoute` — два static-роута на проект.
- BUILD_HISTORY_LIMIT GC расширяется: кроме `current` и `previous`,
  защищается build, на который указывает `published`.
- `app/api/repos/[repoId]/promote/route.ts` — переписать под static
  (старый Freestyle-зависимый код заменяется).
- В `LIMITATIONS.md` 2.2 пересмотреть: custom domain mappings всё
  ещё out of scope, но базовый promote — есть.
- В `VERIFICATION.md` — добавить scenario «promote после iteration'ов».

---

## ADR-026: Functions — честный UX-gate в LLM-промпте

**Status**: accepted (резолюция ASSUMPTIONS.md H5 — refines ADR-021)
**Date**: 2026-04-29

### Context

ADR-021 разрешил LLM писать `functions/**/*.ts`, но не указал
явного UX когда пользователь просит «добавь backend-логику».
Вариант silent-allow (как было) → LLM пишет файлы, пользователь не
понимает почему `fetch('/api/foo')` 404'ит.

### Decision

**Честный gate в system-prompt'е (static-вариант)** — LLM явно
проинструктирован:

```
SERVER FUNCTIONS (functions/**/*.ts)
This project supports server-side functions in `functions/**/*.ts`,
but they DO NOT EXECUTE on this MVP. Files are stored, but no
runtime is connected yet.

If the user asks for backend logic:
1. Tell them clearly: "Server functions are not running yet on
   this MVP. They will work after our managed BaaS integration is
   connected. For now, I can:
     (a) Use localStorage / sessionStorage for client-side persistence.
     (b) Call existing public APIs via fetch.
     (c) Write the function file as a placeholder for future activation —
         it won't run until BaaS is connected."
2. Default to (a) or (b) unless user explicitly chooses (c).
3. If you write a function file, ALSO add a comment in the
   matching frontend code: "// TODO: this calls /api/<name>, but
   the function isn't running yet — uses mock data for now".
```

LLM-tool `writeFileTool` принимает запись в `functions/` (whitelist
не меняется), но system-prompt велит **сначала** обсудить с пользователем.

### Detection в frontend

Опционально: парсер при билде ищет `fetch('/api/...')` в `src/`;
если найдено — emit `BuildWarning` со ссылкой на functions gate.
Это **не блокирует** билд, только предупреждает в UI.

### Consequences

- `system-prompt.ts` static-вариант — добавить SERVER FUNCTIONS блок.
- `LIMITATIONS.md` 1.1 — обновить с указанием на (c) flow.
- `VERIFICATION.md` Scenario 4 — обновить acceptance: LLM явно
  предупреждает пользователя.
- `lib/preview/build-error-parser.ts` — добавить best-effort
  detection `fetch('/api/...')` в `src/**` → BuildWarning.
- В `OPEN_QUESTIONS.md` F3 — закрыто: реализация (c) выбрана.

---

## ADR-027: ARCHITECTURE CONSTRAINT тестирование — после MVP

**Status**: accepted (резолюция ASSUMPTIONS.md H6)
**Date**: 2026-04-29

### Decision

Точный wording ARCHITECTURE CONSTRAINT блока (ADR-010 / ADR-026)
**на MVP — рабочий placeholder**. Тесты на качество LLM-генерации
(сколько % промптов рождают unsupported импорты, сколько raw
backend-кода и т.д.) — **post-MVP**, когда будет реальный корпус
запросов на staging.

#### Что делаем сейчас

- Wording из CONTRACTS.md §14 + ADR-026 — финальный для MVP.
- Любая правка после MVP — отдельный ADR + A/B-тест.

#### Что делаем позже

- Корпус ≥100 реальных промптов из staging audit-log.
- Метрики:
  - % failed builds от unsupported import'ов.
  - % успешных промптов (build green) на разных вариантах wording'а.
  - % промптов с server-логикой — насколько LLM correctly
    предупреждает.
- Tuning по результатам.

### Consequences

- В `OPEN_QUESTIONS.md` H6 — переписать как «post-MVP A/B test
  вариантов wording'а».
- В `VERIFICATION.md` §3 metrics — добавить «ARCHITECTURE CONSTRAINT
  effectiveness» как post-Phase 6 метрику.

---

## ADR-028: Hash-based subdomain для static-mode preview hostname

**Status**: accepted
**Date**: 2026-04-30
**Discovered in**: phase-6 e2e (commits `b5619fd`, `ce606f8`)

### Context

Static-провайдер изначально использовал raw `repoId` как subdomain в
preview URL: `<repoId>.preview.localhost`. wrapper-репозитории, однако,
живут в Gitea как `<owner>/<name>` — со слешем. Слеш в `Host`-заголовке
делает HTTP-запрос невалидным; Caddy возвращает `400 malformed Host
header` ещё до матчинга route'а. Тот же слеш ломал и Caddy admin REST
URL `/id/<routeId>` для `PUT`-апдейтов route.

### Decision

Subdomain (и routeId) = `sha256(repoId).slice(0, 8)` — первые 8
hex-символов. Тот же helper используется в:

- `create()` — генерирует `previewUrl` через `https://<hash>.preview.<domain>`.
- регистрации Caddy route — host matcher и routeId оба используют hash.

Hash чистый, детерминированный: один и тот же `repoId` всегда даёт
один и тот же subdomain → URL стабилен между рестартами.

### Consequences

- Subdomain короткий (8 chars) и DNS-safe — wildcard-сертификату
  `*.preview.localhost` не нужно ничего особенного.
- Вероятность коллизии 8 hex chars: 2^32 ≈ 4 миллиарда уникальных
  hash'ей. Для MVP-объёма (десятки-сотни проектов) коллизия в практике
  не наступит.
- Sandbox-режим использовал такой же паттерн — мы выровнялись.

---

## ADR-029: Vite config relocation в /tmp + NODE_PATH (workaround ReadonlyRootfs)

**Status**: accepted (workaround, не permanent fix)
**Date**: 2026-04-30
**Discovered in**: phase-6 e2e (commit `0d19853`)

### Context

`HostConfig.ReadonlyRootfs = true` (BUILD_PIPELINE §4.2) защищает
build-runner от writes куда угодно кроме явно RW-mounts. Vite на
каждом config-load пишет sibling-файл `vite.config.js.timestamp-*.mjs`
рядом с конфигом — для invalidation бандлера. На read-only
`/workspace/` write падает с `EACCES`, и билд умирает до вывода
артефактов.

### Decision

Build-runner Cmd — `sh -c "cp /workspace/vite.config.js
/tmp/vite.config.js && exec npx vite build --config /tmp/vite.config.js"`.

`/tmp` — writable tmpfs (200MB), Vite спокойно пишет туда timestamp-файл.
Конфиг в `/tmp` теряет относительные пути к node_modules; чинится через
`Env: ["NODE_PATH=/workspace/node_modules"]` — Node fallback search
root для импортов в самом конфиге.

Конфиг по-прежнему контролируется образом — сам факт `cp` идёт
ДО передачи controll'а пользовательскому коду; project source mount'ится
RO и подменить конфиг operator не может.

### Consequences

- ReadonlyRootfs остаётся включён → защита от runtime exfil сохраняется.
- Vite 6+ убрал CJS API → возможно уберёт и timestamp-write. Если так —
  workaround можно снять при bump'е (см. STATIC_MODE_REMAINING #7).
- NODE_PATH — глобальный, не scoped per-config. Если в конфиге появятся
  импорты из проектных node_modules — сломается, потому что project
  source mount'ится RO без node_modules. На MVP это not-an-issue: все
  build-time deps живут в shared image volume.

---

## ADR-030: `.preview-state.json` для restart-resilience static-провайдера

**Status**: accepted
**Date**: 2026-04-29
**Discovered in**: phase-6 e2e (commit `064a5ad`)
**Closes**: OPEN_QUESTIONS §L3

### Context

`createStaticPreviewProvider()` хранит per-project состояние
(`boilerplateVersion`, `createdAt`, scratch/static directory paths) в
in-memory `Map<projectId, ProjectEntry>`. При рестарте dev-server'а
(или прода) Map очищается; следующий вызов `build()`/`getProjectFs()`
получает `entry === undefined` → `"project not found"` → 500. UI в
этот момент показывает loader навсегда.

### Decision

`create()` ПЕРСИСТИТ minimal state в `${scratchDir}/.preview-state.json`:

```json
{
  "boilerplateVersion": "1.0.0",
  "createdAt": "2026-04-30T08:13:00Z"
}
```

Все методы (`build`, `getProjectFs`, `destroy`, `touch`) проходят
через `getOrRehydrate(projectId)`, который:

1. Возвращает entry из in-memory Map'а если есть.
2. Иначе читает `.preview-state.json` с диска и реконструирует entry.
3. Если файла нет, но scratch dir существует — fallback на
   `boilerplateVersion="1.0.0"` (legacy проекты до этой ADR).
4. Если scratch dir отсутствует — null (project deleted).

### Consequences

- Builder может рестартануть — пользователь видит preview как до
  рестарта, без необходимости re-create проекта.
- `.preview-state.json` пишется один раз при `create()`, не обновляется
  на каждом билде → I/O cost негативный.
- Migration: legacy проекты без файла продолжают работать через
  fallback. После первого `create()`-style touch файл появится.

---

## ADR-031: Container-internal path mapping через `CADDY_STATIC_ROOT`

**Status**: accepted
**Date**: 2026-04-30
**Discovered in**: phase-6 e2e (commit `8ace7d8`)

### Context

В docker-compose dev-окружении adorable-caddy запускается в отдельном
контейнере с своими volume-mount'ами. Static-провайдер живёт в
adorable (Node) — host paths он считает напрямую через `STATIC_ROOT`
env (`/data/static` или override). Когда провайдер регистрирует Caddy
file_server route с `root = "${staticRoot}/${projectId}/published/"`,
Caddy получает host path, **которого в его контейнере нет** → каждый
preview request возвращает 404.

### Decision

Опция `caddyStaticRoot` в `StaticPreviewProviderOptions` (env
`CADDY_STATIC_ROOT`, default `"/data/static"`) — путь, который видит
Caddy. STATIC_ROOT bind-маунтится в adorable-caddy на этот путь.
file_server route собирается с использованием `caddyStaticRoot`, а не
`staticRoot`:

```ts
const root = path.join(caddyStaticRoot, projectId, "published");
```

На single-node dev (Caddy + Node на одной FS на одном пути) можно
поставить `caddyStaticRoot === staticRoot` — операция станет no-op
rewrite.

### Consequences

- Контейнерный путь decoupled от host пути → можно менять каждый
  независимо.
- В docker-compose нужен новый bind: `${STATIC_ROOT}:${CADDY_STATIC_ROOT}`
  внутри adorable-caddy. Defaults совпадают, в стандартной развёртке
  ничего настраивать не нужно.

---

## ADR-032: Gitea pagination contract для `listRepos`

**Status**: accepted
**Date**: 2026-04-30
**Discovered in**: phase-6 e2e (commit `678f0f3`)

### Context

`identity.permissions.git.list({ limit: 200 })` под капотом вызывает
`GET /api/v1/users/<u>/repos?limit=200`. Gitea **силой capается на 50**
(server-side `MAX_RESPONSE_ITEMS`); параметр `limit=200` принимается, но
ответ всё равно содержит максимум 50 элементов. На инстансах с >50
проектами этот лимит скрывает свежесозданные wrapper'ы → API-запросы
к ним 403'aт ("Forbidden" — не в allowlist'е).

### Decision

`createGiteaGitProvider().listRepos()` теперь paginated: цикл
`page=1,2,...` пока (a) не достигнут запрошенный limit или (b) текущая
страница вернула меньше элементов чем `per_page=50` (signal — последняя
страница).

Контракт публичного API `GitProvider.listRepos({ limit })` остался
без изменений — limit интерпретируется как клиент-сайд cap, провайдер
сам разруливает страницы.

### Consequences

- Cost: до `ceil(limit / 50)` round-trip'ов вместо одного. Для дефолтного
  `limit: 200` — максимум 4 запроса. Для типичного юзера на старте —
  один (репов меньше 50).
- Семантика "last seen first" сохраняется, потому что Gitea возвращает
  репы по умолчанию newest-first.
- 5 unit-тестов (`tests/git-gitea-pagination.test.ts`) фиксируют
  behavior: empty, single page, multi-page, partial-final-page, limit cap.

---

## ADR-033: Vite 6 boilerplate bump — план без кода до staging-валидации

**Status**: planned (не applied)
**Date**: 2026-04-30
**Tracks**: STATIC_MODE_REMAINING #7

### Context

`templates/vite-react/package.json` сейчас pin'ит `vite: ^5.4.8`. На
каждом успешном билде Vite пишет в stderr `The CJS build of Vite's Node
API is deprecated...`. ADR-029 объяснил почему workaround `cp ... /tmp +
NODE_PATH` нужен (ReadonlyRootfs + sibling timestamp file). ADR-033
адресует «когда уже бамп до vite 6».

#### Что решает bump до vite 6

- CJS Node API удалён в vite 6 → deprecation banner исчезает.
  Текущий ad-hoc filter в build-error-parser (`BENIGN_STDERR_LINE_
  PATTERNS`, ADR не имеет — добавлено в commit `ea00293`) можно
  оставить как defensive cleanup.
- `loadConfigFromBundledFile` (источник timestamp-файла, см. ADR-029)
  в vite 6 переписан на ESM-only path. **Нужна validation**: всё ещё
  ли пишется sibling timestamp-файл, или ADR-029 workaround можно
  снять?

#### Чего bump не решает

- Размер node_modules — vite 6 не уменьшает существенно объём.
  STATIC_MODE_REMAINING #8 (warm-pool) — отдельная история.
- React 19 готовность — `@vitejs/plugin-react` 5.x работает
  одинаково с React 18 / 19.

### Decision

**Реальный bump не применяем в этом коммите.** Без живого Docker
build'а в loop env'е невозможно подтвердить что:
1. `vite 6 build` отрабатывает на текущем boilerplate'е без изменений
   `vite.config.js` (он минимальный — `defineConfig({ plugins: [react()] })`,
   риск низкий, но не нулевой).
2. Все existing зависимости боилерплейта (`@vitejs/plugin-react`,
   `lucide-react`, `react-router-dom`, etc.) совместимы с vite 6
   peer-dep'ом.
3. Сам ADR-029 workaround можно снять (sibling timestamp ушёл) или
   оставить (работает defensively — не вредит).

#### Что нужно от staging для bump'а

Staging environment должно прогнать (новый рантайм с docker):

```bash
# 1. Update package.json + VERSION в feature-branch'е
sed -i 's/"vite": "\^5.4.8"/"vite": "^6.0.0"/' templates/vite-react/package.json
sed -i 's/"@vitejs\/plugin-react": "\^4.3.2"/"@vitejs\/plugin-react": "^5.0.0"/' templates/vite-react/package.json
echo '1.1.0' > templates/vite-react/VERSION

# 2. Build new image + populate volume
docker build -f docker/build-runner-react/Dockerfile -t build-runner-react:1.1.0 .
docker volume create adorable_node_modules_react_1.1.0
docker run --rm -u 0:0 \
  -v adorable_node_modules_react_1.1.0:/mnt/dest \
  --entrypoint sh build-runner-react:1.1.0 \
  /workspace/init-volume.sh

# 3. Smoke test: создать новый проект на 1.1.0, прогнать `npm run bench`
PREVIEW_PROVIDER=static npm run dev
# отдельный терминал:
curl -X POST http://localhost:3000/api/repos -d '{}' -H content-type:application/json
# забрать projectId из ответа, прогнать build
npx tsx scripts/bench-static-build.ts \
  --project <projectId> --audit-log /var/log/adorable/audit.log \
  --iterations 10
```

Acceptance:
- 10/10 builds succeeded.
- p50 не выше чем у 1.0.0 (regression-detector).
- В stderr нет deprecation banner'а из vite 5.x (это и был тригер #7).
- Если `vite.config.js.timestamp-*.mjs` больше не пишется — снять
  ADR-029 workaround в build-runner-docker.ts (отдельный коммит).

### Migration story (existing проекты на 1.0.0)

При выкладке 1.1.0 как нового default'а existing проекты пинят 1.0.0
в `metadata.boilerplateVersion`. Они продолжают билдиться против
старого образа (`build-runner-react:1.0.0` + старый named volume).
Никакого обязательного апгрейда:

- Ленивая миграция: при первом prompt'е к старому проекту LLM может
  явно (или туллингом) обновить boilerplate version в metadata. Этого
  пока нет — open question (`OPEN_QUESTIONS.md` E4 «Частота
  автомиграций»).
- Жёсткая миграция: расширить `scripts/migrate-repo-metadata.ts` в
  режиме `--bump-boilerplate-version` который явно меняет
  `metadata.boilerplateVersion = "1.1.0"` (one-shot). Скрипт уже умеет
  backfill'ить missing fields — добавить branch для bump'а.

Migration script — отдельный коммит когда staging валидация прошла.
Спустя неделю эксплуатации 1.1.0 — подумать про deprecation
`build-runner-react:1.0.0`.

### Consequences

- ADR-029 (vite config relocation) **остаётся valid** до staging-
  валидации. После — может быть откатано в follow-up'е.
- Текущий `BENIGN_STDERR_LINE_PATTERNS` в build-error-parser
  продолжает работать defensively — после vite 6 банер не
  пишется, но другая stderr-noise (npm warn / Browserslist) не
  исчезает, поэтому фильтр всё равно нужен.
- Image-versioning логика (image:`<version>` + volume
  `adorable_node_modules_react_<version>`) уже готова из ADR-005 —
  bump'ить кошерно: оба образа сосуществуют до миграции последнего
  проекта.

---

_Last updated: 2026-04-30._
