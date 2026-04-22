# Текущее состояние

**Итерация:** 5 завершена, идёт 6
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
- **Готово (iter 5):** `lib/adapters/sandbox-docker-config.ts` — чистый билдер ContainerCreateOptions со ВСЕМИ 15 ограничениями (NanoCpus, Memory/MemorySwap, PidsLimit, ReadonlyRootfs, SecurityOpt no-new-privileges, CapDrop ALL, User 1000:1000, Ulimits nofile+core, опц. StorageOpt, опц. BlkioDevice*Bps, NetworkMode=custom, AutoRemove=false + cleanup worker, Tmpfs /tmp nosuid+nodev, labels для audit). Валидация отклоняет host/bridge network и root user. `lib/adapters/sandbox-docker.ts` — полная реализация через dockerode: create/ref/destroy/list/exec (Exec API + stdout/stderr демукс)/fs (putArchive/getArchive через tar-stream). `tests/sandbox-docker-config.test.ts` — 21 тест, явно проверяет все 15. Установлены `dockerode@^4`, `tar-stream@^3` + типы.
- **Следующее (iter 6):** `lib/sandbox/cleanup-worker.ts` — TTL + idle detection + cascade через ProxyProvider (когда тот появится).
- **После:** sandbox-security.test.ts (9 тестов — на реальном Docker), замена callers на SandboxProvider, удаление freestyle-sandboxes из deps.

## Суммарные тесты
- `tests/llm-adapter.test.ts` — 17 тестов.
- `tests/sandbox-contract.test.ts` — 16 тестов.
- `tests/audit-log.test.ts` — 10 тестов.
- `tests/sandbox-docker-config.test.ts` — 21 тест.
- **Всего:** 67/67 зелёные.
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
