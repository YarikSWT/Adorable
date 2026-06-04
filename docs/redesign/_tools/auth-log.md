# Auth log

- **Сработавший ключ localStorage:** `token`
- **Дата проверки:** 2026-06-03
- **JWT exp:** 2026-07-29 (1783089781) — действителен ~2 месяца
- **JWT iat:** 2026-05-30 (1780497781)
- **JWT sub:** `mryudinskikh@gmail.com`
- **JWT aud:** `platform`

## Workflow

```js
// На любой странице app.base44.com:
localStorage.setItem('token', '<JWT из .env BASE44_TOKEN>');
// Затем navigate на нужный URL — auth применится.
```

## Прочие наблюдения

- При первом заходе на `app.base44.com` без токена редиректит на `/login`.
- `_base44_sessionId` cookie присутствует всегда (просто session tracker, не auth).
- После установки `token` ОДИН раз — он работает на все последующие навигации, пока не очистится.
- Помимо `token`, в localStorage появляются `activeWorkspaceId`, `activeWorkspaceId<userId>`, `base44_store_*` — это уже state приложения, не auth.

## Если токен экспирирован

Симптом: редирект на `/login` даже после `localStorage.setItem('token', ...)`. Решение — попросить юзера обновить `BASE44_TOKEN` в `.env` (войти в base44 руками, скопировать новый из DevTools → Application → Local Storage).
