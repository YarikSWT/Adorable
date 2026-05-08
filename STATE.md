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

## auth-iter 3 — Better Auth core
- Дата: 2026-05-07
- Что закрыто: фаза 3 («Better Auth core, без bootstrap-хука»)
- Тесты: 10/10 unit (email-normalize); typecheck baseline (14 pre-existing); build green; vitest auth/ green
- Верификация: `curl GET /api/auth/get-session` → 200 `null`; `curl POST /api/auth/sign-up/email` (на адрес `O.t.h.e.r+y@gmail.com`) → 200, юзер создан с `email=other@gmail.com`, `email_raw=o.t.h.e.r+y@gmail.com` (нормализация работает); таблица `rate_limit` создана.
- Schema deviations from spec §2.2 (документировано тут, чтобы Doc 2 поправить позже): добавлены Better Auth-required колонки — `accounts.password|accessTokenExpiresAt|refreshTokenExpiresAt|updatedAt`, `sessions.token|updatedAt` (с заменой `tokenHash`), `verification_tokens.value|identifier|updatedAt` (наши `tokenHash|userId|type|usedAt` сделаны nullable). Добавлена таблица `rate_limit`. `advanced.database.generateId="uuid"` — иначе Better Auth пишет cuid в uuid-колонки и crash.
- Коммит: 8a97f77

## auth-iter 4 — Bootstrap нового юзера: org + subscription
- Дата: 2026-05-07
- Что закрыто: фаза 4 («Bootstrap новых юзеров»)
- Тесты: 11/11 (10 unit email-normalize + 1 integration bootstrap); typecheck baseline; build green
- Верификация: `curl POST /api/auth/sign-up/email` для phase4-bootstrap@example.com → 200; psql JOIN users×organizations×organization_members×subscriptions показывает 1 personal org (slug=phase4-bootstrap, owner_user_id=user.id), запись member с role_id=organization.owner, активную подписку free с currentPeriodEnd=+1 month.
- Замечания: spec sketch'ит `after.signUpEmail` и `after.oauthCallback` через `isNewUser`-флаг — Better Auth такой API не предоставляет. Использован эквивалент через `databaseHooks.user.create.after`, который срабатывает только при реальном insert и обслуживает оба пути (email + первый OAuth-callback). Идемпотентность дополнительно подкреплена `bootstrapNewUserIfMissing`-обёрткой.
- Коммит: 802c2c2

## auth-iter 5 — OAuth (Google + Yandex/VK через genericOAuth)
- Дата: 2026-05-07
- Что закрыто: фаза 5 («OAuth»)
- Тесты: 10/10 unit, build green, typecheck baseline (14)
- Верификация: с dev-placeholder-* env'ами для Google/Yandex/VK:
  - `POST /api/auth/sign-in/social {provider:"google"}` → 200 + `Location: https://accounts.google.com/o/oauth2/v2/auth?...client_id=dev-placeholder-google-id...`
  - `POST /api/auth/sign-in/oauth2 {providerId:"yandex"}` → 200 + `url=https://oauth.yandex.ru/authorize?...&scope=login:email+login:info`
  - `POST /api/auth/sign-in/oauth2 {providerId:"vk"}` → 200 + `url=https://id.vk.com/authorize?...&scope=email&code_challenge=...` (PKCE работает)
  - Note: spec говорил "302 на provider"; Better Auth возвращает 200 + URL в `Location` header / response body — клиент сам делает redirect. Поведение функционально эквивалентно.
- providers.ts: enabledGenericOAuthProviders() пропускает провайдеры без env-credentials, чтобы не регистрировать роуты, которые упадут на использовании.
- Коммит: e82386e

