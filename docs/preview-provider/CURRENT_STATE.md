# CURRENT_STATE.md — снимок репозитория на 2026-04-27

Это **не** часть финальной спеки. Это рабочие заметки, на которых
строятся все архитектурные решения. Нужно ровно для того, чтобы
будущие документы (ARCHITECTURE, CONTRACTS, BUILD_PIPELINE, ...)
можно было верифицировать против реального кода, а не догадок.

Цель — точно знать «что есть сейчас», прежде чем формулировать
«что должно быть».

---

## 1. Топология репозитория

```
/home/agent/Adorable/
├── adorable/                       Next.js 16 билдер (само приложение)
│   ├── app/api/                    REST endpoints (chat, repos, deployment-*)
│   ├── lib/
│   │   ├── adapters/               Все провайдеры — git/llm/proxy/sandbox
│   │   ├── sandbox/                cleanup-worker, audit-log, singleton
│   │   ├── proxy/                  proxy provider singleton
│   │   ├── git/                    git provider singleton (предполагается)
│   │   ├── adorable-vm.ts          оркестратор: создаёт sandbox + регистрирует proxy
│   │   ├── create-tools.ts         13 LLM tools (bash, file ops, commit, checkApp)
│   │   ├── system-prompt.ts        системный промпт LLM
│   │   ├── template-seeder.ts      три seed-функции (см. §3)
│   │   └── llm-provider.ts         тонкая обёртка над createLLM() из adapters/llm.ts
│   ├── templates/
│   │   └── vite-react/             ⭐ единственный bundled boilerplate (см. §3)
│   └── tests/                      18 vitest файлов (~140+ unit/integration)
├── docker-compose.yml              Postgres ×2, Gitea, Caddy + 2 docker-сети
├── docker-compose.prod.yml         + сервис builder
├── example/                        ❓ side-template из base44 (НЕ используется кодом)
├── docs/preview-provider/          ⭐ создаётся в этой сессии
└── (фикспейся root-уровневые .md: MIGRATION_PLAN, FORK_CHANGES, SECURITY, ...)
```

**Замечание**: `example/` лежит в репо, но в коде на него никто не
ссылается. Это, видимо, референсный набор зависимостей base44-style
(шаблон с radix-ui, tanstack, recharts, three.js, leaflet и т.д.).
Решение «использовать или забыть» — открытый вопрос (см. §10).

---

## 2. Адаптерный слой — что уже есть

Все провайдеры построены по одному паттерну:

```ts
interface FooProvider { name; create/list/...; }
type FooProviderName = "<impl-a>" | "<impl-b>" | "mock";
const resolveFooProviderName = (override?) => ...;  // env + NODE_ENV→mock
const createFooProvider = async ({providerOverride}) => {
  const name = resolveFooProviderName(...);
  const mod = await import(`./foo-${name}`);    // lazy
  return mod.createXxxProvider();
};
```

| Provider           | Файл                                  | Реализации                    | Env                  |
|--------------------|---------------------------------------|-------------------------------|----------------------|
| `LLMProvider`      | `lib/adapters/llm.ts`                 | zai / openrouter / anthropic / openai / mock | `LLM_PROVIDER`       |
| `SandboxProvider`  | `lib/adapters/sandbox.ts`             | docker / mock                 | `SANDBOX_PROVIDER`   |
| `GitProvider`      | `lib/adapters/git.ts`                 | gitea / mock                  | `GIT_PROVIDER`       |
| `ProxyProvider`    | `lib/adapters/proxy.ts`               | caddy / mock                  | `PROXY_PROVIDER`     |
| `DeployProvider`   | (планировался) — отложено в v2        | —                             | —                    |
| **`PreviewProvider`** | **(не существует)** — цель сессии  | static / sandbox              | `PREVIEW_PROVIDER`   |

**Ключевая наблюдение**: новый `PreviewProvider` будет «выше» текущего
`SandboxProvider`. Sandbox останется как lower-level примитив (когда
нужна VM); static-режим вообще не использует Sandbox.

### Сингл-тоны
`lib/sandbox/provider-singleton.ts`, `lib/proxy/provider-singleton.ts` —
HMR-safe singletons (хранятся на `globalThis`). Аналогичный singleton
понадобится для `PreviewProvider`.

