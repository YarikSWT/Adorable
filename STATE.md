# Текущее состояние

**Итерация:** 1 завершена, идёт 2
**Дата:** 2026-04-21

## Окружение
- Node: v22.22.2 (nvm)
- Docker: 29.4.1, daemon работает.
- npm (+ workspaces), pnpm отсутствует, скрипты используют npm.
- `.env` заполнен ключевыми секретами: `Z_AI_API_KEY`, `BETTER_AUTH_SECRET`, `GITEA_ADMIN_PASSWORD`, `GITEA_TOKEN` (создан init-скриптом).

## Инфра (Phase 1) — работает
- `adorable-postgres-app`, `adorable-postgres-gitea`, `adorable-gitea` (1.22.3), `adorable-caddy` (2.8-alpine).
- Gitea: `http://127.0.0.1:3001/`. Admin user `adorable` создан. API токен `GITEA_TOKEN` в `.env`.
- Caddy Admin API: `http://127.0.0.1:2019/` (только 127.0.0.1). HTTP proxy: `127.0.0.1:8080`. HTTPS: `127.0.0.1:8443`.
- Сеть `adorable_infra` — для инфры. Сеть `adorable_sandboxes` — куда dockerode подключит sandbox-контейнеры; Caddy тоже в этой сети.

## Что сделано
- Phase 0: инвентаризация + state-файлы.
- Phase 1: compose, Dockerfile, скрипты, Caddy init config, README переписан.

## Что следующее (Phase 1.5)
- Установить vitest + `@ai-sdk/openai-compatible` + `@openrouter/ai-sdk-provider` в workspace `adorable`.
- Создать `adorable/lib/adapters/llm.ts` + `llm-mock.ts`.
- Перевести `adorable/lib/llm-provider.ts` на использование адаптера.
- Написать `adorable/tests/llm-adapter.test.ts` (vitest).
- Playwright верификация — отложено до Phase 2 (нужен sandbox чтобы отправить полный чат).

## Открытые риски/заметки
- `@ai-sdk/anthropic@^2.0.24` + AI SDK v6 — проверить совместимость с `streamText`.
- GLM через `@ai-sdk/openai-compatible` — проверить tool use формат; Z.ai `/chat/completions` совместим с OpenAI ответами.
- Ввиду нативной работы с preview.localhost — в dev нужно либо `/etc/hosts` либо wildcard DNS (dnsmasq). Документировано в README Phase 4.
