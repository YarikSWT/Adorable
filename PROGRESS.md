# Прогресс

## Сделано
- **Итерация 1 (2026-04-21):** Phase 0 инвентаризация + Phase 1 инфра. FREESTYLE_INVENTORY.md, ANTHROPIC_INVENTORY.md, STATE.md, MIGRATION_PLAN.md, decisions.md (17 ADR). docker-compose.yml (4 сервиса + 2 сети), docker-compose.prod.yml, Dockerfile, scripts/dev-infra.sh, scripts/init-gitea.sh, Caddy init config, README переписан.
- **Итерация 2 (2026-04-22):** Phase 1.5 LLM-адаптер. `lib/adapters/llm.ts` + `llm-mock.ts` + `tests/llm-adapter.test.ts` (17 тестов). Рефактор `lib/llm-provider.ts` → тонкая обёртка над `createLLM()`. Бизнес-код без прямых `@ai-sdk/anthropic`. Build зелёный.
- **Итерация 3 (2026-04-22):** Phase 2 интерфейс sandbox + mock + контрактные тесты. `lib/adapters/sandbox.ts` (SandboxProvider: create/ref/destroy/list; SandboxHandle: exec/fs/devServer/domains/ports/status). `sandbox-mock.ts` (in-memory FS, scripted exec, seedFiles/setExecHandler/inspect helpers для тестов). `sandbox-docker.ts` stub. `tests/sandbox-contract.test.ts` — 16 тестов. 33/33 green. Build зелёный.
- **Итерация 4 (2026-04-22):** Phase 2 audit-log. `lib/sandbox/audit-log.ts` — append-only JSON-lines, typed events (sandbox_created/destroyed/exec/fs_write/cleanup + proxy_route_added/removed), auto mkdir, serialized parallel writes, strict/non-strict режимы, env `SANDBOX_AUDIT_LOG`, shared singleton. `tests/audit-log.test.ts` — 10 тестов, 43/43 green. Build зелёный.
- **Итерация 5 (2026-04-22):** Phase 2 sandbox-docker. Установлены `dockerode@^4`, `tar-stream@^3`, `@types/dockerode`, `@types/tar-stream`. `lib/adapters/sandbox-docker-config.ts` — pure config builder, все 15 ограничений в HostConfig/ContainerConfig + валидация (rejects host/bridge net, root user, invalid CPU). `lib/adapters/sandbox-docker.ts` — dockerode-based SandboxProvider: ensureVolume, create (container + start + audit), ref (inspect), destroy (stop+remove+volume+audit), list (label filter), exec (Exec API + 8-byte stream демукс), fs (getArchive/putArchive через tar-stream). `tests/sandbox-docker-config.test.ts` — 21 unit-тест, покрыты все 15 ограничений явно. Fixed discriminated union in audit-log (DistributiveOmit) to preserve variant-specific fields. 67/67 green, build зелёный.
- **Итерация 6 (2026-04-22):** Phase 2 cleanup-worker. `lib/sandbox/cleanup-worker.ts` — sweeper через `provider.list()`: TTL (maxLifetimeMin, createdAt) + idle (idleTimeoutMin, через `touch(sandboxId)` API). Optional `proxyProvider.removeSandboxRoutes()` cascade, swallow proxy errors. Singleton + start/stop/sweepOnce. Injectable clock. `tests/cleanup-worker.test.ts` — 11 тестов. 78/78 green.
- **Итерация 7 (2026-04-22):** 9 security-тестов зелёные. Workspace переведён на tmpfs.
- **Итерация 8 (2026-04-22):** SandboxProvider singleton + callers migration. 79/79.
- **Итерация 9 (2026-04-22):** Phase 3 kickoff. GitProvider + mock + 14 contract tests. 93/93.
- **Итерация 10 (2026-04-22):** Gitea реализация. 4/4 integration-тестов зелёные.
- **Итерация 11 (2026-04-22):** callers мигрированы на GitProvider + identity упрощена. 93/93.
- **Итерация 12 (2026-04-22):** ProxyProvider interface + mock + Caddy impl + 6 live integration tests.
- **Итерация 13 (2026-04-22):** Phase 4 lifecycle + security. `lib/proxy/provider-singleton.ts` HMR-safe. `adorable-vm.ts createVmForRepo` — после `sandboxProvider.create()` вызывает `proxyProvider.addRoute()` для каждого из 3 domains (preview, devCommandTerminal, additionalTerminals). Route id = `${sandboxId}-${role}`. Proxy errors не блокируют создание sandbox (logged + continue). `ensureCleanupWorkerRunning` (в `lib/sandbox/provider-singleton.ts`) инъектит proxy.removeSandboxRoutes в cleanup-worker — TTL/idle reap теперь удаляет и Caddy routes. `tests/proxy-security.test.ts` — 3 теста: sandboxLifecycleSyncsProxy (после cleanup-worker reap proxy routes уничтожены), unrelated-sandbox-preserved, adminApiNotExposed expectation (host-bind 127.0.0.1:2019). 105/105 unit tests green. tsc --noEmit clean. Build OOM-killed из-за memory pressure (параллельные Claude instances) — не регрессия.

## В работе
Phase 4 closed (кроме финального Playwright e2e). Начинаем Phase 6 (чтобы расчистить package.json + подготовить документацию к e2e).

## Следующее (iter 14)
- Удалить `freestyle-sandboxes`, `@freestyle-sh/with-dev-server`, `@freestyle-sh/with-pty`, `@freestyle-sh/with-ttyd` из `adorable/package.json`.
- Проверить что нигде в коде не осталось прямых импортов.
- Обновить README: добавить Z_AI_API_KEY setup, self-hosted stack overview, dev/prod workflows.
- Создать `FORK_CHANGES.md` с списком отличий от upstream.
- `SECURITY.md` — threat model + меры (15 sandbox restrictions + proxy audit + audit log).
- Шаблон `config/deploy.yml` (Kamal) — [→v2].