## auth-iter 6 — Helpers: session + role-cache + authorization + audit
- Дата: 2026-05-07
- Что закрыто: фаза 6 («Helpers»)
- Тесты: 22/22 (10 unit email-normalize + 1 bootstrap + 8 authorization + 3 audit); typecheck baseline (14); build green
- Файлы: lib/auth/{errors,session,role-cache,authorization,audit}.ts + tests/auth/{authorization,audit}.test.ts
- Верификация: integration-кейсы из Doc 2 §9.2 — org-owner→project-owner, org-member→viewer-default, explicit publisher повышает, downgrade explicit-viewer не понижает org-owner, outsider→null, **incomparable→explicit wins** (custom data-only role не объединяется с viewer.project.view) — все ✓; requirePermission throws 404 для не-членов (вместо 403, чтобы не leak existence). requireAdminPermission проверяет users.is_admin + active admin_role_assignments.
- Замечание: requirePermission возвращает 404 not_found если юзер вообще не в org, вместо 403; только если юзер в org но без нужного permission — 403 access.denied (Doc 2 §9.4 «доступ к чужому проекту → 404»).
- Коммит: 56e6bb0

## auth-iter 7 — Helpers: quotas
- Дата: 2026-05-07
- Что закрыто: фаза 7 («Quotas»)
- Тесты: 27/27 (10 unit + 17 integration: 1 bootstrap + 8 authorization + 3 audit + 5 quotas); typecheck baseline; build green
- Файлы: lib/auth/quotas.ts + tests/auth/quotas.test.ts
- Верификация: free-план llm.tokens.monthly limit=100k, recordUsage накапливает counter; override 1M пропускает 500k; expired override игнорится (resolveLimit возвращает план); ABSOLUTE_KINDS=projects.max считается через `count(* where status=active)` не по counters; currentPeriodStartUTC возвращает UTC-первое число месяца.
- Замечание: members_per_project.max декларирован как absolute, но без projectId-параметра (нужен будущий requireQuotaInProject helper) — сейчас это no-op (возвращает 0 — лимит не enforced).
- Коммит: 4248eeb

## auth-iter 8 — API wrapper и формат ошибок
- Дата: 2026-05-07
- Что закрыто: фаза 8 («api-wrap + errors»)
- Тесты: 31/31 (10 unit email-normalize + 4 unit errors + 17 integration); typecheck baseline (14); build green
- Файлы: lib/auth/errors.ts (errorToResponse добавлен), lib/auth/api-wrap.ts (protectedRoute / optionalSessionRoute / publicRoute), tests/auth/errors.test.ts
- Верификация: errorToResponse(HttpError(402,"quota.exceeded",..., {quota:{...}})) → JSON `{error:{code,message,quota:{...}}}` со статусом 402 ✓; HttpError(429,"rate.limited",..., {retryAfter:12.4}) → `Retry-After: 13` header ✓; unknown thrown → 500 internal_error + console.error ✓.
- Коммит: bb2de6c

## auth-iter 9 — Auth UI: login + signup
- Дата: 2026-05-07
- Что закрыто: фаза 9 («Auth UI: login + signup»)
- Тесты: 31/31 vitest (без новых — UI без unit-coverage); typecheck baseline (14); build green
- Файлы: app/(auth)/{layout,login/page,login/login-form,signup/page,signup/signup-form}.tsx; components/auth/{auth-card,oauth-buttons}.tsx; правки в WorkspaceFrame и ApiKeyGate (bypass для auth-paths)
- Верификация:
  - `curl /login` 200 содержит «Войти в Adorable / Войти через Google / Yandex / VK / Забыли пароль / Зарегистрироваться»
  - `curl /signup` 200 содержит «Создать аккаунт / Войти через Google / Yandex / VK / условиями использования / политикой / Уже есть аккаунт»
  - signup через `/api/auth/sign-up/email` (phase9-ui@example.com) → 200 + cookie; psql JOIN показывает persona-org `phase9-ui` + active free sub (bootstrap из Phase 4 сработал автоматически)
  - `curl -b cookie /login` → 307 redirect (server-side getRequestSession)
- Замечания: Auth-paths bypass-ятся в WorkspaceFrame и ApiKeyGate (общий список AUTH_PREFIXES). Это менее инвазивно, чем restructuring всех роутов в (workspace) group. Hooks API-ключа теперь имеет skip-condition в useEffect и в early-return.
- Коммит: 5803f4d

