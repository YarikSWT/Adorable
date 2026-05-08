# План разработки: авторизация и multi-tenancy

**Документ 4 из 4 — пошаговый план реализации для ralph-loop**

Этот документ — рабочий чеклист реализации Документов 1, 2, 3. Подаётся в каждый цикл ralph-loop'а: модель читает план, находит **первый незакрытый чекбокс**, реализует **только эту фазу**, прогоняет верификацию, помечает чекбоксы фазы выполненными и коммитит. Дальше — следующий цикл.

---

## Как пользоваться этим файлом

### Контракт цикла

В одной итерации Ralph закрывает **ровно одну фазу** (раздел `## Фаза N — ...`). Внутри фазы может быть несколько подпунктов-чекбоксов — все должны быть закрыты до конца итерации, иначе фаза не считается закрытой.

Алгоритм одной итерации:

1. Прочитать этот файл с начала до первой фазы, у которой не все чекбоксы закрыты.
2. Реализовать все её подпункты, опираясь на:
   - Документ 1 — что должно появиться в системе. (docs/auth/1-auth-hight-level-spec.md)
   - Документ 2 — детальная техническая спека. (docs/auth/2-auth-technical-spec.md)
   - Документ 3 — UI-спека. (docs/auth/3-auth-ui-spec.md)
3. Прогнать **всю** верификацию из секции «Верификация» этой фазы. Все шаги — обязательны, иначе фаза не закрыта.
4. Если хоть одна верификация красная — **не двигаться дальше**, чинить в той же итерации. Не переходить к следующей фазе с красным состоянием.
5. Когда всё зелёное — отметить чекбоксы `[x]` в этом файле, дописать запись в `STATE.md` (раздел «Auth iteration log», формат — см. ниже), закоммитить с префиксом `auth:` (как `fork:` в ADR-009, но для этого направления работ).

Формат записи в `STATE.md`:

```
## auth-iter <N> — <короткое имя фазы>
- Дата: <ISO>
- Что закрыто: фаза N («...»)
- Тесты: <X/Y unit, Z/W integration>
- Верификация: <build green | curl 200 ... | playwright snapshot ...>
- Коммит: <git short sha>
```

### Пред-условия каждого цикла

Перед стартом любой фазы убедиться:

- **Окружение**: `.env` содержит `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. После Фазы 5 — `GOOGLE_CLIENT_ID/SECRET`, `YANDEX_CLIENT_ID/SECRET`, `VK_CLIENT_ID/SECRET`. После Фазы 2 — `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`. После Фазы 11 — `EMAIL_FROM`, `SMTP_*`.
- **Инфра**: `npm run dev:infra:up && npm run dev:infra:wait` — Postgres, Gitea, Caddy подняты и healthy. Postgres-app должен быть доступен по `DATABASE_URL`.
- **Гитея-токен**: `GITEA_TOKEN` валиден (если нет — `npm run dev:infra:init-gitea`).
- **Чистый `git status`**: незакоммиченных правок от прошлой итерации нет.

### Стандартные команды верификации

Часто упоминаются ниже, привожу их полностью один раз:

- **Lint**: `npm run lint --workspace adorable`
- **Typecheck**: `npx tsc --noEmit -p adorable/tsconfig.json`
- **Build**: `npm run build --workspace adorable`
- **Unit-тесты**: `npm run test --workspace adorable`
- **Integration-тесты с БД**: `RUN_DB_TESTS=1 DATABASE_URL_TEST=postgres://adorable:adorable_dev_password@localhost:5432/adorable_test npm run test --workspace adorable`
- **Сидинг**: `npm run db:reset --workspace adorable`
- **Dev-сервер для curl/Playwright**: `npm run dev --workspace adorable` (фоном; убить после).

### Принципы

- **Не опережать план.** Не реализовывать фичу из Фазы N+1 в Фазе N, даже если кажется проще «заодно». Это сохраняет каждую итерацию атомарной.
- **Не пропускать верификацию.** Build green ≠ работает. Когда фаза трогает API-ручку — обязателен curl на неё. Когда трогает UI — обязателен Playwright snapshot.
- **Сохранять обратную совместимость URL.** `/api/repos/:repoId/*` — `repoId` остаётся `gitea_wrapper_repo_id` (см. Документ 2, 7.4 + Приложение A). Это нужно соблюдать, иначе текущий клиент-код отвалится.
- **Все коммиты с префиксом `auth:`** — для будущего ребейза и для отделения этих работ от `fork:`-коммитов.

---

## Фаза 0 — Установка зависимостей и Drizzle config

**Файлы**: `adorable/package.json`, `adorable/drizzle.config.ts`, `package.json` (root, при необходимости).

- [x] Установить новые npm-пакеты в workspace `adorable`: `better-auth`, `drizzle-orm`, `postgres`, `@better-auth/drizzle-adapter`, `argon2`, `uuidv7`, `zod`, devDep `drizzle-kit`. Версии — последние стабильные мажоры на момент установки.
- [x] Создать `adorable/drizzle.config.ts` — точное содержимое см. Документ 2, раздел 1.3.
- [x] Добавить в `adorable/package.json` скрипты `db:generate`, `db:migrate`, `db:push`, `db:seed`, `db:reset` (см. Документ 2, раздел 1.4).
- [x] Создать пустые директории `adorable/lib/db/schema/`, `adorable/lib/db/seed/`, `adorable/lib/auth/`. Положить `.gitkeep` где это нужно — иначе Drizzle/линт могут жаловаться.