---

## 3. Существующий Vite-React бойлерплейт

`adorable/templates/vite-react/` — **уже** соответствует целевой
архитектуре по структуре. Что внутри:

```
package.json          name: adorable-app, type: module
                      deps: react/react-dom 18.3, react-router-dom 6.26,
                            lucide-react, clsx, class-variance-authority,
                            tailwind-merge
                      devDeps: vite 5.4, @vitejs/plugin-react,
                            tailwindcss 3.4, tailwindcss-animate,
                            postcss, autoprefixer
                      scripts: dev (vite --host 0.0.0.0 --port 5173),
                               build (vite build),
                               preview (vite preview ...)
vite.config.js        plugins: [react()], alias "@/" → src/, port 5173
tailwind.config.js    (1.9 KB — содержит preset)
postcss.config.js
jsconfig.json
index.html
.gitignore
README.md
public/               (пуст в текущей версии)
src/
├── main.jsx
├── App.jsx                 BrowserRouter + одна route /  → <Home/>
├── index.css               tailwind directives
├── pages/Home.jsx
├── components/ui/          shadcn-style примитивы (button.jsx минимум)
└── lib/                    cn() и другие утилиты
```

**JSX, не TypeScript** — текущий шаблон. Это решение зафиксировано
в `system-prompt.ts`: «Vite 5 + React 18, JSX only — no TypeScript, no SSR».

### Три способа загрузки template'а в работу (`template-seeder.ts`)

| Функция                        | Источник           | Назначение                                      |
|--------------------------------|--------------------|-------------------------------------------------|
| `seedTemplateRepo`             | bundled template   | Initial commit в новый Gitea-репо               |
| `seedSandboxFromTemplate`      | bundled template   | Заливка в живой sandbox через `fs.writeTextFile`|
| `seedSandboxFromSourceRepo`    | Gitea (`listAllFiles`) с fallback на bundled | Восстановление sandbox после destroy |

Сюда же `ADORABLE_TEMPLATE_DIR` — env override для тестов / прод-замены.

В static-модели остаётся актуальной только **`seedTemplateRepo`**
(initial commit). Sandbox-seeder функции уйдут или останутся ради
sandbox-режима.

---

## 4. Текущий runtime-контур (sandbox-режим)

Поток создания проекта:

```
POST /api/repos
  → gitProvider.createRepo()                  // пустой Gitea-репо
  → seedTemplateRepo(gitea, repo)             // initial commit с template
  → createVmForRepo(repoId)                   // adorable-vm.ts
       sandboxProvider.create({domains: 3})   // Docker container, tmpfs /workspace
       seedSandboxFromSourceRepo(gitea, fs)   // template/source → /workspace
       proxyProvider.addRoute(×3)             // *.preview.localhost → sandbox:port
  → return {previewUrl, devCommandTerminalUrl, additionalTerminalsUrl}

POST /api/chat (streaming)
  → sandbox.ref({sandboxId})
  → createTools(sandbox, {onFileChange, onFileDelete})
  → streamLlmResponse(messages, tools)
  → onFinish: gitProvider.commits.create(batch из onFileChange Map)
```

Внутри chat/stream LLM пользуется 13 инструментами из `create-tools.ts`:

| Tool                | Что делает                                    | Зависит от           |
|---------------------|-----------------------------------------------|----------------------|
| `bashTool`          | `sandbox.exec({command})`                     | live container       |
| `readFileTool`      | `sandbox.fs.readTextFile`                     | sandbox fs           |
| `writeFileTool`     | `sandbox.fs.writeTextFile` + onFileChange     | sandbox fs           |
| `replaceInFileTool` | read+write через sandbox fs                   | sandbox fs           |
| `appendToFileTool`  | read+write через sandbox fs                   | sandbox fs           |
| `listFilesTool`     | `find` / `ls` через bashTool                  | live container       |
| `searchFilesTool`   | `grep -RIn` через bashTool                    | live container       |
| `makeDirectoryTool` | `mkdir -p` через bashTool                     | live container       |
| `movePathTool`      | `mv` через bashTool                           | live container       |
| `deletePathTool`    | `rm -rf` через bashTool                       | live container       |
| `commitTool`        | `git commit && pull --rebase && push`         | live container + net |
| `checkAppTool`      | `curl localhost:5173` + scan dev-server logs  | running dev server   |
| `devServerLogsTool` | `sandbox.devServer.getLogs()`                 | running dev server   |

