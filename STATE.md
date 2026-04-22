# Текущее состояние

**Итерация:** 2 завершена, идёт 3
**Дата:** 2026-04-22

## Окружение
- Node: v22.22.2 (nvm)
- Docker: 29.4.1, daemon работает.
- npm (+ workspaces), pnpm отсутствует, скрипты используют npm.
- `.env` заполнен ключевыми секретами: `Z_AI_API_KEY`, `BETTER_AUTH_SECRET`, `GITEA_ADMIN_PASSWORD`, `GITEA_TOKEN`.

## Инфра (Phase 1) — работает
- `adorable-postgres-app`, `adorable-postgres-gitea`, `adorable-gitea` (1.22.3), `adorable-caddy` (2.8-alpine).
- Gitea: `http://127.0.0.1:3001/`. Admin user `adorable` создан. API токен в `.env`.
- Caddy Admin API: `http://127.0.0.1:2019/`. HTTP: `127.0.0.1:8080`. HTTPS: `127.0.0.1:8443`.
- Сеть `adorable_infra` — инфра. Сеть `adorable_sandboxes` — куда dockerode подключит sandbox'ы; Caddy тоже там.

## LLM (Phase 1.5) — завершено
- Адаптер `adorable/lib/adapters/llm.ts` — 5 провайдеров: `zai`, `openrouter`, `anthropic`, `openai`, `mock`. Переключение через `LLM_PROVIDER` env.
- `adorable/lib/adapters/llm-mock.ts` использует `MockLanguageModelV3` из `ai/test`. Stream shape — structural literal + `as never` cast (workspace конфликт `@ai-sdk/provider@2` vs V3-типов в `ai@6`).
- `adorable/lib/llm-provider.ts` — тонкая обёртка над `createLLM()`. Бизнес-код импортирует только адаптер.
- `adorable/tests/llm-adapter.test.ts` — 17 тестов, все зелёные.
- `npm run build` — зелёный. `npm run test` — 17/17.
- Playwright verification Phase 1.5 отложена до Phase 2 (для полного чат-флоу нужен sandbox).

## Что сделано
- Phase 0: инвентаризация + state-файлы.
- Phase 1: compose, Dockerfile, скрипты, Caddy init config, README переписан.
- Phase 1.5: LLM-адаптер (zai/openrouter/anthropic/openai/mock), тесты, рефактор llm-provider.ts, фикс build.

## Что следующее (Phase 2)
Замена Freestyle VMs на dockerode-sandbox.
- `adorable/lib/adapters/sandbox.ts` — интерфейс `SandboxProvider` с методами create / destroy / exec / fs.read / fs.write / getLogs / status.
- `adorable/lib/adapters/sandbox-mock.ts` + контрактные тесты.
- `adorable/lib/adapters/sandbox-docker.ts` — ВСЕ 15 ограничений: NanoCpus, Memory, MemorySwap, PidsLimit, ReadonlyRootfs, SecurityOpt no-new-privileges, CapDrop ALL, User non-root, Ulimits, StorageOpt, BlkioDevice, кастомная сеть `adorable_sandboxes`, AutoRemove, Tmpfs, AuditLog.
- Начать с интерфейса + мока + контрактных тестов — потом docker-реализация.
- `adorable/lib/sandbox/cleanup-worker.ts` — TTL/idle.
- `adorable/lib/sandbox/audit-log.ts` — JSON lines в `SANDBOX_AUDIT_LOG`.
- `adorable/tests/sandbox-security.test.ts` — 9 security-тестов (docker inspect + fork-bomb + oom + etc).

## Открытые риски/заметки
- Из-за @ai-sdk/anthropic@^2 в workspace тянется @ai-sdk/provider@2, тогда как ai@6 использует v3. `llm-mock.ts` обходит это через `as never` cast — runtime-валидация в `MockLanguageModelV3` работает, TS-компиляция проходит.
- Tool use / function calling с GLM-5.1 через OpenAI-совместимый endpoint — проверим на Phase 2 e2e.
- В dev для preview.localhost нужен wildcard DNS (dnsmasq) или `/etc/hosts` — задокументировано в README Phase 4.
