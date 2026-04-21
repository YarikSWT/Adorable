# Прогресс

## Сделано
- **Итерация 1 (2026-04-21):** Phase 0 инвентаризация + Phase 1 инфраструктура.
  - Phase 0: FREESTYLE_INVENTORY.md, ANTHROPIC_INVENTORY.md, STATE.md, PROGRESS.md, MIGRATION_PLAN.md, decisions.md (17 ADR), VERIFICATION_LOG.md, BLOCKERS.md, SECURITY_BLOCKERS.md.
  - Phase 1: `docker-compose.yml` (4 сервиса + 2 сети), `docker-compose.prod.yml` (билдер + проброс docker.sock), Caddy init JSON, Dockerfile, scripts/dev-infra.sh, scripts/init-gitea.sh, .env.example, обновлённый README, package.json с dev:infra:* скриптами.
  - Verification Phase 1: compose up → все healthy, Caddy Admin API отвечает (PUT/DELETE route работает), Gitea API/UI работают, init-gitea идемпотентный.

## В работе
Phase 1.5: LLM-адаптер (Anthropic → GLM/Z.ai).

## Следующее
- `adorable/lib/adapters/llm.ts` — интерфейс + zai / openrouter / anthropic / openai / mock провайдеры.
- `adorable/lib/adapters/llm-mock.ts`.
- `adorable/tests/llm-adapter.test.ts`.
- Рефактор `adorable/lib/llm-provider.ts` — тонкая обёртка над адаптером.
- Установка зависимостей: `@ai-sdk/openai-compatible`, `@openrouter/ai-sdk-provider`, `vitest`.
- Phase 2+ (sandbox / git / proxy / deploy / cleanup).
