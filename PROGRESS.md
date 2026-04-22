# Прогресс

## Сделано
- **Итерация 1 (2026-04-21):** Phase 0 инвентаризация + Phase 1 инфраструктура.
  - Phase 0: FREESTYLE_INVENTORY.md, ANTHROPIC_INVENTORY.md, STATE.md, PROGRESS.md, MIGRATION_PLAN.md, decisions.md (17 ADR), VERIFICATION_LOG.md, BLOCKERS.md, SECURITY_BLOCKERS.md.
  - Phase 1: `docker-compose.yml` (4 сервиса + 2 сети), `docker-compose.prod.yml` (билдер + проброс docker.sock), Caddy init JSON, Dockerfile, scripts/dev-infra.sh, scripts/init-gitea.sh, .env.example, обновлённый README, package.json с dev:infra:* скриптами.
  - Verification Phase 1: compose up → все healthy, Caddy Admin API отвечает, Gitea API/UI работают, init-gitea идемпотентный.
- **Итерация 2 (2026-04-22):** Phase 1.5 LLM-адаптер.
  - `adorable/lib/adapters/llm.ts` с 5 провайдерами (zai / openrouter / anthropic / openai / mock). Переключение через `LLM_PROVIDER` env.
  - `adorable/lib/adapters/llm-mock.ts` через `ai/test` MockLanguageModelV3.
  - `adorable/tests/llm-adapter.test.ts` — 17 тестов, зелёные.
  - Рефактор `adorable/lib/llm-provider.ts` — тонкая обёртка над `createLLM()`.
  - Исправлена TS-ошибка сборки (`LanguageModelV3GenerateResult` не экспортируется из `@ai-sdk/provider@2` в workspace из-за @ai-sdk/anthropic — обошли через structural literal + `as never`).
  - `npm run build` зелёный. `npm run test` 17/17.

## В работе
Phase 2: Sandbox (Freestyle VMs → Docker + dockerode).

## Следующее (iter 3)
- Создать интерфейс `adorable/lib/adapters/sandbox.ts` (SandboxProvider: create / destroy / exec / fs.read / fs.write / getLogs / status).
- Создать `adorable/lib/adapters/sandbox-mock.ts` с in-memory реализацией.
- Написать `adorable/tests/sandbox-contract.test.ts` — контрактные тесты (mock).
- Держать контракт максимально близко к `freestyle.vms.ref({...}).exec / fs / devServer` чтобы минимально менять callers.
- В следующей итерации — реализация docker-provider + security tests.