**Пять из тринадцати tools завязаны на наличии bash/живого процесса:**
bash, list, search, mkdir, move, delete, commit, checkApp, devServerLogs.
Это критично для перехода в static: контейнера нет, dev-сервера нет —
контракт LLM-tools должен быть переработан.

### Lifecycle (cleanup-worker)
`lib/sandbox/cleanup-worker.ts`: TTL (`SANDBOX_MAX_LIFETIME_MIN`,
default 120) + idle (`SANDBOX_IDLE_TIMEOUT_MIN`, default 30) с `touch()`
API. При destroy каскадом убираются proxy-роуты. Этот паттерн
(idle-eviction) понадобится в static, но в другой форме (артефакты на
диске, не контейнеры).

### audit-log
`lib/sandbox/audit-log.ts` — JSON-lines append-only log. Используется
для всех sandbox lifecycle событий. Будет полезен и для static
(create/build/serve/cleanup events).

---

## 5. Что говорит LLM о стеке (system-prompt.ts)

Системный промпт сейчас:

- сообщает что в `/workspace` лежит Vite+React+Tailwind app;
- перечисляет 14 файлов (явно);
- даёт «cheat-sheet»: Vite 5, React 18, JSX, Tailwind 3 с CSS-vars,
  react-router-dom 6, shadcn-style ui-primitives, alias `@/` → `src/`,
  lucide-react, cn() helper;
- инструктирует запустить dev-сервер один раз `npm install && npm run dev &`
  и не перезапускать;
- разрешает `npm install <pkg>` — Vite подхватит HMR'ом;
- предписывает использовать file-tools вместо bash для file ops;
- велит вызывать commitTool в конце задач.

**Проблема для static**: «If a module fails to resolve after adding a
dependency, run `npm install <pkg>`». Это противоречит фиксированному
boilerplate. Промпт надо переписать целиком.

---

## 6. Инфраструктура (compose)

`docker-compose.yml`:
- `postgres-app` (Better Auth) + `postgres-gitea`
- `gitea` (1.22.3, REST API на 3001, в сети `adorable_infra`)
- `caddy` (2.8-alpine, Admin API на 2019, в обеих сетях `adorable_infra` + `adorable_sandboxes`)

Сети:
- `adorable_infra` — для приложения (builder + Postgres + Gitea + Caddy)
- `adorable_sandboxes` — изолированная сеть для sandbox-контейнеров,
  Caddy подключён к ней aliasом `caddy`. `internal: false` — нужен
  доступ в интернет для `npm install`. В static-режиме потребность
  отпадает (dependencies preinstalled).

`docker-compose.prod.yml` добавляет:
- сервис `builder` (собирается из корневого `Dockerfile`)
- bind-mount `/var/run/docker.sock` (для dockerode)
- `/var/log/adorable` volume для audit-log
- env-переменных ~30: GIT_*, SANDBOX_* (15 ограничений), PROXY_*,
  PREVIEW_DOMAIN_SUFFIX, LLM_*, BETTER_AUTH_*

В static-модели, скорее всего:
- `adorable_sandboxes` сеть остаётся (для fallback sandbox-режима);
- появляется новый build-runner image (или контейнер) с предустановленным
  node_modules;
- появляется новый volume для готовых артефактов `/data/static/<id>/dist/`;
- Caddy конфиг включает file_server на `*.preview.<base>`.

---

## 7. Существующие тесты — на что опираться

Релевантные для нашей миграции:

