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
