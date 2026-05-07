# STATE — Auth iteration log

## auth-iter 0 — Установка зависимостей и Drizzle config
- Дата: 2026-05-07
- Что закрыто: фаза 0 («Установка зависимостей и Drizzle config»)
- Тесты: build green; typecheck unchanged from baseline (14 pre-existing errors in unrelated test files; none introduced)
- Верификация: `npm install` ok, `npx drizzle-kit --version` → 0.31.10, `npx next build` ✓ Compiled successfully. Lint script (`next lint`) was pre-existing broken in Next.js 16 and not introduced by this change.
- Коммит: 47ffa8d

## auth-iter 1 — Схема БД и Drizzle client
- Дата: 2026-05-07
- Что закрыто: фаза 1 («Схема БД и Drizzle client»)
- Тесты: build green; typecheck unchanged from baseline (14 pre-existing errors in unrelated tests); migrate runs without errors
- Верификация: `drizzle-kit generate` → 21 tables, 1 migration file (0000_careless_wraith.sql); `drizzle-kit migrate` ✓; psql `\dt` показывает 21 таблицу; `SELECT * FROM users/projects/organizations/roles LIMIT 0` возвращают валидные пустые наборы; `next build` ✓.
- Коммит: 65b5e17

## auth-iter 2 — Сидинг ролей, пермишенов, плана free, initial admin
- Дата: 2026-05-07
- Что закрыто: фаза 2 («Сидинг»)
- Тесты: build green; typecheck unchanged from baseline (14 pre-existing errors); db:reset завершается без ошибок
- Верификация (psql после `tsx lib/db/seed/reset.ts`): `permissions=28` (≥27 ✓), `roles=11` (3 org + 4 project + 4 admin ✓), `role_permissions=61`, `plans` содержит `free` ✓. Initial admin user — **deferred to next db:reset after Phase 3**: admin.ts gracefully скипает (с warning'ом), потому что lib/auth/better-auth.ts ещё не создан. INITIAL_ADMIN_EMAIL/PASSWORD выставлены в .env заранее, так что после Фазы 3 первый же db:reset поднимет admin.
- Коммит: 1674a7e
