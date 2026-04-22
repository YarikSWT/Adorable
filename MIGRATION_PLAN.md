# План миграции Adorable fork → self-hosted

Этот план живёт вместе с форком. Задачи помечаются `[ ]` (открыто), `[x]` (закрыто), `[!]` (блокер), `[→v2]` (отложено на v2). Итерация Ralph закрывает максимум один логически связанный блок задач.

## Phase 0: Инвентаризация
- [x] grep freestyle → FREESTYLE_INVENTORY.md.
- [x] grep @ai-sdk/anthropic, @anthropic-ai/sdk → ANTHROPIC_INVENTORY.md.
- [x] Список npm-пакетов freestyle-*, @anthropic-ai/*, @ai-sdk/anthropic.
- [x] Картирование зон: sandbox / git / deploy / preview-proxy / llm.

## Phase 1: Инфраструктура разработки
- [x] `docker-compose.yml`: Postgres (app) + Postgres (Gitea) + Gitea + Caddy + сети `adorable_infra` и `adorable_sandboxes`.
- [x] `docker-compose.prod.yml` override с сервисом билдера для prod-симуляции (монтирование /var/run/docker.sock, сборка образа из `Dockerfile`).
- [x] Caddy стартует с включённым Admin API на `localhost:2019` и пустым начальным конфигом, persistent volume для certmagic.
- [x] `.env.example` актуальный и задокументирован.
- [x] `scripts/dev-infra.sh` + npm-скрипты `dev:infra:up` / `dev:infra:down`.
- [x] `scripts/init-gitea.sh` для автосоздания admin-юзера и токена (идемпотентный).
- [x] `Dockerfile` для образа билдера (использует `node:22-slim`, включает `ruby + kamal` как dev-зависимость).
- [x] Verification: Gitea API+UI доступны, Caddy Admin API отвечает (см. VERIFICATION_LOG.md 2026-04-21).
- [x] README: раздел «Локальная разработка» (переписан полностью).

## Phase 1.5: Замена LLM-провайдера (Anthropic → GLM/Z.ai)
- [x] `adorable/lib/adapters/llm.ts` — интерфейс `LLMProvider` + фабрика `createLLM()`.
- [x] Провайдеры: `zai` (через `@ai-sdk/openai-compatible`), `openrouter` (через `@openrouter/ai-sdk-provider`), `anthropic` (fallback), `openai` (fallback), `mock`.
- [x] `adorable/lib/adapters/llm-mock.ts` для тестов (через `ai/test` `MockLanguageModelV3`).
- [x] `adorable/tests/llm-adapter.test.ts` — 17 тестов: контракт + переключение по env + end-to-end стриминг через mock.
- [x] Переписан `adorable/lib/llm-provider.ts` — тонкая обёртка: `streamLlmResponse` → `createLLM(...).main` → `streamText`. Все `@ai-sdk/*` LLM-импорты в бизнес-коде только в `lib/adapters/llm.ts`.
- [x] `npm run build` зелёный, `npm run test` зелёный (17/17).
- [→Phase 2] Playwright MCP: создание проекта → промпт → GLM отвечает (блокировано отсутствием sandbox — перенос в Phase 2 финал-верификацию).
- [→Phase 2] Убедиться что tool use / function calling корректны у GLM (проверяется на Phase 2 e2e).
- [x] README: раздел про `LLM_PROVIDER` и ключи (в текущем README уже есть `.env` с ключами — но отдельный раздел про провайдеры добавить в Phase 6).

## Phase 2: Замена Sandbox (Freestyle VMs → Docker)
- [x] `adorable/lib/adapters/sandbox.ts` — интерфейс `SandboxProvider` (create / ref / destroy / list) + SandboxHandle { exec, fs.readTextFile/readFile/writeTextFile/exists, devServer.getLogs, domains, ports, status }. env `SANDBOX_PROVIDER` переключает docker/mock.
- [x] `adorable/lib/adapters/sandbox-mock.ts` + `tests/sandbox-contract.test.ts` (16 тестов, зелёные): lifecycle, fs roundtrip, ref errors, domains/ports, custom exec handlers.
- [x] `adorable/lib/adapters/sandbox-docker.ts` — полная реализация через dockerode: create (+ workspace volume, все 15 ограничений), ref, destroy (stop+remove+volume), list (label filter). exec через Docker Exec API с демуксом stdout/stderr. fs через putArchive/getArchive (tar-stream). Интеграция с audit-log. Чистый билдер конфига в `sandbox-docker-config.ts` + 21 unit-тест `tests/sandbox-docker-config.test.ts`, все 15 ограничений проверены явно.
- [x] `adorable/lib/sandbox/cleanup-worker.ts` — TTL (`SANDBOX_MAX_LIFETIME_MIN`) + idle (`SANDBOX_IDLE_TIMEOUT_MIN`) с `touch(sandboxId)` API для регистрации активности. Опциональный каскад через `proxyProvider.removeSandboxRoutes`. Injectable clock для тестов. Singleton + start/stop/sweepOnce. `tests/cleanup-worker.test.ts` — 11 тестов, 78/78 зелёные. Cascade в Caddy будет подключён в Phase 4.
- [x] `adorable/lib/sandbox/audit-log.ts` — structured JSON-lines log, env-configurable, serialized parallel writes, 10 тестов `tests/audit-log.test.ts`.
- [ ] `adorable/tests/sandbox-security.test.ts` — 9 security-тестов.
- [ ] Замена `adorable-vm.ts`, `create-tools.ts`, `chat/route.ts`, `repos/route.ts` на использование адаптера.
- [ ] Playwright MCP: создание проекта → `docker inspect` видит все лимиты.
- [ ] Удаление `freestyle-sandboxes`, `@freestyle-sh/*` из `adorable/package.json`.

## Phase 3: Замена Git (Freestyle Git → Gitea)
- [ ] `adorable/lib/adapters/git.ts` — интерфейс `GitProvider` (createRepo, ref, commits.list, contents.get, commits.create, branches.getDefault, githubSync.enable|disable).
- [ ] `adorable/lib/adapters/git-mock.ts` + контрактные тесты.
- [ ] `adorable/lib/adapters/git-gitea.ts` — через Gitea REST API v1 (fetch + токен из env).
- [ ] Замена всех freestyle.git.* вызовов (`repo-storage.ts`, `deployment-status.ts`, `repos/route.ts`, `identity-session.ts`).
- [ ] Упрощение identity-session.ts — Gitea auth через server-side token + per-user cookie identity (без Freestyle identity).
- [ ] Playwright MCP: создание проекта → репо в Gitea UI видно.

## Phase 4: Preview URLs через Caddy
- [ ] `adorable/lib/adapters/proxy.ts` — интерфейс `ProxyProvider` (addRoute, removeRoute, listRoutes, healthCheck).
- [ ] `adorable/lib/adapters/proxy-mock.ts`.
- [ ] `adorable/lib/adapters/proxy-caddy.ts` — управление через Caddy Admin API (PUT на `/config/apps/http/servers/<server>/routes/<id>`).
- [ ] Sandbox lifecycle hooks: при create контейнера → addRoute, при destroy → removeRoute.
- [ ] `adorable/tests/proxy-security.test.ts` + `proxy-integration.test.ts` (5 тестов).
- [ ] Playwright MCP: AI генерирует Express-сервер → `*.preview.localhost` через Caddy отдаёт HTML.

## Phase 5: Замена Deploy (опционально v2)
- [ ] `adorable/lib/adapters/deploy.ts` — интерфейс `DeployProvider`.
- [ ] `adorable/lib/adapters/deploy-kamal.ts` через `child_process.execFile`.
- [ ] `config/deploy.yml` шаблон для пользовательских проектов.
- [ ] Мок-тест Kamal-адаптера.

## Phase 6: Финальная уборка
- [ ] Удалить всё `freestyle-*` и (если не fallback) `@ai-sdk/anthropic` из `adorable/package.json`.
- [ ] Полное обновление README.
- [ ] `FORK_CHANGES.md` с diff vs upstream.
- [ ] `SECURITY.md` с моделью угроз.
- [ ] CI workflow GitHub Actions (tests + Playwright e2e + security tests).
- [ ] `config/deploy.yml` для самого билдера Adorable.
- [ ] Финальный e2e в prod-профиле + `verification/screenshots/final-e2e-prod.png`.