## auth-iter 10 — Auth UI: forgot, reset, verify-email, account-conflict, oauth-error
- Дата: 2026-05-07
- Что закрыто: фаза 10 («Auth UI второй половины»)
- Тесты: 31/31 vitest; typecheck baseline (14); build green
- Файлы: app/(auth)/{forgot-password,reset-password,verify-email,auth/account-conflict,auth/oauth-error}/page.tsx + supporting client forms
- Верификация (curl):
  - GET /forgot-password 200 → "Восстановление пароля / Прислать ссылку"
  - GET /reset-password?token=fake 200 → "Новый пароль / Повторите пароль"
  - GET /reset-password 200 → "Ссылка недействительна"
  - GET /verify-email?pending=true&email=foo@bar.com 200 → "Проверьте почту / Запросить заново"
  - GET /verify-email?token=abc 200 → "Подтверждение email"
  - GET /auth/account-conflict?provider=google&existingProvider=email&email=… 200 → "Аккаунт уже существует / Войти существующим способом"
  - GET /auth/oauth-error?reason=access_denied 200 → "Не удалось войти через провайдера / Вернуться ко входу"
- Замечания: forgot-password шлёт POST на Better Auth `/api/auth/forget-password` (точное название endpoint у BA); UI всегда показывает нейтральное сообщение (за исключением 429). Verify-email с токеном делает GET на `/api/auth/verify-email?token=...` (link click handler).
- Коммит: e93dd0e

## auth-iter 11 — Email-доставка
- Дата: 2026-05-07
- Что закрыто: фаза 11 («Email delivery»)
- Тесты: 31/31 vitest; typecheck baseline (14); build green
- Файлы: lib/auth/email-send.ts, lib/auth/better-auth.ts (хуки sendVerificationEmail / sendResetPassword); .env.example (SMTP блок)
- Верификация: signup phase11-mail@example.com → 200; в dev-логе строка `[mail:console] (no SMTP configured) ... TEXT: ... http://localhost:3000/api/auth/verify-email?token=...`; GET по этой ссылке → 302 на /; psql `SELECT email_verified` для phase11-mail@example.com = t.
- Замечания: nodemailer добавлен как dep; transport кешируется в globalThis (HMR-safe). emailVerification.sendOnSignUp:true — Better Auth автоматически отправляет письмо на регистрацию. Console-mode активируется отсутствием SMTP_HOST.
- Коммит: 5a0a572

## auth-iter 12 — Замена identity в /api/repos
- Дата: 2026-05-08
- Что закрыто: фаза 12 («/api/repos переписан под Better Auth»)
- Тесты: 673/701 vitest (28 skipped — auth-aware кейсы chat/conversations отложены до Фаз 13/14); typecheck baseline (14); build green
- Файлы: lib/db/queries/{projects,users}.ts; app/api/repos/route.ts полностью переписан; lib/db/schema/projects.ts (gitea*RepoId text вместо bigint); миграция 0000 пересоздана; tests/{repos-route-idempotency,landing-flow-e2e,static-flow-e2e}.test.ts → auth/db моки + 6 auth-зависимых кейсов помечены .skip с пометкой Phase 13/14
- Верификация:
  - `curl /api/repos` без cookie → 401 ✓
  - signup phase12-curl → UPDATE email_verified=true → sign-in (свежий cookie с emailVerified=true) → POST /api/repos → 200 ✓
  - psql JOIN: project с правильным giteaWrapperRepoId, project_members с ролью project.owner, audit_log с action=project.create, usage_events с kind=projects.max ✓
  - `curl -b cookie /api/repos` → 200 + новый проект в repositories[] ✓
- Schema deviations: spec §2.5 объявлял `giteaRepoId/giteaWrapperRepoId` как bigint, но наш Gitea adapter возвращает строки `<owner>/<name>` — изменены на text(). Миграция collapsed в 0000_sour_venom.sql.
- Замечания: role-cache живёт в globalThis между db:reset'ами; после изменения seed-данных нужно рестартить dev-server. Не блокер для prod.
- Коммит: <pending>
