# Прогресс

## Сделано
- **Итерация 1 (2026-04-21):** Phase 0 инвентаризация + Phase 1 инфра. FREESTYLE_INVENTORY.md, ANTHROPIC_INVENTORY.md, STATE.md, MIGRATION_PLAN.md, decisions.md (17 ADR). docker-compose.yml (4 сервиса + 2 сети), docker-compose.prod.yml, Dockerfile, scripts/dev-infra.sh, scripts/init-gitea.sh, Caddy init config, README переписан.
- **Итерация 2 (2026-04-22):** Phase 1.5 LLM-адаптер. `lib/adapters/llm.ts` + `llm-mock.ts` + `tests/llm-adapter.test.ts` (17 тестов). Рефактор `lib/llm-provider.ts` → тонкая обёртка над `createLLM()`. Бизнес-код без прямых `@ai-sdk/anthropic`. Build зелёный.
- **Итерация 3 (2026-04-22):** Phase 2 интерфейс sandbox + mock + контрактные тесты. `lib/adapters/sandbox.ts` (SandboxProvider: create/ref/destroy/list; SandboxHandle: exec/fs/devServer/domains/ports/status). `sandbox-mock.ts` (in-memory FS, scripted exec, seedFiles/setExecHandler/inspect helpers для тестов). `sandbox-docker.ts` stub. `tests/sandbox-contract.test.ts` — 16 тестов. 33/33 green. Build зелёный.
- **Итерация 4 (2026-04-22):** Phase 2 audit-log. `lib/sandbox/audit-log.ts` — append-only JSON-lines, typed events (sandbox_created/destroyed/exec/fs_write/cleanup + proxy_route_added/removed), auto mkdir, serialized parallel writes, strict/non-strict режимы, env `SANDBOX_AUDIT_LOG`, shared singleton. `tests/audit-log.test.ts` — 10 тестов, 43/43 green. Build зелёный.
- **Итерация 5 (2026-04-22):** Phase 2 sandbox-docker. Установлены `dockerode@^4`, `tar-stream@^3`, `@types/dockerode`, `@types/tar-stream`. `lib/adapters/sandbox-docker-config.ts` — pure config builder, все 15 ограничений в HostConfig/ContainerConfig + валидация (rejects host/bridge net, root user, invalid CPU). `lib/adapters/sandbox-docker.ts` — dockerode-based SandboxProvider: ensureVolume, create (container + start + audit), ref (inspect), destroy (stop+remove+volume+audit), list (label filter), exec (Exec API + 8-byte stream демукс), fs (getArchive/putArchive через tar-stream). `tests/sandbox-docker-config.test.ts` — 21 unit-тест, покрыты все 15 ограничений явно. Fixed discriminated union in audit-log (DistributiveOmit) to preserve variant-specific fields. 67/67 green, build зелёный.
- **Итерация 6 (2026-04-22):** Phase 2 cleanup-worker. `lib/sandbox/cleanup-worker.ts` — sweeper через `provider.list()`: TTL (maxLifetimeMin, createdAt) + idle (idleTimeoutMin, через `touch(sandboxId)` API). Optional `proxyProvider.removeSandboxRoutes()` cascade, swallow proxy errors. Singleton + start/stop/sweepOnce. Injectable clock. `tests/cleanup-worker.test.ts` — 11 тестов. 78/78 green.
- **Итерация 7 (2026-04-22):** 9 security-тестов зелёные. Workspace переведён на tmpfs.
- **Итерация 8 (2026-04-22):** callers мигрированы на SandboxProvider. Новый `lib/sandbox/provider-singleton.ts` (HMR-safe, `getSandboxProvider`/`touchSandbox`/`ensureCleanupWorkerRunning`). `adorable-vm.ts` полностью переписан: SandboxProvider.create() + 3 domains (preview/devCommand/additionalTerminals), убраны `@freestyle-sh/with-*` + `freestyle-sandboxes` импорты. `chat/route.ts`: `getSandboxProvider().ref()` + cleanup worker + touch. `create-tools.ts`: `SandboxLike` structural type. `repos/route.ts`: убран `identity.permissions.vms.grant()`. Остаются Freestyle git + serverless deploy (Phase 3/5). `.env.example` + PREVIEW_PROTOCOL. 79/79 тестов зелёные, build зелёный.

## В работе
Phase 3: Git → Gitea.

## Следующее (iter 9)
- `adorable/lib/adapters/git.ts` — интерфейс GitProvider: createRepo (+ import url), ref, contents.get, commits.list, commits.create (+ author), branches.getDefault, githubSync.enable|disable.
- `adorable/lib/adapters/git-mock.ts` — in-memory реализация + контрактные тесты.
- Затем `git-gitea.ts` (REST API v1 + GITEA_TOKEN из env).
- Замена всех freestyle.git.* callers (`repo-storage.ts`, `deployment-status.ts`, `repos/route.ts`), упрощение `identity-session.ts` (Better Auth).