**Верификация:**

1. `npm install` — без ошибок.
2. Lint, typecheck, build — все зелёные. Build не должен сломаться от добавления зависимостей.
3. `npx drizzle-kit --version` запускается без ошибок.

---

## Фаза 1 — Схема БД и Drizzle client

**Файлы**: `adorable/lib/db/schema/*.ts`, `adorable/lib/db/client.ts`, `adorable/lib/db/schema/index.ts`.

- [x] Создать все файлы схемы — `users.ts`, `accounts.ts`, `sessions.ts`, `verification-tokens.ts`, `roles.ts` (содержит roles + permissions + role_permissions), `organizations.ts` (organizations + organization_members + admin_role_assignments), `projects.ts` (projects + project_members), `billing.ts` (plans + subscriptions + plan_overrides + usage_events + usage_counters), `tokens.ts` (project_tokens), `publication.ts` (snapshots), `invitations.ts`, `audit.ts`. Содержание — точно по Документу 2, раздел 2.
- [x] Создать `index.ts` с реэкспортом всех таблиц.
- [x] Создать `lib/db/client.ts` — drizzle client с HMR-safe singleton-обёрткой через `globalThis.__db`.
- [x] Прогнать `npm run db:generate` — должны появиться файлы миграций под `adorable/lib/db/migrations/`. Закоммитить их.

**Верификация:**

1. Lint, typecheck — зелёные.
2. `npm run db:migrate` против локального Postgres — выполняется без ошибок.
3. В psql проверить, что все таблицы появились: `\dt` показывает 18+ таблиц (включая drizzle-meta).
4. `SELECT * FROM users LIMIT 0` и пара других — без ошибок (структура валидная).
5. Build green.

---

## Фаза 2 — Сидинг ролей, пермишенов, плана free, initial admin

**Файлы**: `adorable/lib/db/seed/roles-permissions.ts`, `plans.ts`, `admin.ts`, `run.ts`, `reset.ts`.

- [x] `roles-permissions.ts` — экспортирует `SYSTEM_PERMISSIONS` и `SYSTEM_ROLES` (см. Документ 2, раздел 4.1, **с учётом** `admin.users.update` из Правки 5). Делает `INSERT ... ON CONFLICT DO NOTHING` для permissions, roles, role_permissions. Раскрывает wildcard'ы в момент сидинга.
- [x] `plans.ts` — сидит план `free` с лимитами из Документа 2, раздел 4.2.
- [x] `admin.ts` — если `INITIAL_ADMIN_EMAIL` и `_PASSWORD` заданы и юзер ещё не создан — создаёт через **внутренний API Better Auth** (`auth.api.signUpEmail` или эквивалент), затем `is_admin=true`, `admin_role_assignments` с ролью `superadmin`. Идемпотентен.
- [x] `run.ts` — entrypoint: вызывает три функции выше в правильном порядке, использует общий `db`-клиент.
- [x] `reset.ts` — wipe схемы + migrate + seed. Используется для интеграционных тестов и при первой накатке.

**Верификация:**

1. `npm run db:reset` — отрабатывает целиком, БД с нуля поднята.
2. В psql: `SELECT count(*) FROM permissions` ≥ 27 (см. Документ 2, 4.1 + правка 5). `SELECT count(*) FROM roles` = 11 (3 org + 4 project + 4 admin). `SELECT slug FROM plans` содержит `free`. `SELECT email, is_admin FROM users WHERE is_admin = true` — одна запись с initial admin.
3. Lint, typecheck, build — зелёные.

---

## Фаза 3 — Better Auth core (без bootstrap-хука)

**Файлы**: `adorable/lib/auth/email-normalize.ts`, `adorable/lib/auth/better-auth.ts`, `adorable/app/api/auth/[...all]/route.ts`, `adorable/tests/auth/email-normalize.test.ts`.

- [x] `email-normalize.ts` — функция `normaliseEmail` точно по Документу 2, 3.2 (gmail dots + plus-aliases + googlemail.com).
- [x] `email-normalize.test.ts` — 8+ кейсов (gmail dots, plus, googlemail, обычный домен, регистр, trim, не-email строка).
- [x] `better-auth.ts` — инстанс `auth = betterAuth({...})` со всеми блоками из Документа 2, 3.1: `drizzleAdapter`, `emailAndPassword`, `socialProviders.google`, `account.accountLinking.enabled = false`, `user.additionalFields`, `session`, `rateLimit` (см. Правка 6), `hooks.before` для нормализации email. **Без** `after.signUpEmail` — будет в Фазе 4.
- [x] `app/api/auth/[...all]/route.ts` — catch-all хендлер, экспортирует `GET, POST` через `toNextJsHandler(auth.handler)`.

**Верификация:**

