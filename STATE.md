# Текущее состояние

**Итерация:** 3 завершена, идёт 4
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
- **Готово (iter 3):** `lib/adapters/sandbox.ts` интерфейс, `sandbox-mock.ts` in-memory реализация, `sandbox-docker.ts` заглушка, `tests/sandbox-contract.test.ts` 16 тестов (все зелёные).
- **Следующее (iter 4):** начать реализацию `sandbox-docker.ts` — dockerode, 15 ограничений, аудит-лог. Параллельно создать `lib/sandbox/audit-log.ts` (structured JSON lines).
- **После:** cleanup-worker.ts (TTL + idle), sandbox-security.test.ts (9 тестов), замена в adorable-vm.ts / create-tools.ts / chat/route.ts / repos/route.ts.

## Суммарные тесты
- `adorable/tests/llm-adapter.test.ts` — 17 тестов.
- `adorable/tests/sandbox-contract.test.ts` — 16 тестов.
- **Всего:** 33/33 зелёные.
- `npm run build` — зелёный.

## Что сделано
- Phase 0: инвентаризация.
- Phase 1: compose + Caddy + Gitea + scripts + README.
- Phase 1.5: LLM-адаптер (5 провайдеров).
- Phase 2 (часть 1 из ~5): SandboxProvider interface + mock + contract tests.

## Открытые риски/заметки
- `sandbox-docker.ts` на данный момент бросает — любой caller в dev c `SANDBOX_PROVIDER=docker` упадёт. Это ОК: существующие callers (adorable-vm, create-tools, chat/route) всё ещё используют Freestyle, замена на адаптер — отдельная задача Phase 2.
- StorageOpt.size требует overlay2 + xfs/btrfs — проверить на целевой хост-ноде, иначе fallback + `[!]` в плане.
- Для security-тестов нужно реальное окружение Docker в CI; на CI возможно потребуется Docker-in-Docker либо отдельный self-hosted runner.
