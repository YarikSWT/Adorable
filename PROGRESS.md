# Прогресс

## Сделано
- **Итерация 1 (2026-04-21):** Phase 0 инвентаризация + Phase 1 инфра. FREESTYLE_INVENTORY.md, ANTHROPIC_INVENTORY.md, STATE.md, MIGRATION_PLAN.md, decisions.md (17 ADR). docker-compose.yml (4 сервиса + 2 сети), docker-compose.prod.yml, Dockerfile, scripts/dev-infra.sh, scripts/init-gitea.sh, Caddy init config, README переписан.
- **Итерация 2 (2026-04-22):** Phase 1.5 LLM-адаптер. `lib/adapters/llm.ts` + `llm-mock.ts` + `tests/llm-adapter.test.ts` (17 тестов). Рефактор `lib/llm-provider.ts` → тонкая обёртка над `createLLM()`. Бизнес-код без прямых `@ai-sdk/anthropic`. Build зелёный.
- **Итерация 3 (2026-04-22):** Phase 2 интерфейс sandbox + mock + контрактные тесты. `lib/adapters/sandbox.ts` (SandboxProvider: create/ref/destroy/list; SandboxHandle: exec/fs/devServer/domains/ports/status). `sandbox-mock.ts` (in-memory FS, scripted exec, seedFiles/setExecHandler/inspect helpers для тестов). `sandbox-docker.ts` stub. `tests/sandbox-contract.test.ts` — 16 тестов. 33/33 green. Build зелёный.

## В работе
Phase 2: Sandbox Docker-реализация.

## Следующее (iter 4)
- `lib/sandbox/audit-log.ts` — structured JSON lines в `SANDBOX_AUDIT_LOG`.
- Начало `lib/adapters/sandbox-docker.ts` — базовый create/destroy через dockerode со всеми 15 ограничениями.
- В следующих итерациях: cleanup-worker, security-tests, интеграция в callers, удаление freestyle-sandboxes.
