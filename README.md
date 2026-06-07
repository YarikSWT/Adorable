# Adorable (fork — self-hosted)

![Adorable](screen-shot.png)

Self-hosted форк [freestyle-sh/Adorable](https://github.com/freestyle-sh/Adorable). Цель форка — полностью убрать зависимости от SaaS-сервисов Freestyle и предоставить стек, который разворачивается одной командой на собственной инфраструктуре. Целевой рынок — Россия, поэтому LLM-провайдер — GLM от Z.ai (доступен и оплачивается из РФ).

Upstream-фичи: чат с AI, live preview, embedded-терминал, one-click publish, persistent git-проекты — сохранены.

## Отличия от upstream

| Было (upstream) | Стало (fork) |
|---|---|
| Freestyle VMs (SaaS sandbox) | **Docker + dockerode** с жёсткими лимитами |
| Freestyle Git (SaaS) | **Gitea** (REST API v1) |
| Freestyle Deploy (SaaS serverless) | **Kamal** (CLI через child_process) |
| Freestyle preview-домены | **Caddy** + Admin API для динамических роутов |
| Anthropic Claude API | **GLM-5.1 от Z.ai** через OpenAI-совместимый endpoint (с fallback на OpenRouter / Anthropic) |

Детальный diff — в [FORK_CHANGES.md](./FORK_CHANGES.md). Модель угроз и меры — в [SECURITY.md](./SECURITY.md). Решения — в [decisions.md](./decisions.md).

## Архитектура запуска

### Инфра-сервисы — всегда в docker-compose
`docker-compose.yml` поднимает всю инфраструктуру: Postgres (app), Postgres
(Gitea), Gitea, Caddy, Redis, agent-loop (`worker` + `reaper`) и Jaeger. Полная
карта образов и контекстов — в разделе [Docker-обстановка](#docker-обстановка).

```bash
cp .env.example .env
# заполнить секреты; см. раздел «Секреты» ниже
npm run dev:infra:up
npm run dev:infra:wait
npm run dev:infra:init-gitea   # создаст admin-юзера и токен, запишет GITEA_TOKEN в .env
```

### Билдер (Next.js) — локально для dev
```bash
npm install
npm run dev
```
Открыть [http://localhost:3000](http://localhost:3000).

### Prod-симуляция (билдер в compose)
```bash
npm run prod:up
```

## Docker-обстановка

Весь Docker в проекте — это **два compose-файла** и **три образа** под `docker/`.

### Compose-файлы

| Файл | Роль | Сервисы |
|---|---|---|
| `docker-compose.yml` | dev / база | `postgres-app`, `postgres-gitea`, `gitea`, `caddy`, `redis`, `worker`, `reaper`, `jaeger` |
| `docker-compose.prod.yml` | overlay для prod-симуляции | добавляет `builder` (контейнеризованное Next.js-приложение) |

- `npm run dev:infra:up` → `docker compose up -d` поднимает **все** сервисы базового файла. В dev само Next.js-приложение запускается **на хосте** через `npm run dev` (быстрый HMR), а не в контейнере.
- `npm run prod:up` → `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` добавляет к ним `builder`. Нужен только для финального e2e перед релизом.

### Образы

Все Dockerfile'ы лежат под `docker/` по единой схеме `docker/<name>/Dockerfile`.

| Образ | Dockerfile | Base | Build-context | Кто использует |
|---|---|---|---|---|
| **app** (билдер) | `docker/app/Dockerfile` | `node:22-slim` | корень репо | `docker-compose.prod.yml` → `builder`; Kamal ([config/deploy.yml](./config/deploy.yml)) |
| **worker + reaper** | `docker/worker/Dockerfile` | `node:22-alpine` | корень репо | `docker-compose.yml` → `worker`, `reaper` (один образ, разный `command`) |
| **build-runner-react** | `docker/build-runner-react/Dockerfile` | `node:22-slim` | `adorable/` | собирается **вручную** (см. [adorable/README.md](./adorable/README.md)); запускается кодом через dockerode |

Для первых двух `context`/`dockerfile` заданы в compose; для третьего — в команде сборки.

#### Почему у build-runner context = `adorable/`

Эфемерный образ для `vite build` копирует ровно два поддерева — `templates/vite-react/**` и `scripts/build-runner/init-volume.sh`. Их ближайший общий предок — `adorable/`, поэтому он и стоит контекстом; остального содержимого `adorable/` образу не нужно, и оно отсекается через `adorable/.dockerignore`. Команды сборки образа и заполнения named volume — пошагово в [adorable/README.md](./adorable/README.md).

### `.dockerignore`

| Файл | Контекст | Главное, что исключает |
|---|---|---|
| `.dockerignore` | корень (app, worker) | `node_modules`, `.next`, `.git`, `docs/`, `verification/` и — важно — `.env` (секреты не попадают в образ) |
| `adorable/.dockerignore` | build-runner | `node_modules` (~6 МБ), `.next`, `.env`, TS-кэши |

Без них `COPY . .` тащил бы в build-context хостовые `node_modules` и секретный `.env`.

## Секреты

| Переменная | Как получить |
|---|---|
| `Z_AI_API_KEY` | [z.ai/model-api](https://z.ai/model-api) → Get API Key. Без него чат не работает. |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `GITEA_ADMIN_PASSWORD` | `openssl rand -base64 24` |
| `GITEA_TOKEN` | автоматически создаётся `scripts/init-gitea.sh --write-env` |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) если хотите вместо zai |
| `ANTHROPIC_API_KEY` | опционально, для fallback |

## LLM provider

Переключается через `LLM_PROVIDER`:
- `zai` (default) — Z.ai прямой endpoint, модели `glm-5.1` (main) и `glm-4.5-air` (fast).
- `openrouter` — любые модели через OpenRouter (`z-ai/glm-5.1`, `anthropic/claude-sonnet-4.5` и т.д.).
- `anthropic` — fallback на прямой Anthropic API.
- `openai` — fallback на OpenAI.
- `mock` — для тестов, возвращает фиксированный текст.

См. [ANTHROPIC_INVENTORY.md](./ANTHROPIC_INVENTORY.md) для деталей адаптера.

## Структура

```
.
├── adorable/                 # Next.js приложение (upstream source)
│   ├── app/                  # App Router (API routes, страницы)
│   ├── components/           # UI
│   ├── lib/
│   │   ├── adapters/         # SandboxProvider, GitProvider, ProxyProvider, LLMProvider, DeployProvider
│   │   ├── sandbox/          # cleanup-воркер, audit-log
│   │   └── ...               # upstream helpers
│   └── tests/                # vitest (security, integration, contract)
├── config/
│   ├── caddy/                # initial Caddy JSON config
│   └── deploy.yml            # Kamal шаблон
├── scripts/
│   ├── dev-infra.sh          # up/down/logs/status/wait-healthy
│   └── init-gitea.sh         # idempotent admin+token bootstrap
├── verification/screenshots/ # Playwright MCP артефакты
├── docker-compose.yml        # dev-стек: Postgres×2, Gitea, Caddy, Redis, worker/reaper, Jaeger
├── docker-compose.prod.yml   # override: + builder (см. раздел «Docker-обстановка»)
├── docker/                   # все Dockerfile'ы (context указан в compose)
│   ├── app/Dockerfile        # образ билдера (prod-симуляция), context=.
│   ├── worker/Dockerfile     # worker + reaper (один образ), context=.
│   └── build-runner-react/   # эфемерный sandbox превью, context=adorable/
├── MIGRATION_PLAN.md         # что сделано, что нет
├── STATE.md / PROGRESS.md    # состояние форка
├── FREESTYLE_INVENTORY.md    # все точки интеграции
├── ANTHROPIC_INVENTORY.md    # точки импорта LLM-провайдеров
├── decisions.md              # ADR
├── SECURITY.md               # модель угроз + меры
├── FORK_CHANGES.md           # diff vs upstream
└── VERIFICATION_LOG.md       # лог Playwright-проверок
```

## Тесты

```bash
# unit tests (нет внешних сервисов, быстрые)
npm test --workspace ./adorable

# integration tests — на живых сервисах, gated на env
RUN_DOCKER_TESTS=1 npx vitest run --root adorable tests/sandbox-security.test.ts
RUN_GITEA_TESTS=1 npx vitest run --root adorable tests/git-gitea-integration.test.ts
RUN_CADDY_TESTS=1 npx vitest run --root adorable tests/proxy-caddy-integration.test.ts
```

Security-тесты sandbox (Phase 2) обязательны для production deploy.

## Production deployment

MVP: `npm run prod:up` поднимает билдер + инфру в compose. Для настоящего
прод-деплоя на VPS — Kamal template [config/deploy.yml](./config/deploy.yml)
(в разработке, [→v2]).

## Статус миграции

См. [MIGRATION_PLAN.md](./MIGRATION_PLAN.md), [PROGRESS.md](./PROGRESS.md),
[FORK_CHANGES.md](./FORK_CHANGES.md).

## Оригинал

Upstream: https://github.com/freestyle-sh/Adorable

Лицензия: MIT (см. [LICENSE](./LICENSE)).
