# Verification Log

Формат:
```
## <дата ISO> — <название задачи>
- Сценарий: <что проверял>
- Результат: ✅ pass | ❌ fail | ⚠️ partial | ⚠️ skipped
- Скриншот: verification/screenshots/<имя>.png
- Console errors: <none | список>
- Network errors: <none | список>
```

---

## 2026-04-21 — Phase 0: Инвентаризация
- Сценарий: grep freestyle, @ai-sdk/anthropic, составление INVENTORY-файлов.
- Результат: ✅ pass (не UI-задача, Playwright не применим).
- Скриншот: —
- Console errors: none
- Network errors: none

## 2026-04-21 — Phase 1: Инфраструктура (compose up + init-gitea)
- Сценарий: `docker compose up -d` → ожидание healthy → проверка Caddy Admin API, Gitea API, init-gitea идемпотентность.
- Проверки:
  - `docker compose ps` — все 4 сервиса Up (postgres-app, postgres-gitea, gitea, caddy), статус healthy.
  - `curl http://127.0.0.1:2019/config/` — возвращает корректный JSON admin-конфига с `apps.http.servers.preview.routes=[]`.
  - `curl http://127.0.0.1:3001/api/healthz` — `{"status":"pass"}`, Gitea-БД и cache ping зелёные.
  - `curl http://127.0.0.1:3001/api/v1/version` — `{"version":"1.22.3"}`.
  - `scripts/init-gitea.sh --write-env` — создаёт admin-пользователя, генерит токен, записывает `GITEA_TOKEN` в `.env`. Повторный запуск идемпотентен (удаляет старый токен, создаёт новый).
  - Caddy Admin API: POST route → `curl -H Host:test.preview.localhost http://127.0.0.1:8080` возвращает ожидаемое тело. DELETE by `@id` → routes становятся `[]`. Базовый контракт PUT/DELETE через Admin API работает.
- Результат: ✅ pass.
- Скриншот: —  (Phase 1 — инфра, не UI. UI-скриншоты появятся с Phase 1.5 когда запустим билдер.)
- Console errors: none
- Network errors: none
- Примечание: Caddy без сконфигурированных route возвращает HTTP 200 с пустым телом, не 404. Тесты proxy-security.test.ts будут проверять *содержимое* ответа, а не только status code.

## 2026-04-22 — Финальный e2e через Playwright MCP (prod-like dev-профиль)
- Сценарий: полный e2e через браузер.
  1. Infra up (`docker compose -f docker-compose.yml up -d`): все 4 сервиса healthy.
  2. Dev server (Next.js билдер) поднят через `sg docker npm run dev` с доступом к /var/run/docker.sock. Все env (Z_AI_API_KEY, GITEA_TOKEN, CADDY_ADMIN_URL, SANDBOX_PROVIDER=docker, GIT_PROVIDER=gitea, PROXY_PROVIDER=caddy) применены.
  3. Playwright MCP → `browser_navigate http://localhost:3000` — home page "Adorable" рендерится корректно. Heading "What do you want to build?" виден. API-key gate скрыт благодаря добавленному в iter 15 учёту `Z_AI_API_KEY` в `/api/api-key` hasGlobalKey.
  4. Ввод промпта "say hi" + клик Send:
     - `POST /api/repos 200 in 2.8s` — создание source-repo и wrapper-repo в Gitea успешно.
     - Sandbox-контейнер создан через dockerode (после фикса sanitize `opts.repoId` для docker naming — slash из `owner/repo` заменяется на `-`).
     - Навигация на `/adorable/adorable-meta---say-hi/<conversationId>` — успешна.
     - `POST /api/chat 200` — запрос прошёл через `lib/adapters/llm.ts` в z.ai endpoint. В логе видно структуру OpenAI-compatible запроса: `messages`, `tools`, `tool_choice:"auto"`, `stream:true`.
     - Z.ai **ответил HTTP 429**: `{"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}`. Т.е. API key валиден, запрос корректен, но на аккаунте нет баланса.
- Результат: ⚠️ partial. Вся инфра + код-путь работают корректно. Блок — **внешняя биллинговая система Z.ai**: недостаточно средств на аккаунте для генерации.
- Скриншот: `verification/screenshots/final-e2e-prod.png` — показана project-страница с чатом, отправленным промптом "say hi" и ошибкой "Failed after 3 attempts. Last error: Insufficient balance or no resource package."
- Console errors: 1 (сетевая ошибка от /api/chat, отражение 429 от upstream — ожидаемо)
- Network errors: `POST /api/chat 200` (наш API), upstream z.ai вернул 429 → билдер показывает user-friendly сообщение.
- Фиксы, сделанные в процессе iter 15 e2e:
  - `app/api/api-key/route.ts` — `hasGlobalKey` теперь учитывает Z_AI_API_KEY / OPENROUTER_API_KEY / LLM_PROVIDER=mock (был баг: рассматривал только openai+anthropic env).
  - `lib/adapters/sandbox-docker.ts` — `sandboxId` sanitизирует repoId (`/` из gitea full_name → `-`).
- Критерий PROMPT: «Z_AI_API_KEY пустой → КРИТИЧЕСКИЙ БЛОКЕР. Без LLM билдер не работает. Promise НЕЛЬЗЯ.» — формально key не пустой, но эффективно (insufficient balance) работает так же. Promise `FORK_MIGRATION_COMPLETE` НЕ ВЫДАЁТСЯ.
- Что осталось: пополнить баланс Z.ai → перезапустить тот же сценарий → получить стримящийся ответ GLM с tool-use → убедиться что файлы создаются в sandbox → preview через Caddy отдаёт HTML. Этот участок — runtime-верификация биллинга, не код.