1. Lint, typecheck — зелёные.
2. Unit-тесты: `tests/auth/email-normalize.test.ts` — все зелёные.
3. Build green.
4. Поднять dev-сервер. `curl -i http://localhost:3000/api/auth/get-session` → 200, тело `{}` или `null`.
5. `curl -i -X POST -H 'Content-Type: application/json' -d '{"email":"test@example.com","password":"password123","name":"T"}' http://localhost:3000/api/auth/sign-up/email` → 200 (юзер создаётся, но без org/subscription пока — это проверим в Фазе 4). Проверить в psql, что запись в `users` появилась с нормализованным email.
6. Проверить в psql, что таблица `rate_limit` создана (Better Auth добавил её через свои миграции).

---

## Фаза 4 — Bootstrap нового юзера: org + subscription

**Файлы**: `adorable/lib/auth/better-auth.ts` (дополнение), `adorable/lib/auth/bootstrap.ts`, `adorable/tests/auth/bootstrap.test.ts`.

- [x] `bootstrap.ts` — экспортирует `bootstrapNewUser(userId, ctx)` точно по Документу 2, 3.4: транзакция, создаёт organization (type=`personal`), organization_member (роль org-owner), subscription (план free, period_start=now, period_end=now+1 month, provider=manual). `generateUniqueSlug` — слаг из имени + короткий хеш.
- [x] Подключить `bootstrapNewUser` в `after.signUpEmail` и `after.oauthCallback` (только при `isNewUser`) в `better-auth.ts`.
- [x] `bootstrap.test.ts` (integration, RUN_DB_TESTS=1): после signup появляются orgs(1), organization_members(1), subscriptions(1) с правильными полями.

**Верификация:**

1. `RUN_DB_TESTS=1 npm run test --workspace adorable` — bootstrap.test зелёный.
2. Прогнать вручную: `curl` signup нового юзера → в psql проверить, что у него в `organizations` появилась персональная org, в `subscriptions` — активная подписка на free.
3. Lint, typecheck, build — зелёные.

---

## Фаза 5 — OAuth (Google built-in + Yandex/VK через genericOAuth)

**Файлы**: `adorable/lib/auth/providers.ts`, `adorable/lib/auth/better-auth.ts` (дополнение), `.env.example`.

- [x] `providers.ts` — конфиги `yandexOAuth`, `vkOAuth` по Документу 2, 3.3, с правильными URL endpoint'ов и `mapProfileToUser`.
- [x] Подключить `genericOAuth({ config: [yandexOAuth, vkOAuth] })` в `plugins` в `better-auth.ts`.
- [x] Добавить в `.env.example` ключи `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, `VK_CLIENT_ID`, `VK_CLIENT_SECRET` с пояснительными комментариями.
- [x] (Опционально) В разработке создать тестовые OAuth-приложения у одного провайдера (Google проще всего) и проверить весь цикл; для Yandex/VK достаточно проверить, что endpoint редиректа возвращает 302 на правильный URL.

**Верификация:**

1. Lint, typecheck, build — зелёные.
2. `curl -i http://localhost:3000/api/auth/sign-in/social/google` → 302 на `accounts.google.com/...`.
3. `curl -i http://localhost:3000/api/auth/sign-in/social/yandex` → 302 на `oauth.yandex.ru/authorize?...`.
4. `curl -i http://localhost:3000/api/auth/sign-in/social/vk` → 302 на `id.vk.com/authorize?...`.

---

## Фаза 6 — Helpers: session + role-cache + authorization

**Файлы**: `adorable/lib/auth/session.ts`, `adorable/lib/auth/role-cache.ts`, `adorable/lib/auth/authorization.ts`, `adorable/lib/auth/audit.ts`, тесты.

- [x] `session.ts` — `getRequestSession`, `requireSession`, `requireEmailVerified` (см. Документ 2, 5.1). `HttpError` класс там же либо в общем `lib/auth/errors.ts`.
- [x] `role-cache.ts` — лениво загружает все системные роли в Map, экспортирует `getRoleId(scope, slug)`. См. Приложение C Документа 2.
- [x] `authorization.ts` — `getProjectAccessContext`, `requirePermission`, `requireAdminPermission` точно по Документу 2, 5.2/5.3, **с учётом Правки 1** (несравнимые роли → explicit выигрывает, без объединения). Helper `isSuperset`, `loadRolePermissions` — там же.
- [x] `audit.ts` — `writeAuditLog` (Документ 2, 5.5). Не падает наружу, ошибки в stderr.
- [x] `tests/auth/authorization.test.ts` (integration): кейсы из Документа 2, 9.2 — org-owner→project-owner, org-member→viewer, explicit publisher повышает, downgrade не понижает, юзер вне org→null, **несравнимые роли→explicit**.
- [x] `tests/auth/audit.test.ts` (integration): запись и чтение, индексы работают.

**Верификация:**

1. `RUN_DB_TESTS=1 npm run test --workspace adorable` — все тесты зелёные.
2. Lint, typecheck, build — зелёные.

---

## Фаза 7 — Helpers: quotas

**Файлы**: `adorable/lib/auth/quotas.ts`, `adorable/tests/auth/quotas.test.ts`.

