# Текущее состояние

**Итерация:** 6 завершена, идёт 7
**Дата:** 2026-04-22

## Окружение
- Node: v22.22.2 (nvm).
- Docker: 29.4.1, daemon работает.
- npm workspaces.
- `.env` с ключами Z_AI, BETTER_AUTH_SECRET, GITEA_* готовы.

## Инфра (Phase 1) — готово
- 4 сервиса: `adorable-postgres-app`, `adorable-postgres-gitea`, `adorable-gitea` (1.22.3), `adorable-caddy` (2.8-alpine).
- Gitea UI/API: `http://127.0.0.1:3001`. Caddy Admin API: `http://127.0.0.1:2019`. HTTP:8080, HTTPS:8443.
- Сети: `adorable_infra` (инфра), `adorable_sandboxes` (sandbox'ы + Caddy).

## LLM (Phase 1.5) — готово
- 5 провайдеров в `lib/adapters/llm.ts`. Тесты 17/17.

## Sandbox (Phase 2) — в работе
- **Готово (iter 3):** `lib/adapters/sandbox.ts` интерфейс, `sandbox-mock.ts` in-memory реализация, `sandbox-docker.ts` заглушка, `tests/sandbox-contract.test.ts` 16 тестов.
- **Готово (iter 4):** `lib/sandbox/audit-log.ts` — structured JSON-lines. Event types: sandbox_created, sandbox_destroyed, sandbox_exec, sandbox_fs_write, sandbox_cleanup, proxy_route_added/removed. Serialized promise-chain. Env `SANDBOX_AUDIT_LOG`. 10 тестов.
- **Готово (iter 5):** `sandbox-docker-config.ts` (чистый билдер, все 15), `sandbox-docker.ts` (dockerode create/ref/destroy/list/exec/fs). 21 unit-тест.
- **Готово (iter 6):** `lib/sandbox/cleanup-worker.ts` — периодический sweeper через `provider.list()`. TTL = maxLifetimeMin (createdAt), idle = idleTimeoutMin (last touch). `touch(sandboxId)` API для регистрации активности. Каскад через `proxyProvider.removeSandboxRoutes()` опциональный (подключим в Phase 4). Singleton + `start/stop/sweepOnce`. Injectable clock для детерминированных тестов. `tests/cleanup-worker.test.ts` — 11 тестов.
- **Следующее (iter 7):** `tests/sandbox-security.test.ts` — 9 security-тестов на реальном Docker. Gated on `RUN_DOCKER_TESTS=1`. После security: замена callers (adorable-vm.ts → SandboxProvider), удаление freestyle-sandboxes.
- **После:** Phase 3 (Git→Gitea), Phase 4 (Caddy proxy), Phase 6 (FORK_CHANGES.md / SECURITY.md / e2e).

## Суммарные тесты
- `tests/llm-adapter.test.ts` — 17 тестов.
- `tests/sandbox-contract.test.ts` — 16 тестов.
- `tests/audit-log.test.ts` — 10 тестов.
- `tests/sandbox-docker-config.test.ts` — 21 тест.
- `tests/cleanup-worker.test.ts` — 11 тестов.
- **Всего:** 78/78 зелёные.
- `npm run build` — зелёный (NODE_OPTIONS=--max-old-space-size=4096 из-за Next 16 Turbopack).

## Что сделано
- Phase 0: инвентаризация.
- Phase 1: compose + Caddy + Gitea + scripts + README.
- Phase 1.5: LLM-адаптер (5 провайдеров).
- Phase 2 (часть 1 из ~5): SandboxProvider interface + mock + contract tests.

## Открытые риски/заметки
- `sandbox-docker.ts` на данный момент бросает — любой caller в dev c `SANDBOX_PROVIDER=docker` упадёт. Это ОК: существующие callers (adorable-vm, create-tools, chat/route) всё ещё используют Freestyle, замена на адаптер — отдельная задача Phase 2.
- StorageOpt.size требует overlay2 + xfs/btrfs — проверить на целевой хост-ноде, иначе fallback + `[!]` в плане.
- Для security-тестов нужно реальное окружение Docker в CI; на CI возможно потребуется Docker-in-Docker либо отдельный self-hosted runner.