- `tests/sandbox-contract.test.ts` (16) — паттерн контрактного теста, повторим для PreviewProvider.
- `tests/sandbox-mock.ts`-аналог нужен для `PreviewProvider mock`.
- `tests/proxy-contract.test.ts` (9) + `tests/proxy-caddy-integration.test.ts` (6) — там же подкрутится file_server roundtrip.
- `tests/template-seeder.test.ts` — тест существует; надо посмотреть что внутри (на следующем round'е).
- `tests/sandbox-security.test.ts` (9) — gated `RUN_DOCKER_TESTS=1`; для build-runner аналог нужен.
- `tests/proxy-security.test.ts` — добавится тест на изоляцию file_server'а.
- `tests/landing-flow-e2e.test.ts` — e2e для проекта; нужно адаптировать под static.

---

## 8. Что про деплой

Phase 5 (Kamal) отложен в v2. В static-модели «деплой» по сути —
это уже произошедший build артефакт под `/data/static/<id>/dist/`
плюс Caddy роут на subdomain. Возможно Phase 5 в new-arch вообще не
нужен для MVP.

---

## 9. Принятые в форке решения, которые мы НЕ ломаем

- LLM-провайдер: GLM-5.1 / Z.ai через `lib/adapters/llm.ts`. Не трогаем.
- Git: Gitea через `lib/adapters/git.ts`. Не трогаем.
- Adapter-pattern с env-resolved providers + lazy import. Повторяем.
- audit-log JSON-lines. Используем.
- HMR-safe singleton. Повторяем для PreviewProvider.
- Server-side batch-commit через `onFileChange` Map в chat/route.ts.
  Возможно, остаётся (в static мы тоже не пишем в git на каждое
  изменение — даём LLM-toolset с writeFile, аккумулируем, при
  завершении turn'а коммитим один раз).
- Tests gated env vars (`RUN_DOCKER_TESTS=1` etc.). Повторяем.
- Capability-флаги в API ответе (запрос пока не реализован, но идея
  ляжет в response `/api/repos`).

---

## 10. Что остаётся неясным после исследования (вход в OPEN_QUESTIONS)

Решено в раунде 1 (см. `DECISIONS.md`):
- ✅ Build trigger model → **end-of-turn + manual rebuild** (ADR-001)
- ✅ Multi-framework MVP → **только React** (ADR-002)
- ✅ LLM tool surface → **dynamic toolset по capabilities** (ADR-003)

Решено в раунде 2 (см. `DECISIONS.md`):
- ✅ Build-runner → **ephemeral container + RO node_modules volume per framework** (ADR-005)
- ✅ File flow → **scratch dir + Map + commit per turn, single-instance** (ADR-006)
- ✅ Assets → **LLM пишет текст с whitelist путей, UI грузит бинари** (ADR-007)
- ✅ Boilerplate updates → **версионирование + миграционный воркер партиями** (ADR-008)
- ✅ Long sessions → **остаёмся на static с build-cache** (ADR-009)
- ✅ Capability tier → **explicit ARCHITECTURE CONSTRAINT в system-prompt** (ADR-010)

Решено в раунде 3 (см. `DECISIONS.md`):
- ✅ Iframe rendering policy → **last-good + UI overlay, atomic symlink swap через `current` → `builds/<timestamp>/`** (ADR-004)
- ✅ Build orchestration → **in-memory BuildQueue в процессе билдера + SSE endpoint** (ADR-011)
- ✅ Concurrency → **cancel + replace, max 1 running + 1 queued, UI debounce ~500мс** (ADR-012)

Решено в раунде 4 (см. `DECISIONS.md`):
- ✅ TypeScript? → **JSX-only на MVP** (ADR-013)
- ✅ Public URL → **capability-driven `PreviewMetadata` с опциональным `terminalUrls`** (ADR-014)
- ✅ Capabilities placement → **hybrid: provider declares, RepoMetadata pins** (ADR-015)
- ✅ Build-cache → **подкаталог `/data/projects/<id>/.vite/`, не отдельный volume** (ADR-016)

Решено в раунде 5 (см. `DECISIONS.md`):
- ✅ `PreviewProvider` метод → **`create()` (согласованность с другими провайдерами)** (ADR-017)
- ✅ Build error feedback → **гибрид: structured `errors[]` + raw stdout/stderr с size cap** (ADR-018)

Решено в раунде 6 (см. `DECISIONS.md`):
- ✅ Состав deps → **battery-included из base44 без eslint/baseline** (ADR-019)
- ✅ `example/` → **перемещён в `docs/preview-provider/research/example-base44/`** (ADR-020)
- ✅ JSX/TS scope → **JSX в `src/`, TS в `functions/`; @types и typescript остаются в devDeps** (ADR-013 refined, ADR-021)
- ✅ `functions/` директория → **TypeScript edge-handler'ы, не билдятся на MVP, активируются с BaaS-интеграцией** (ADR-021)

Решено в раунде 7 (резолюция HIGH-вопросов из ASSUMPTIONS.md):
- ✅ `PreviewProvider.create()` идемпотентен по repoId (ADR-022)
- ✅ Initial preheat build + `seed/` placeholder под `current` (ADR-023)
- ✅ `*.ts/*.tsx` разрешены в `src/` — Vite сам процессит, типы не валидируются (ADR-024 refines ADR-013)
- ✅ Promote-flow остаётся, два симлинка `current` + `published`, два URL на проект (ADR-025)
- ✅ `functions/` — честный UX gate в system-prompt'е, обсуждение с пользователем перед записью (ADR-026 refines ADR-021)
- ✅ ARCHITECTURE CONSTRAINT wording placeholder, A/B тест после MVP (ADR-027)

Остаётся открытым:

1. **TTL scratch dir по inactivity** — какой период разумный (дни/недели)? (ADR-006)
7. **Целевая метрика incremental build** — 1 / 3 / 5 секунд? (ADR-009)
8. **Build-cache strategy** — per-project named volume `adorable_build_cache_<projectId>`? Стратегия инвалидации? (ADR-005, ADR-009)
9. **Частота автомиграций boilerplate** — cron / on-release / manual-only? (ADR-008)
10. **ClamAV для UI uploads** — нужен сверх magic-bytes? (ADR-007)
11. **Sticky sessions → S3-compat план масштабирования** — детали и триггеры перехода. (ADR-006)
12. **Backend для генерируемых приложений (Appwrite или аналог)** — отдельная большая тема, фиксируем только в OPEN_QUESTIONS.
13. **Замер реального overhead старта ephemeral контейнера** + тест на сохранение pnpm-симлинков при `cp -a` в named volume. (ADR-005, на этап реализации)
14. **`BUILD_HISTORY_LIMIT`** — сколько последних build-директорий хранить в `/data/static/<id>/builds/`? Default 5? (ADR-004)
15. **Поведение SSE при рестарте билдера** — no-op, «соединение потеряно», автопересоединение? (ADR-011)
16. **Точные таймауты SIGTERM grace period** для cancel build'а; поведение «двойного SIGKILL» если первый завис; что попадает в audit-log при cancel. (ADR-012)
17. **Поведение overlay при cancel'ed билде** — UI показывает «отменён, ждём следующий» или сразу следующий running? (ADR-004 + ADR-012)
18. **Provider deprecation behaviour** — что делать когда provider, на котором проект был создан, больше не существует (fallback на default? error? UI prompt?). (ADR-015)
19. **`tsc --noEmit functions/**/*.ts` step в build pipeline** — best-effort валидация без runtime? (ADR-021)
20. **BaaS-провайдер для `functions/` runtime** — Appwrite Functions vs Cloudflare Workers vs самописный Deno-host. (ADR-021, OPEN_QUESTIONS отдельная тема)
21. **Связь frontend↔functions на MVP** — какой UX когда LLM пишет `fetch('/api/foo')` но функция не задеплоена? Заглушка / chat-warning / explicit «not yet running» indicator? (ADR-021)
22. **Strip'ы в следующем bump'е** — `three`, `react-leaflet` (без peer `leaflet`), `react-quill`, `moment`, `lodash` (cjs vs `lodash-es`). (ADR-019)
23. **Toast библиотеки дублирование** — `sonner`, `react-hot-toast`, `@radix-ui/react-toast`. Какую оставить? (ADR-019, DEPENDENCIES.md §7)
24. **Lint в build pipeline** — нужен ли eslint step? Если да — возвращаем eslint-deps. (ADR-019)

---

_Last updated: 2026-04-28. Спека сформирована полностью — см. `README.md` для навигации.
Открытые вопросы перенесены в `OPEN_QUESTIONS.md` с приоритетами._