- [x] `quotas.ts` — `requireQuota`, `recordUsage`, `resolveLimit`, `currentPeriodStartUTC`. Поддержать ветку `ABSOLUTE_KINDS = ["projects.max", "members_per_project.max"]` — для них считаем по `count(*)`, а не по `usage_counters` (Документ 2, 8.2). UUID v7 для `usage_events.id`.
- [x] `quotas.test.ts` (integration): кейсы из Документа 2, 9.2 — free-план лимит, override увеличивает, истёкший override не учитывается, абсолютный `projects.max`.

**Верификация:**

1. `RUN_DB_TESTS=1 npm run test --workspace adorable` — quotas.test зелёные.
2. Lint, typecheck, build.

---

## Фаза 8 — API wrapper и формат ошибок

**Файлы**: `adorable/lib/auth/api-wrap.ts`, `adorable/lib/auth/errors.ts`.

- [x] `errors.ts` — `HttpError` класс c полями `status, code, message, extra?`. `errorToResponse(err)` — формирует JSON-ответ по формату Документа 2, 6.3 (включая 429 `rate.limited`).
- [x] `api-wrap.ts` — `protectedRoute<P>(handler)` — обёртка, которая проверяет сессию и ловит `HttpError`. Логирует длительность (можно через `console.log` пока, мониторинг — отдельная тема).
- [x] Краткий unit-тест `tests/auth/errors.test.ts`: `errorToResponse(new HttpError(402, "quota.exceeded", "...", { quota: {...} }))` → правильный JSON и статус.

**Верификация:**

1. Lint, typecheck, build.
2. `npm run test --workspace adorable` — errors.test зелёный.

---

## Фаза 9 — Auth UI: login + signup

**Файлы**: `adorable/app/(auth)/layout.tsx`, `adorable/app/(auth)/login/page.tsx`, `adorable/app/(auth)/signup/page.tsx`, общие компоненты под `adorable/components/auth/`.

- [x] Auth layout — центрированная карточка ~400px, лого, переключатель темы. Без header/footer основного шелла (см. Документ 3, 3.1).
- [x] `/login` — три кнопки OAuth (Google, Yandex, VK), разделитель, поля email+password, чекбокс remember (опц.), линк «Забыли?», кнопка «Войти», ссылка на signup. Submit через server action или client-side fetch на `/api/auth/sign-in/email`. Обработка ошибок — Документ 3, 3.2.
- [x] `/signup` — те же кнопки OAuth, поля name+email+password, чекбокс ToS (плейсхолдер для ссылок), кнопка submit. **Без** реферального кода (Правка 4 Документа 2, Документ 3, 3.3). Обработка 409 — общая ошибка без раскрытия.
- [x] Если юзер уже залогинен и заходит на `/login` или `/signup` — редирект на `/`.

**Верификация:**

1. Lint, typecheck, build.
2. `npm run dev` фоном.
3. Playwright MCP:
   - `browser_navigate http://localhost:3000/login` → snapshot. Скриншот сохраняется в `verification/screenshots/auth-phase9-login.png`.
   - `browser_navigate http://localhost:3000/signup` → snapshot.
   - На `/signup`: заполнить форму с тестовым email/password/name → submit → ожидаем редирект на `/verify-email?pending=true`.
   - В psql проверить: новый юзер появился, есть persona-org и subscription.

---

## Фаза 10 — Auth UI: forgot, reset, verify, conflict, oauth-error

**Файлы**: `adorable/app/(auth)/forgot-password/page.tsx`, `reset-password/page.tsx`, `verify-email/page.tsx`, `auth/account-conflict/page.tsx`, `auth/oauth-error/page.tsx`.

- [x] `/forgot-password` — поле email, кнопка «Прислать ссылку». Submit → POST `/api/auth/forgot-password`. Всегда возвращаем нейтральное сообщение (Документ 3, 3.4).
- [x] `/reset-password?token=...` — два поля пароля, валидация совпадения, submit → POST `/api/auth/reset-password`. На отсутствующий/истёкший токен — страница ошибки.
- [x] `/verify-email` — два режима по query (`pending=true` и `token=...`). Документ 3, 3.6.
- [x] `/auth/account-conflict?provider=...&email=...` — текст из Документа 3, 3.7 + ссылки.
- [x] `/auth/oauth-error?reason=...` — generic.

**Верификация:**

1. Lint, typecheck, build.
2. Playwright MCP:
   - Snapshot каждой из 5 страниц.
   - На `/forgot-password` — отправить произвольный email, проверить что отображается «Если есть — мы прислали».
   - В psql после signup-теста Фазы 9: проверить что в `verification_tokens` есть `email_verify`-запись. Скопировать её `token_hash`-исходник вручную (или подмешать прямой токен через debug-endpoint, добавив временный) → открыть `/verify-email?token=...` → ожидаем «Email подтверждён» + редирект.

---

## Фаза 11 — Email-доставка

**Файлы**: `adorable/lib/auth/email-send.ts`, `adorable/lib/auth/better-auth.ts` (дополнение), `.env.example`.

