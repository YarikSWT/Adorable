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

## 2026-04-23 — Финальный e2e ✅ (iter 19, после пополнения Z.ai)
- Сценарий: полный happy-path через Playwright MCP.
  1. Infra `docker compose up -d`: 4 сервиса healthy. Caddy Admin API на `127.0.0.1:2019`.
  2. Dev server поднят с полным .env (Z_AI_API_KEY, GITEA_TOKEN=…, CADDY_ADMIN_URL, SANDBOX_PROVIDER=docker, GIT_PROVIDER=gitea, PROXY_PROVIDER=caddy).
  3. `browser_navigate http://localhost:3000` — home "Adorable" рендерится, API-key-gate скрыт.
  4. Промпт #1: "Write a minimal Express server on port 3001 responding 'Hello from GLM'":
     - `POST /api/repos 200 in 3.6s` — Gitea repo + Docker sandbox созданы.
     - `POST /api/chat 200 in 108s` — **GLM-5.1 streaming tool-use через `lib/adapters/llm.ts` (z.ai endpoint)**.
     - Agent iteratively: bash heredoc writeFile `server.js`, `npm install express --cache /tmp/.npm-cache` (read-only rootfs обошёл корректно), start server в фоне (`node server.js &`), verify через `node http.get('http://localhost:3001/')` → получил "Hello from GLM".
  5. Обнаружен dns-блокер: Caddy не мог резолвить upstream `adorable-sbx-<longRepoName>...:3000` т.к. hostname >63 символов (RFC 1035). Fix: `sandbox-docker.ts::create` → `safeRepoTag` truncate до 28 + short hash. Unit tests 105/105.
  6. Чистый рестарт dev + Caddy + remove старых sandbox.
  7. Промпт #2: `echo '<!doctype html>...' > index.html && python3 -m http.server 3000` — GLM создал `index.html`, но python3 не в образе; вручную запустил `node http.createServer()` на :3000 с содержимым index.html.
  8. Caddy route `d17c74f2.preview.localhost → adorable-sbx-adorable-Run-this-ba-xku9qm-mob72kp3:3000` (автоматически установлен при создании sandbox через `proxy.addRoute`, см. `adorable-vm.ts createVmForRepo`).
  9. `curl -H Host:d17c74f2.preview.localhost http://localhost:8080/` → `HTTP 200 <!doctype html><html><body><h1>Hello from GLM on Caddy via Adorable fork</h1></body></html>`.
  10. `browser_navigate http://d17c74f2.preview.localhost:8080/` → страница с headings "Hello from GLM on Caddy via Adorable fork".
- Результат: ✅ pass.
- Скриншоты:
  - `verification/screenshots/final-e2e-prod.png` — preview через Caddy, валидный HTML.
  - `verification/screenshots/final-e2e-home.png` — home page (первичный рендер).
  - `verification/screenshots/final-e2e-chat.png` — conversation UI с tool-calls GLM.
- Console errors: none в preview; в /api/chat сессии 1 expected (обычный stream-end сигнал от assistant-ui).
- Network errors: none.
- Итог: **полный fork migration verified**. Ни один SaaS Freestyle endpoint не затронут. LLM трафик идёт в z.ai. Preview URL через self-hosted Caddy.
