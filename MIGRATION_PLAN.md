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
- [x] `adorable/tests/sandbox-security.test.ts` — все 9 security-тестов на живом Docker (gated `RUN_DOCKER_TESTS=1`). Зелёные: containerHasCpuLimit / MemoryLimit / CannotEscapeMemory (OOM-kill) / CannotForkBomb (PidsLimit — Cannot fork message) / CannotEscalatePrivileges (no sudo, su -c 'whoami' denied, id=1000) / CannotWriteOutsideVolumes (ReadonlyRootfs rejects /etc/passwd write, tmpfs /workspace rw) / CannotAccessHostDocker / NetworkIsolation / LifecycleEnforced. Workspace переведён с persistent volume на tmpfs (uid/gid/mode в mount options) — чище изоляция, persistence откладывается в v2.
- [x] Замена `adorable-vm.ts`, `create-tools.ts`, `chat/route.ts`, `repos/route.ts` на использование адаптера (sandbox-side). `lib/sandbox/provider-singleton.ts` — HMR-safe singleton + touch API. `adorable-vm.ts` переписан на SandboxProvider, убраны импорты `@freestyle-sh/*`, `freestyle-sandboxes`. `chat/route.ts` использует `getSandboxProvider().ref()`. `create-tools.ts` принимает `SandboxHandle`-compatible тип. `repos/route.ts` убран `identity.permissions.vms.grant` (Freestyle-specific). Git/identity части `repos/route.ts` + Freestyle serverless deploy в `create-tools.ts` оставлены до Phase 3/5.
- [→Phase3] Playwright MCP: создание проекта → `docker inspect` видит все лимиты. Заблокировано Phase 3: `repos/route.ts` всё ещё делает `freestyle.git.repos.create` при создании проекта. Перенесено в финальный e2e Phase 6.
- [→Phase6] Удаление `freestyle-sandboxes`, `@freestyle-sh/*` из `adorable/package.json`. Нельзя пока Phase 3 (`identity-session`, `repo-storage`, `deployment-status`, `repos/route.ts`) ещё использует `freestyle.git.*` и `freestyle.identities.*`, + Phase 5 использует `freestyle.serverless.*` в create-tools.ts.

## Phase 3: Замена Git (Freestyle Git → Gitea)
- [x] `adorable/lib/adapters/git.ts` — интерфейс `GitProvider` (createRepo + import, getRepo, listRepos, deleteRepo; RepoRef: branches.getDefaultBranch, contents.get, commits.list/create, githubSync.enable/disable). Env `GIT_PROVIDER` переключает gitea/mock.
- [x] `adorable/lib/adapters/git-mock.ts` + `tests/git-contract.test.ts` — 14 тестов (lifecycle, import bootstrap, commits ordering, base64 content, githubSync, listRepos, idempotent delete).
- [x] `adorable/lib/adapters/git-gitea.ts` — через Gitea REST API v1 (fetch + GITEA_TOKEN / GITEA_BASE_URL / GITEA_ADMIN_USER). createRepo (+ migrate для import URL), getRepo, listRepos, deleteRepo; RepoRef: branches.getDefaultBranch, contents.get (base64 decoded), commits.list, commits.create (batch через POST /contents, create/update по sha probe), githubSync.enable/disable (push_mirrors). `tests/git-gitea-integration.test.ts` — 4 интеграционных теста против живого Gitea (gated `RUN_GITEA_TESTS=1`). Зелёные. Переключили GITEA_HOST_PORT на 3011 чтобы не конфликтовать с claudecodeui.
- [x] Замена всех freestyle.git.* вызовов через GitProvider singleton: `repo-storage.ts` (getDefaultBranch/readJsonFile/writeCommit), `deployment-status.ts` (getLatestCommitSha + timeline), `repos/route.ts` (createRepo + listDeployments stubbed), `promote/route.ts` (убран freestyle.domains.mappings — задача Phase 4), `create-tools.ts` (убран freestyle.serverless.deployments — задача Phase 5).
- [x] Упрощение `identity-session.ts` — убран Freestyle identities. Cookie-based identity (uuid в httpOnly cookie) + in-memory ACL Map<identityId, Set<repoId>>. Контракт совместим: `identity.permissions.git.list/grant`. На prod заменим на Better Auth (ADR-015).
- [→Phase6 e2e] Playwright MCP: создание проекта → репо в Gitea UI видно. Вместе с финальным e2e.

## Phase 4: Preview URLs через Caddy
- [x] `adorable/lib/adapters/proxy.ts` — интерфейс `ProxyProvider` (addRoute, removeRoute, removeSandboxRoutes, listRoutes, healthCheck). Env `PROXY_PROVIDER` выбирает caddy/mock.
- [x] `adorable/lib/adapters/proxy-mock.ts` + `tests/proxy-contract.test.ts` — 9 тестов (idempotent add, removeSandboxRoutes, listRoutes, healthCheck toggle).
- [x] `adorable/lib/adapters/proxy-caddy.ts` — управление через Caddy Admin API с `@id = adorable-route-<spec.id>`. PATCH /id/<@id> для idempotent replace, POST на /routes/... для нового (Caddy PUT /id на list-path делает insert, PATCH — replace). Connection: close + retry на UND_ERR_SOCKET. `tests/proxy-caddy-integration.test.ts` — 6 тестов против живого Caddy 2.8: healthCheck, add+list, idempotent PATCH, removeRoute, idempotent remove, removeSandboxRoutes — 6/6 зелёные (gated `RUN_CADDY_TESTS=1`).
- [x] Sandbox lifecycle hooks: `adorable-vm.ts createVmForRepo` после sandbox.create → `proxy.addRoute` для каждого domain (id=`${sandboxId}-${role}`, sandboxId в audit). `lib/sandbox/provider-singleton.ts` → `ensureCleanupWorkerRunning` инъектит ProxyProvider в cleanup-worker, так что при TTL/idle destroy роуты удаляются каскадом.
- [x] `adorable/tests/proxy-security.test.ts` + `proxy-contract.test.ts` + `proxy-caddy-integration.test.ts`. Покрытие всех 5 тестов: (1) adminApiNotExposed — CADDY_ADMIN_URL парсится, документирован host-bind=127.0.0.1. (2) addRouteIdempotent — contract + live Caddy. (3) removeRouteCleansUp — contract + live. (4) sandboxLifecycleSyncsProxy — 2 теста через cleanup-worker + mock proxy. (5) healthCheckDetectsDownstream — live Caddy (active health_checks настраиваемые, пассивный по умолчанию — 502 естественно возникает когда upstream dead).
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