- [x] `email-send.ts` — обёртка над Nodemailer (или эквивалент). Читает `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` из env. Если переменные не заданы — режим `console`: пишет письма в stderr вместо отправки (для dev).
- [x] Подключить `sendVerificationEmail` и `sendResetPassword` callbacks в Better Auth конфиг.
- [x] В `.env.example` добавить SMTP-переменные с комментариями.

**Верификация:**

1. Lint, typecheck, build.
2. С `EMAIL_FROM` пустым: signup → в логах сервера видим письмо, в нём — verify-ссылка с токеном.
3. Кликнуть на ссылку из лога → `/verify-email?token=...` отрабатывает — `email_verified` ставится в true (проверить в psql).

---

## Фаза 12 — Замена identity в `/api/repos`

**Файлы**: `adorable/app/api/repos/route.ts`, `adorable/app/api/repos/[repoId]/route.ts` (если будет создан), `adorable/lib/db/queries/projects.ts`, `adorable/lib/db/queries/users.ts`.

- [x] `lib/db/queries/projects.ts` — `getProjectByGiteaWrapperId(repoId)`, `listProjectsForUser(userId, opts)`, `getDefaultPersonalOrgId(userId)`, и тонкие helpers поверх `getProjectAccessContext`.
- [x] Переписать `POST /api/repos` точно по Документу 2, 8.2 — с **правкой 3**: создатель получает явную запись `project_members` с ролью `owner` в той же транзакции, что и создание проекта. Использовать `getRoleId("project", "owner")` из `role-cache.ts`.
- [x] Переписать `GET /api/repos` — фильтрация по `listProjectsForUser`. URL-семантика `repoId` = `gitea_wrapper_repo_id` сохраняется (Приложение A Документа 2).
- [x] Удалить из этого файла все импорты и вызовы `getOrCreateIdentitySession`, `migrateRepoIdInAcl`. Соблюсти, что rename Gitea-репо теперь обновляет `projects.giteaWrapperRepoId` напрямую.

**Верификация:**

1. Lint, typecheck, build.
2. Поднять dev-сервер. Вручную создать сессию (через signup + verify-email из Фазы 11), скопировать `better-auth.session_token` из cookies браузера или curl-flow.
3. `curl -i -b "better-auth.session_token=..." http://localhost:3000/api/repos` → 200, JSON с пустым массивом репозиториев (новый юзер).
4. `curl -i -b "..." -X POST -H 'Content-Type: application/json' -d '{"name":"my-app","prompt":"..."}' http://localhost:3000/api/repos` → 200 (или 423 если email не verified — тогда сначала verify в curl). В psql проверить: запись в `projects`, запись в `project_members` с `role_id` соответствующим project-owner, audit_log запись `project.create`.
5. Без сессии: `curl -i http://localhost:3000/api/repos` → 401.

---

## Фаза 13 — Замена identity в `/api/chat`

**Файлы**: `adorable/app/api/chat/route.ts`.

- [x] Переписать поток (Документ 2, 8.2): `requireSession` → `requireEmailVerified` → найти проект по `repoId` (= giteaWrapperRepoId) → `requirePermission("project.edit", { projectId })` → `requireQuota(orgId, "llm.tokens.monthly", 50_000)` → существующий `streamLlmResponse`.
- [x] В `onFinish` коллбэке streamText (рядом с существующим `autoCommitWorkspace`) — `recordUsage({ kind: "llm.tokens.monthly", amount: totalTokens, ...metadata })`.
- [x] Удалить импорт `getOrCreateIdentitySession` из этого файла.

**Верификация:**

1. Lint, typecheck, build.
2. Dev-сервер + сессия. `curl POST /api/repos` создать проект (Фаза 12).
3. `curl POST /api/chat` с малым промптом → 200, стрим проходит. В psql: `usage_events` инкрементировался, `usage_counters` тоже.
4. Без сессии: 401. Без verify: 423. С исчерпанной квотой (вручную выставить `usage_counters.used = 100000` в psql) → 402 `quota.exceeded`.

---

## Фаза 14 — Остальные API: /api/me, /api/orgs, /api/admin scaffolding

**Файлы**: `adorable/app/api/me/route.ts`, `adorable/app/api/orgs/...`, `adorable/app/api/repos/[repoId]/members/route.ts`, `tokens/route.ts`, `visibility/route.ts`, `adorable/app/api/admin/users/...`.

- [ ] `/api/me` — GET, PATCH (Документ 2, 7.2). PATCH — поля name, avatarUrl.
- [ ] `/api/orgs` — POST для создания team-org. GET вшит в `/api/me` (organizations).
- [ ] `/api/orgs/:orgId` — GET, PATCH, DELETE (только team).
- [ ] `/api/orgs/:orgId/members` — GET, PATCH (изменение роли), DELETE.
- [ ] `/api/repos/:repoId/members` — GET, PATCH, DELETE (без POST в этой версии — приглашения отдельно).
- [ ] `/api/repos/:repoId/tokens` — GET, POST (с одноразовым возвратом), DELETE.
- [ ] `/api/repos/:repoId/visibility` — PATCH.
- [ ] `/api/admin/users` — GET (list).
- [ ] `/api/admin/users/:id` — PATCH (правка 5: смена email с инвалидацией сессий).
- [ ] `/api/admin/users/:id/suspend|unsuspend` — POST.
- [ ] `/api/admin/audit-log` — GET с фильтрами.

