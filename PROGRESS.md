# Прогресс

## Сделано
- **Итерация 1 (2026-04-21):** Phase 0 инвентаризация + Phase 1 инфра. FREESTYLE_INVENTORY.md, ANTHROPIC_INVENTORY.md, STATE.md, MIGRATION_PLAN.md, decisions.md (17 ADR). docker-compose.yml (4 сервиса + 2 сети), docker-compose.prod.yml, Dockerfile, scripts/dev-infra.sh, scripts/init-gitea.sh, Caddy init config, README переписан.
- **Итерация 2 (2026-04-22):** Phase 1.5 LLM-адаптер. `lib/adapters/llm.ts` + `llm-mock.ts` + `tests/llm-adapter.test.ts` (17 тестов). Рефактор `lib/llm-provider.ts` → тонкая обёртка над `createLLM()`. Бизнес-код без прямых `@ai-sdk/anthropic`. Build зелёный.
- **Итерация 3 (2026-04-22):** Phase 2 интерфейс sandbox + mock + контрактные тесты. `lib/adapters/sandbox.ts` (SandboxProvider: create/ref/destroy/list; SandboxHandle: exec/fs/devServer/domains/ports/status). `sandbox-mock.ts` (in-memory FS, scripted exec, seedFiles/setExecHandler/inspect helpers для тестов). `sandbox-docker.ts` stub. `tests/sandbox-contract.test.ts` — 16 тестов. 33/33 green. Build зелёный.
- **Итерация 4 (2026-04-22):** Phase 2 audit-log. `lib/sandbox/audit-log.ts` — append-only JSON-lines, typed events (sandbox_created/destroyed/exec/fs_write/cleanup + proxy_route_added/removed), auto mkdir, serialized parallel writes, strict/non-strict режимы, env `SANDBOX_AUDIT_LOG`, shared singleton. `tests/audit-log.test.ts` — 10 тестов, 43/43 green. Build зелёный.

## В работе
Phase 2: Sandbox Docker-реализация.

## Следующее (iter 5)
- `lib/adapters/sandbox-docker.ts` — полная реализация через dockerode: create с ВСЕМИ 15 ограничениями (NanoCpus, Memory=MemorySwap, PidsLimit, ReadonlyRootfs, SecurityOpt=no-new-privileges, CapDrop ALL, User 1000:1000, Ulimits nofile/core, StorageOpt.Size, BlkioDevice*Bps, NetworkMode=adorable_sandboxes, AutoRemove, Tmpfs /tmp, Audit log). exec через Exec API. fs через putArchive/getArchive либо через exec cat/tee. list через listContainers + label filter. Интеграция с `audit-log.ts`.
- В следующих итерациях: cleanup-worker, security-tests (9), интеграция в callers (adorable-vm → SandboxProvider), удаление freestyle-sandboxes.
