# Fork Changes

Отличия этого форка от upstream `freestyle-sh/Adorable`.

## Цель форка

Adorable — open-source AI-билдер аналог Lovable. Upstream полагается на три
Freestyle SaaS-сервиса (VMs, Git, Deploy) и Anthropic Claude. Этот форк
заменяет все внешние SaaS-зависимости на полностью self-hosted стек
чтобы работать в РФ без доступа к зарубежным платежам и сервисам.

## Замены

| Сервис | Upstream | Форк |
|---|---|---|
| LLM | Anthropic Claude (`@ai-sdk/anthropic`) | GLM от Z.ai через OpenAI-совместимый endpoint |
| Sandbox VMs | Freestyle VMs (`freestyle.vms.*`) | Docker + dockerode с 15 security-ограничениями |
| Git | Freestyle Git (`freestyle.git.*`) | Gitea 1.22 через REST API v1 |
| Preview URLs | Freestyle domains (`freestyle.domains.*`) | Caddy 2 Admin API с динамическими роутами |
| Deploy | Freestyle Serverless (`freestyle.serverless.*`) | Kamal (v2, stubbed в MVP) |
| Identity | Freestyle identities | Cookie-based + in-memory ACL (позже Better Auth) |

## Добавленные подсистемы

### Адаптеры `adorable/lib/adapters/`

Каждая внешняя интеграция абстрагирована в адаптер с mock-реализацией
для тестов и переключением через env-переменную:

- `llm.ts` + `llm-mock.ts` — LLMProvider. Переключение `LLM_PROVIDER=zai|openrouter|anthropic|openai|mock`.
- `sandbox.ts` + `sandbox-mock.ts` + `sandbox-docker.ts` + `sandbox-docker-config.ts`
  — SandboxProvider. Переключение `SANDBOX_PROVIDER=docker|mock`.
- `git.ts` + `git-mock.ts` + `git-gitea.ts` — GitProvider. Переключение `GIT_PROVIDER=gitea|mock`.
- `proxy.ts` + `proxy-mock.ts` + `proxy-caddy.ts` — ProxyProvider. Переключение `PROXY_PROVIDER=caddy|mock`.

### Инфраструктура `adorable/lib/sandbox/` и `adorable/lib/**/provider-singleton.ts`

- `audit-log.ts` — structured JSON-lines audit log (sandbox + proxy events).
- `cleanup-worker.ts` — TTL + idle reaper для sandbox-контейнеров с опциональным
  cascade в ProxyProvider.
- `{sandbox,git,proxy}/provider-singleton.ts` — HMR-safe singletons.

### Docker-compose

- `docker-compose.yml` — инфра (Postgres ×2, Gitea, Caddy + 2 сети).
- `docker-compose.prod.yml` — override с билдером для prod-симуляции + проброс `/var/run/docker.sock`.

### Скрипты

- `scripts/dev-infra.sh` — up/down/logs/status для инфры.
- `scripts/init-gitea.sh` — идемпотентное создание admin-user + API token.
- Корневой `package.json` добавил: `dev:infra:*`, `prod:up`, `prod:down`.

### Тесты

| Suite | Count | Requires |
|---|---|---|
| `llm-adapter.test.ts` | 17 | — |
| `sandbox-contract.test.ts` | 16 | — |
| `sandbox-docker-config.test.ts` | 22 | — |
| `cleanup-worker.test.ts` | 11 | — |
| `audit-log.test.ts` | 10 | — |
| `git-contract.test.ts` | 14 | — |
| `proxy-contract.test.ts` | 9 | — |
| `proxy-security.test.ts` | 3 | — |
| `sandbox-security.test.ts` | 9 | `RUN_DOCKER_TESTS=1` + Docker daemon |
| `git-gitea-integration.test.ts` | 4 | `RUN_GITEA_TESTS=1` + Gitea |
| `proxy-caddy-integration.test.ts` | 6 | `RUN_CADDY_TESTS=1` + Caddy |

**105 unit tests (no external services) + 19 integration tests (gated).**

## Удалённые зависимости

- `freestyle-sandboxes`
- `@freestyle-sh/with-dev-server`
- `@freestyle-sh/with-pty`
- `@freestyle-sh/with-ttyd`

## Сохранены как fallback

- `@ai-sdk/anthropic` — опциональный LLM-провайдер (используется только в `lib/adapters/llm.ts` при `LLM_PROVIDER=anthropic`).
- `@ai-sdk/openai` — опциональный LLM-провайдер (openai fallback).

## Новые зависимости

- `@ai-sdk/openai-compatible` — GLM через Z.ai.
- `@openrouter/ai-sdk-provider` — GLM через OpenRouter.
- `dockerode` + `@types/dockerode` — Docker API клиент.
- `tar-stream` + `@types/tar-stream` — для `putArchive`/`getArchive`.

## ADR-записи

Архитектурные решения форка задокументированы в `decisions.md` (ADR-001 .. ADR-017).

## Git-конвенция

Все коммиты форка имеют префикс `fork:` для упрощения будущего ребейза на upstream.

## Deferred в v2

- **Phase 5 (Kamal DeployProvider):** Kamal CLI-адаптер отложен — требует SSH-доступа
  к целевому хосту и конфигурации, которая не нужна для MVP self-hosted instance.
- **Sticky sandbox storage:** workspace сейчас — tmpfs (эфемерный). Persistent
  named volume требует helper-контейнера для chown и был непредсказуем на тестах;
  для MVP sandbox клонирует код из Gitea при старте.
- **Better Auth:** `identity-session.ts` использует простой cookie UUID +
  in-memory ACL. В v2 заменится на Better Auth с Postgres.

## PreviewProvider migration (sandbox + static)

Добавлен второй preview-режим: `static` — `vite build` в ephemeral docker
build-runner'е, Caddy раздаёт артефакт через `file_server`. Sandbox-режим
(long-running container с Vite dev-server'ом) сохранён как fallback.

Полная спецификация — `docs/preview-provider/`:
- `MIGRATION_PATH.md` — 7 фаз; loop прошёл фазы 0–5 и весь автоматический
  объём фазы 6 (см. `IMPLEMENTATION_LOG.md`).
- `CONTRACTS.md` — TypeScript-сигнатуры (PreviewProvider, BuildQueue,
  ProjectFs, ProxyRouteTarget union).
- `BUILD_PIPELINE.md` — docker run flags, atomic swap, cancel flow,
  audit-log events.
- `SECURITY.md` — модель угроз + список митигаций (path-rejected,
  upload-rejected, magic-bytes, build-runner isolation).
- `VERIFICATION.md` — acceptance criteria; продуктовые сценарии 1–8 +
  10 инфра-проверок. Loop covered 10/10 локальные эквиваленты;
  product scenarios + p50/p95 metrics требуют staging (см.
  `docs/preview-provider/OPEN_QUESTIONS.md` §L1+L2).

Default `PREVIEW_PROVIDER=sandbox` сохранён до явного human-acceptance
фазы 6. Switch на `static` — отдельный коммит после ревью staging.

Migration scripts: `adorable/scripts/migrate-repo-metadata.ts` (bulk
backfill `boilerplateVersion` + `preview` block) +
`migrate-repo-to-static.ts` (per-project sandbox → static). Подробности
в `adorable/README.md`.