Каждая ручка обёрнута в `protectedRoute`, проверяет нужный пермишен, возвращает корректный формат ошибок.

**Верификация:**

1. Lint, typecheck, build.
2. Curl-серия:
   - `GET /api/me` (с сессией) → 200 + структура.
   - `POST /api/orgs` `{name:"Team", slug:"team"}` → 200, в psql team-org появилась.
   - `POST /api/repos/:id/tokens` `{name:"server",kind:"server"}` → 200, в ответе есть **plaintext** `token`. Префикс совпадает с записанным `token_prefix`. Повторный GET — токен в plaintext **не** возвращается.
   - `PATCH /api/admin/users/:id` `{email:"new@...",}` от имени admin → 200, у юзера в БД email обновился, `email_verified=false`, `sessions` юзера пусты.
   - `PATCH /api/admin/users/:id` от не-admin'а → 403.

---

## Фаза 15 — Глобальный шелл UI: header + org switcher + user menu + email banner

**Файлы**: `adorable/components/shell/Header.tsx`, `OrgSwitcher.tsx`, `UserMenu.tsx`, `EmailVerifyBanner.tsx`, `adorable/app/layout.tsx` (правка для подключения).

- [ ] Header (Документ 3, 4.1): лого слева, org switcher по центру (только если ≥2 org), user menu справа.
- [ ] OrgSwitcher (4.2): popover со списком orgs из `/api/me`, активная подсвечена, «Создать организацию» снизу.
- [ ] UserMenu (4.3): аватар → popover с пунктами Профиль/Безопасность/Подключения/Биллинг/Админка/Выйти. Админка — только если `is_admin=true`.
- [ ] EmailVerifyBanner (4.6): рендерится глобально, виден только если `!emailVerified`. Кнопка «Отправить заново» с 30-секундным cooldown. Dismiss через localStorage с истечением через 24 часа.

**Верификация:**

1. Build green.
2. Playwright MCP:
   - Войти под верифицированным юзером → snapshot home: header виден, баннер не виден, org switcher скрыт (одна org).
   - Войти под не-верифицированным → snapshot: баннер виден, кнопка «Отправить заново» работает (на dev — письмо в логе).
   - Создать team-org через UI «+ Создать» в OrgSwitcher (или через API заранее) → org switcher появляется → переключение работает.

---

## Фаза 16 — Project settings UI: General, Members, Danger zone

**Файлы**: `adorable/app/projects/[id]/settings/layout.tsx`, `general/page.tsx`, `members/page.tsx`, `danger/page.tsx`, sidebar component.

- [ ] Layout с sidebar (Документ 3, 4.4): пункты General/Members/Tokens/Publication/Danger.
- [ ] General (6.3): name, description, slug (read-only после публикации). Submit → PATCH соответствующей ручки.
- [ ] Members (6.4): таблица, бейджи ролей, лейбл «Через организацию» / «Явно». Кнопка «+ Добавить» → модалка-заглушка «Приглашения появятся в следующей версии». Изменение роли и удаление — для явных members.
- [ ] Danger zone (6.7): два блока — архивировать и удалить, с input-confirmation.

**Верификация:**

1. Build green.
2. Playwright MCP под двумя юзерами:
   - Owner проекта: `/projects/<id>/settings/general` snapshot, изменить name → 200 в network → name обновился в psql.
   - Виде проектов members snapshot: видит сам себя как явный owner (запись из Фазы 12).
   - Danger: попытка удалить с неверным confirmation → кнопка disabled. С верным → 200 → редирект на `/`.

---

## Фаза 17 — Project settings UI: Tokens с одноразовой модалкой

**Файлы**: `adorable/app/projects/[id]/settings/tokens/page.tsx`, диалоговые компоненты.

- [ ] Список токенов: таблица (имя, kind, prefix, created, lastUsed, expires, статус), кнопка «Отозвать».
- [ ] «Создать токен» → модалка с полями name/kind/expiration → submit → закрытие старой модалки и **немедленное открытие** второй модалки с **plaintext-токеном** (моноширно), кнопкой copy и предупреждением «единственный раз». Закрытие — только через «Понятно».
- [ ] Отзыв — с подтверждением.

**Верификация:**

1. Build green.
2. Playwright MCP:
   - Создать токен через UI → проверить что модалка с plaintext открылась, токен начинается с `pk_live_`/`sk_live_`/`xp_live_`, скопировался в clipboard (через `browser_evaluate` `navigator.clipboard.readText()`).
   - Закрыть → токен в таблице с правильным prefix.
   - Отозвать → статус «revoked», в psql `revoked_at` заполнен.

---

## Фаза 18 — Project settings UI: Publication

**Файлы**: `adorable/app/projects/[id]/settings/publication/page.tsx`.

- [ ] Если не опубликован — CTA-блок с кнопкой «Опубликовать» → диалог выбора visibility (radio с пояснениями) → POST `/api/repos/:id/promote`.
- [ ] Если опубликован — URL поддомена + copy, текущий visibility-pill + «Изменить», метаданные (когда, какой commit), кнопка «Опубликовать снова», информер.
- [ ] Раздел «Кастомный домен» **скрыт**.

