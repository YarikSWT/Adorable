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
- **Итерация 12 (2026-04-22):** Phase 4 kickoff — ProxyProvider. `lib/adapters/proxy.ts` interface (addRoute/removeRoute/removeSandboxRoutes/listRoutes/healthCheck) + env PROXY_PROVIDER. `lib/adapters/proxy-mock.ts` in-memory (idempotent upsert, stats, healthy toggle) + `tests/proxy-contract.test.ts` 9 тестов. `lib/adapters/proxy-caddy.ts` — Caddy Admin API через fetch. Каждый роут получает `@id = adorable-route-<id>` для точечных операций. Idempotent upsert реализован через PATCH /id (replace in place) + fallback POST /routes/... на 404 (Caddy PUT /id на list-path делает insert, а не replace — поэтому PATCH). Retry loop (3 попытки + Connection:close) решил UND_ERR_SOCKET ("other side closed") в undici при back-to-back мутациях. `tests/proxy-caddy-integration.test.ts` — 6 тестов (health, add+list, idempotent, remove, idempotent-remove, removeSandboxRoutes) все зелёные против Caddy 2.8.

## В работе
Phase 4: Sandbox lifecycle hooks + proxy security tests.

## Следующее (iter 13)
- ProxyProvider singleton по аналогии с sandbox/git.
- Sandbox hooks: `adorable-vm.ts` `createVmForRepo` после sandbox.create → provider.addRoute для каждого domain. `chat/route.ts` — cleanup-worker cascade подключается через `removeSandboxRoutes` proxy. Cleanup worker принимает ProxyProvider в опциях.
- `tests/proxy-security.test.ts` + `tests/proxy-integration.test.ts` — оставшиеся security-тесты: caddyAdminApiNotExposed (localhost-only bind), sandboxLifecycleSyncsProxy (через mock), healthCheckDetectsDownstream.
