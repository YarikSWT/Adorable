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
`docker-compose.yml` поднимает Postgres (app), Postgres (Gitea), Gitea и Caddy.

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
├── docker-compose.yml        # Postgres×2 + Gitea + Caddy
├── docker-compose.prod.yml   # override: + builder
├── Dockerfile                # образ билдера (prod-симуляция)
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