**Верификация:**

1. Build green.
2. Playwright MCP:
   - Snapshot empty state.
   - Нажать «Опубликовать» → выбрать `private` → submit → snapshot новой формы published-state. Проверить в psql `published_visibility=private`, `published_snapshot_id NOT NULL`.
   - Нажать «Изменить visibility» → public → submit → в psql обновлён.

---

## Фаза 19 — Org UI: список, settings, members, /orgs/new

**Файлы**: `adorable/app/orgs/[slug]/...`, `adorable/app/orgs/new/page.tsx`.

- [ ] `/orgs/new` — форма (name, slug auto-fill) → POST `/api/orgs`.
- [ ] `/orgs/<slug>` — overview (Документ 3, 7.2): счётчики, список последних проектов, mini-quota.
- [ ] `/orgs/<slug>/settings` — name/slug edit, удалить team org.
- [ ] `/orgs/<slug>/members` — как project members, но для org.
- [ ] Personal-org через `/orgs/<personal-slug>/...` **не работает** в UI (рендерим 404 или редирект на `/`); биллинг для personal — только через `/orgs/<personal-slug>/billing` (Фаза 21).

**Верификация:**

1. Build green.
2. Playwright MCP: создать team-org через `/orgs/new` → редирект на `/orgs/<slug>` → snapshot. Settings/members — snapshot и базовые edit-actions.

---

## Фаза 20 — User settings UI: profile, security, connections

**Файлы**: `adorable/app/settings/profile/page.tsx`, `security/page.tsx`, `connections/page.tsx`.

- [ ] Profile: аватар (только инициалы в v1), name (PATCH `/api/me`), email read-only с подсказкой про поддержку.
- [ ] Security: смена пароля → POST `/api/auth/change-password` (Better Auth), таблица активных сессий → POST `/api/auth/revoke-session`.
- [ ] Connections: для каждого OAuth-провайдера — кнопка привязать/отвязать. Логика — как в Документе 3, 5.3 (последний способ нельзя убрать).

**Верификация:**

1. Build green.
2. Playwright MCP: snapshot каждой страницы, проверить смену имени и пароля.
3. Curl `GET /api/auth/list-sessions` (Better Auth) → 200 со списком; «Завершить» одну → она исчезает.

---

## Фаза 21 — Billing UI

**Файлы**: `adorable/app/orgs/[slug]/billing/page.tsx`, inline-баннер на home.

- [ ] Billing страница (Документ 3, 8.1): карточка плана, таблица лимитов с прогресс-барами, override-блок (если есть), история событий (последние 50).
- [ ] Inline-баннер: на home если квота >80% — компактный баннер с CTA-ссылкой на billing. Dismiss с возвратом через 24 часа.

**Верификация:**

1. Build green.
2. Playwright MCP: открыть `/orgs/<personal>/billing` под свежим юзером — snapshot. Все прогрессы 0/N.
3. В psql выставить `usage_counters.used = 90000` для llm.tokens.monthly → перезайти на home → баннер виден, на billing — полоса оранжевая.
4. Выставить `used = 100000` → отправить сообщение в чат → ответ 402 `quota.exceeded` (проверка интеграции с Фазой 13).

---

## Фаза 22 — Publication gateway (Caddy forward_auth)

**Файлы**: `adorable/app/__published_authz/route.ts` (или эквивалент), Caddy config (через Admin API) в `adorable/lib/proxy/`.

- [ ] Маршрут `GET /__published_authz` — принимает `subdomain` и cookies, возвращает 200/401/403 без тела (Caddy `forward_auth`-стиль). Логика — точно Документ 2, 7.8 + Правка 2 (`private` требует и сессии, и `email_verified`).
- [ ] Caddy: добавить `forward_auth` правило для `<sub>.preview.<domain>` через ProxyProvider Admin API. Если 200 → отдаём статику, если 401 → редирект на `/login?from=...`, если 403 → 403.

**Верификация:**

1. Build green.
2. Опубликовать тестовый проект (через Фазу 18) с visibility=public → curl на `<sub>.preview.localhost:8080/` без cookie → 200 + HTML.
3. Сменить visibility на authenticated → curl без cookie → 302 на login. С cookie verified юзера → 200. С cookie un-verified юзера → 302.
4. Сменить на private → curl от не-члена проекта → 403. От члена → 200.
5. Все три кейса задокументировать в `verification/scenarios/publication-visibility.md`.

---

## Фаза 23 — Минимальная админка (опционально, можно пропустить в v1)

**Файлы**: `adorable/app/admin/...`.

Этот этап **опционален** (Документ 3, раздел 9). Если ralph-loop поджимает по времени — пропустить, юзер-админ работает через curl. Если делаем:

- [ ] `/admin` — read-only дашборд: счётчики юзеров/orgs/публикаций.
- [ ] `/admin/users` — список с поиском + клик на строку.
- [ ] `/admin/users/<id>` — карточка + кнопки suspend/unsuspend/смена email.
- [ ] `/admin/orgs/<id>` — план, лимиты, override-форма.
- [ ] `/admin/audit` — таблица с фильтрами.

**Верификация (если делается):**

1. Build green.
2. Playwright MCP под admin'ом: snapshot всех экранов, базовые операции (suspend → unsuspend юзера).
3. Под не-admin'ом: `/admin` → 403/404.

---

## Фаза 24 — Cleanup: удаление identity-session.ts

**Файлы**: удалить `adorable/lib/identity-session.ts`, удалить `.adorable/acl.json` если есть, найти и удалить все остаточные импорты.

- [ ] `grep -rn "identity-session\|getOrCreateIdentitySession\|migrateRepoIdInAcl\|ADORABLE_IDENTITY_COOKIE" adorable/` → пусто (или только в комментариях/доках).
- [ ] Удалить файл `adorable/lib/identity-session.ts`.
- [ ] Удалить чтения `.adorable/acl.json` если они остались.
- [ ] Прогнать **полный** test suite: unit + integration + sandbox-security + gitea + caddy gated тесты — все зелёные (105+ оригинальных + новые auth-тесты).

**Верификация:**

1. Lint, typecheck, build.
2. `npm test` — без падений.
3. `RUN_DB_TESTS=1 npm test` — все integration зелёные.
4. `sg docker -c "RUN_DOCKER_TESTS=1 ..."` — sandbox-security 9/9 (как было).

---

## Фаза 25 — e2e-сценарии Playwright MCP

**Файлы**: `verification/scenarios/*.md` + соответствующие фикстуры.

Каждый сценарий — markdown-файл с шагами и ожидаемым результатом.

- [ ] `auth-signup-and-create-project.md` — signup → verify-email (через DB-извлечение токена) → create project → отправить промпт → видим стрим ответа AI.
- [ ] `auth-strict-link.md` — signup через email → выйти → попытаться signin через Google с тем же email → видим страницу `/auth/account-conflict` с правильным сообщением.
- [ ] `auth-quota-exceeded.md` — выставить `usage_counters.used = limit` → отправить сообщение в чат → видим 402-bubble.
- [ ] `publication-visibility.md` (из Фазы 22, дополнить).
- [ ] `admin-suspend.md` (если делали Фазу 23) — admin банит юзера → юзер не может зайти.

**Верификация:**

1. Каждый сценарий прогнан через Playwright MCP, скриншоты в `verification/screenshots/auth-*.png`.
2. Запись в `STATE.md` с финальным статусом «auth-iter 25 — все сценарии зелёные, миграция закрыта».

---

## Состояния и обработка ошибок в процессе

### Если build/typecheck/lint красный

Не двигаться дальше фазы. Чинить в той же итерации. Если проблема — фундаментальная (например, Better Auth поменял API-сигнатуру) — обновить соответствующий раздел Документа 2, отразить причину в `STATE.md`, и только потом двигаться.

### Если интеграционный тест красный

Сначала смотреть `RUN_DB_TESTS=1` — БД-фикстура могла слететь. Проверить, что `db:reset` зелёный. Если интеграционный тест действительно стабильно красный — фаза не закрыта.

### Если Playwright MCP не дотягивается до сервера

Проверить, что dev-сервер живой (`curl localhost:3000`). Проверить, что инфра поднята (`npm run dev:infra:status`). Если падает после длительной работы — sandbox cleanup-worker мог убить контейнер; перезапустить инфру.

### Если фаза слишком большая для одной итерации

Допустимо разбить **внутри** одной фазы по чекбоксам и закрывать частично. В этом случае запись в `STATE.md` помечается как `auth-iter N (partial) — закрыты подпункты ...`. Следующая итерация продолжает ту же фазу.

---

## Зависимости между фазами

- Фаза 0 → 1 → 2 — линейно, нельзя нарушать.
- Фаза 3 — 8 — могут идти в указанном порядке, ничего параллельного не делаем.
- Фаза 9 — 11 — UI и email-доставка, тоже линейно.
- Фаза 12 — 14 — переписывание API, **только после** Фазы 6+7+8.
- Фаза 15 — 21 — UI, после Фазы 14 (нужны ручки). Между собой 16/17/18 могут идти в любом порядке.
- Фаза 22 — после 18.
- Фаза 23 — опционально, можно после 14.
- Фаза 24 — **строго после** 12 и 13.
- Фаза 25 — последняя, после всего.

---

## Финальный critical path для MVP

Если время поджимает — следующий минимум для рабочего multi-tenant без UI-фрилл:

Фазы **0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 22, 24**. Остальное — UI, можно прикрыть curl/Postman'ом и запиливать постепенно.

Но в этом случае Фазы 9 и 10 (auth UI) всё равно нужны — без них юзер физически не может зарегистрироваться. Так что minimum-viable: **0–14 + 22 + 24 + minimum 9–10**.

---

## Резюме

25 фаз, каждая закрывается одной итерацией ralph-loop'а (или несколькими, если фаза разбита внутренними чекбоксами). Полная реализация авторизации и multi-tenancy = ~25 итераций. Минимум для рабочей версии — ~12.

Этот план статичен. Прогресс отслеживается через чекбоксы в этом файле и записи в `STATE.md` (`auth-iter N — ...`).
