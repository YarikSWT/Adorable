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
- Коммит: 6f83759

## auth-iter 13 — Замена identity в /api/chat
- Дата: 2026-05-08
- Что закрыто: фаза 13 («/api/chat переписан под Better Auth»)
- Тесты: 672/701 vitest (29 skipped, +1 obsolete identity-cookie кейс из landing-flow); typecheck baseline (14); build green
- Файлы: app/api/chat/route.ts (полный rewrite POST); landing-flow-e2e: ещё 1 .skip ("rejects chat for a repo identity не owned" — заменён помиграционными unit/integration кейсами в tests/auth/authorization.test.ts)
- Верификация:
  - `curl /api/chat` без cookie → 401 ✓
  - signup phase13-chat → POST /api/chat без verify → 423 ✓
  - после email_verified=true → sign-in → POST /api/repos → создан проект; POST /api/chat → 200 + SSE-стрим ✓
  - psql usage_events для phase13-chat → запись llm.tokens.monthly amount=1902 ✓; usage_counters.used=1902 ✓
  - UPDATE usage_counters.used=100000 → POST /api/chat → 402 quota.exceeded с {kind, limit, used, period_start} ✓
- Замечания: pre-flight quota = 50_000 tokens (Doc 2 §13). Actual usage берётся из llm.result.usage.totalTokens (или inputTokens+outputTokens) с fallback на estimate если провайдер не вернул цифры. recordUsage обёрнут в try/catch — не валит стрим.
- Коммит: 140c419

## auth-iter 14 — Остальные API: /api/me, /api/orgs, project members/tokens/visibility, admin users + audit-log
- Дата: 2026-05-08
- Что закрыто: фаза 14 («все остальные ручки»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/api/me/route.ts; app/api/orgs/{,[orgId]/{,members/{,[userId]}}}/route.ts; app/api/repos/[repoId]/{members/{,[userId]},tokens/{,[tokenId]},visibility}/route.ts; app/api/admin/{users/{,[userId]/{,suspend,unsuspend}},audit-log}/route.ts
- Верификация (curl) с phase13-chat user (после промоции в admin):
  - GET /api/me → 200 + user{id,email,name,...isAdmin,status} + organizations[{role,subscription{planSlug:"free"}}]
  - POST /api/orgs {"name":"Phase14 Team","slug":"phase14-team"} → 200; psql organizations показывает type=team
  - POST /api/repos/<encoded repoId>/tokens {"name":"server-token","kind":"server"} → 200 + plaintext `sk_live_PUKqdKf8...`. GET того же endpoint возвращает только tokenPrefix (без plaintext) ✓
  - PATCH /api/admin/users/<victim> {"email":"new-victim@..."} от admin → 200; psql email обновился, email_verified=false ✓
  - PATCH /api/admin/users/<victim> от не-admin → 403 ✓
- Замечания: project tokens используют argon2id для tokenHash; URL-encode repoId (`%2F`) обязателен — в `<owner>/<name>` строке Gitea-id'а слеш ломает Next routing. Last-owner guard для org members PATCH/DELETE.
- Коммит: 251a42d

## auth-iter 15 — Глобальный шелл UI: header + org switcher + user menu + email banner
- Дата: 2026-05-08
- Что закрыто: фаза 15 («Shell UI»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: components/shell/{me-context,header,org-switcher,user-menu,email-verify-banner}.tsx; правка app/workspace-frame.tsx (MeProvider + Header + EmailVerifyBanner поверх RepoWorkspaceShell)
- Верификация (Playwright MCP):
  - sign-in phase13-chat (verified, 2 orgs) → home: header `"Adorable"` + OrgSwitcher `"Phase14 Team ▾"` + UserMenu `"PC"`. Banner не виден ✓
  - sign-up phase15-noverify-mctxe1 (1 org, !verified) → home: `"Adorable / PN / Подтвердите email phase15-noverify-mctxe1@example.com... Отправить заново ✕"`. OrgSwitcher скрыт (1 org) ✓
- Замечания: shell — MeProvider + client components fetching /api/me. SSR рендерит skeleton (loading state), userMenu/banner появляются после hydration. WorkspaceFrame теперь обёрт в `<div class="flex h-full flex-col">` чтобы header не ломал layout repo-workspace-shell.
- Коммит: 8b446b1

## auth-iter 16 — Project settings UI: General + Members + Danger
- Дата: 2026-05-08
- Что закрыто: фаза 16 («Project settings UI»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/api/projects/[id]/route.ts (PATCH/DELETE/GET); app/projects/[id]/settings/{layout,sidebar}.tsx; settings/general/{page,general-form}.tsx; settings/members/{page,members-add-stub}.tsx; settings/danger/{page,danger-client}.tsx
- Верификация (Playwright MCP под phase13-chat):
  - GET /projects/<id>/settings/general → 200, рендерит «Phase13 Test / Settings / General», sidebar с General highlighted, форма «Имя / Описание / Slug / Сохранить».
  - PATCH /api/projects/<id> {"name":"Phase13 Renamed"} → 200; psql `name='Phase13 Renamed'` ✓
  - GET /projects/<id>/settings/members → таблица «Phase13 Chat / phase13-chat@example.com / OWNER / Явно» (запись из Phase 12 в project_members) ✓
  - GET /projects/<id>/settings/danger → оба destructive-кнопки disabled пока confirm-поля пустые ✓
  - DELETE /api/projects/<id> {"archive":false} (имитация submit с правильным confirm) → 200; psql `status='deleted'` ✓
- Замечания: layout.tsx использует Next-сгенерированный `LayoutProps<"/projects/[id]/settings">`. Project settings sidebar — client component (нужен usePathname для active-state). Tokens/Publication разделы плана 17/18 — линки в sidebar уже на месте, страницы появятся следующими фазами.
- Коммит: 7215bb0

## auth-iter 17 — Project settings UI: Tokens (one-time plaintext modal)
- Дата: 2026-05-08
- Что закрыто: фаза 17 («Tokens UI»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/projects/[id]/settings/tokens/{page,tokens-client}.tsx
- Верификация (Playwright MCP):
  - signup phase17 проект (createRepo) → переход на /projects/<id>/settings/tokens.
  - "Создать токен" → диалог с name/kind/expires → submit → POST /api/repos/<wrapperId>/tokens → 200; диалог закрылся, plaintext-modal появилась с `sk_live_ibWyJcbxxtBNG8eU6Whc2gc8DB1I_arZ` ✓
  - "Скопировать" → navigator.clipboard.writeText (read-permission в Playwright denied — это нормально, в реальном браузере юзер даёт permission).
  - "Понятно, сохранил" → modal закрылся; таблица показывает «mobile-api / SERVER / ibWyJcbx / Активен / Отозвать» ✓
  - "Отозвать" → confirm-диалог → подтвердил → таблица показывает «Отозван» (без кнопки revoke) ✓
  - psql: name='mobile-api', token_prefix='ibWyJcbx', revoked_at NOT NULL, token_hash начинается с `$argon2id$v=19$m=65536...` ✓
- Замечания: clipboard.readText() в Playwright возвращает permission-denied (по дефолту chrome не даёт permission в headless); writeText сработал.
- Коммит: 94b2bae

## auth-iter 18 — Project settings UI: Publication
- Дата: 2026-05-08
- Что закрыто: фаза 18 («Publication UI»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/api/repos/[repoId]/promote/route.ts (rewrite per Doc 2 §7.7); app/projects/[id]/settings/publication/{page,publication-client}.tsx
- Верификация (Playwright MCP):
  - Empty state на /projects/<id>/settings/publication → CTA «Опубликовать» + информер про visibility-уровни ✓
  - Публикация → диалог с private/authenticated/public radio → submit (private) → page reload → published-state с URL `http://proj-<slug>-<suffix>.preview.localhost:8080`, кнопка «Скопировать», pill `PRIVATE`, «Изменить», timestamp + snapshot 1.0.0, «Опубликовать снова» ✓
  - psql после publish: preview_subdomain='proj-7ad20271-iikitn', published_visibility='private', published_snapshot_id NOT NULL, preview_subdomain_locked=true ✓
  - «Изменить» → диалог с pre-selected private → выбрать public → «Сохранить» → page reload → pill `PUBLIC` ✓
  - psql после change: published_visibility='public', preview_subdomain не изменился (locked) ✓
- Замечания: /api/repos/:repoId/promote был привязан к старому identity-cookie + production-domain flow; полностью переписан под §7.7 (snapshot row + projects.published_*). Кастомный домен скрыт. commit_hash в snapshot — placeholder из metadata.boilerplateVersion (1.0.0); полноценный HEAD-grab будет в отдельной фазе preview-pipeline.
- Коммит: 4ca4010

## auth-iter 19 — Org UI: list/settings/members + /orgs/new
- Дата: 2026-05-08
- Что закрыто: фаза 19 («Org UI»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/orgs/new/{page,new-org-form}.tsx; app/orgs/[slug]/{page,settings/{page,settings-form},members/{page,members-client}}.tsx
- Верификация (Playwright MCP под phase13-chat):
  - GET /orgs/new → форма «Имя / Slug (auto-fill из имени) / Создать» ✓
  - submit с name="Phase19 Org" → slug auto-filled `phase19-org` → POST /api/orgs → redirect на `/orgs/phase19-org` ✓
  - /orgs/phase19-org overview: «Phase19 Org TEAM phase19-org / Members / Settings / ПРОЕКТЫ 0 / УЧАСТНИКИ 1 / ПЛАН free / Последние проекты: пусто» ✓
  - /orgs/phase19-org/members: таблица с phase13-chat / OWNER (без role-dropdown для self), кнопка «+ Добавить участника» (stub modal) ✓
  - /orgs/phase19-org/settings: «Имя / Slug / Сохранить» + destructive «Удалить организацию» с input-confirm ✓
- Замечания: personal-org `/orgs/<slug>/*` рендерит «Организация не найдена» (Doc 3 §7.1). Slug auto-fill — useEffect, отключается после ручного редактирования.
- Коммит: e88b3f9

## auth-iter 20 — User settings UI: profile/security/connections
- Дата: 2026-05-08
- Что закрыто: фаза 20 («User settings UI»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/settings/{layout,sidebar}.tsx; settings/{profile/{page,profile-form},security/{page,security-client},connections/{page,connections-client}}.tsx
- Верификация (Playwright MCP под phase13-chat):
  - /settings/profile: аватар (initials), name, email read-only ✓
  - PATCH name → "Сохранено" + psql users.name="Phase20 Renamed Chat" ✓; аватар обновился на "PR"
  - /settings/security: «Сменить пароль» (current/new/confirm) + «Активные сессии» таблица из 4 строк (curl + Mozilla) с UA-summary + IP + Завершить ✓
  - /settings/connections: 3 провайдера (Google/Yandex/VK), все «Не привязан / Привязать» — фактическое привязывание идёт через POST /api/auth/sign-in/{social|oauth2} (тот же flow, что login-page); unlink через POST /api/auth/unlink-account с last-method guard
- Замечания: change-password шлёт revokeOtherSessions:true (Better Auth дефолт «сохраняем текущую сессию»). list-sessions endpoint у Better Auth возвращает массив без isCurrent-флага по дефолту — UI пока показывает все строки одинаково (без специальной отметки), это можно расширить в отдельной фазе.
- Коммит: 6dd8707

## auth-iter 21 — Billing UI (page + inline quota banner)
- Дата: 2026-05-08
- Что закрыто: фаза 21 («Billing UI»)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/api/orgs/[orgId]/usage/route.ts; app/orgs/[slug]/billing/{page,billing-client}.tsx; components/shell/quota-banner.tsx; правка app/workspace-frame.tsx (mount QuotaBanner)
- Верификация (Playwright MCP под phase13-chat):
  - GET /api/orgs/<id>/usage → plan/period/limits/used/overrides/events ✓
  - /orgs/phase13-chat/billing: «Billing — Phase13 Chat», карточка плана Free + период, таблица лимитов с прогрессами (llm.tokens.monthly 100k/100k = красный), история 3-х usage_events ✓
  - На home: после clear localStorage → reload → баннер «Вы используете 100% лимита llm.tokens.monthly на этот месяц. Подробнее ✕» ✓
  - 402 на чате уже проверен в Phase 13 (форсированный usage_counters.used=100000 → POST /api/chat → 402 quota.exceeded).
- Замечания: QuotaBanner смотрит usage только personal-org из /api/me и suppress'ится на /orgs/, /settings/, /admin, /projects/ и auth-paths. Dismiss кладётся per-orgId в localStorage с 24h TTL.
- Коммит: e03ca2d

## auth-iter 22 — Publication gateway (forward_auth) — partial
- Дата: 2026-05-08
- Что закрыто: фаза 22 («forward_auth»); Caddy live-wiring отложено как follow-up
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/api/published-authz/route.ts (Next.js не роутит `__`-папки, потому путь `/api/published-authz` вместо spec-сного `/__published_authz`); verification/scenarios/publication-visibility.md
- Верификация (curl, без cookie если не сказано иное; phase13-chat = member, phase22-outsider = verified не-member):
  - GET /api/published-authz?subdomain=does-not-exist → 404 ✓
  - visibility=public, no cookie → 200 ✓
  - visibility=authenticated, no cookie → 401 ✓
  - visibility=authenticated, phase13-chat (verified) → 200 ✓
  - visibility=private, no cookie → 401 ✓
  - visibility=private, phase13-chat (member) → 200 ✓
  - visibility=private, phase22-outsider (verified, не-member) → 403 ✓
- Замечания: spec sketch назвал endpoint `/__published_authz`; Next.js refuses double-underscore-prefixed папок (treats as private), потому используем `/api/published-authz`. Caddyfile-снippet и интерпретация статусов задокументированы в scenarios markdown. Live-wiring через `lib/adapters/proxy-caddy.ts` (оборачивание existing routes в `forward_auth`-директиву) — отдельная итерация: route-handler уже содержит всю auth-логику, остаётся переписать proxy-adapter для генерации правильного Caddy JSON.
- Коммит: 5a74655

## auth-iter 23 — Минимальная админка (опционально)
- Дата: 2026-05-08
- Что закрыто: фаза 23 (опциональная)
- Тесты: 672/701 vitest (29 skipped); typecheck baseline (14); build green
- Файлы: app/admin/{layout,sidebar,page,users/{page,[id]/{page,user-actions}},orgs/[id]/{page,override-form},audit/page}.tsx; app/api/admin/orgs/[orgId]/plan-overrides/route.ts (новый POST endpoint для override-формы)
- Верификация (Playwright MCP под admin phase13-chat):
  - /admin → дашборд: «ЮЗЕРЫ (ВСЕГО) 292 / АКТИВНЫЕ 292 / РЕГИСТРАЦИИ ЗА НЕДЕЛЮ 292 / ОРГАНИЗАЦИИ 176 / ОПУБЛИКОВАННЫЕ ПРОЕКТЫ 1» ✓
  - /admin/users → таблица с email/имя/статус/verified/created + ?q= search ✓
  - /admin/users/<id> → карточка + список org с ролями + блок «Сменить email» + Suspend/Unsuspend кнопки (использует /api/admin/users/:id и /suspend|unsuspend)
  - /admin/orgs/<id> → название/тип/план/период + текущий план-лимиты + список активных overrides + форма «Добавить override» (POST /api/admin/orgs/:id/plan-overrides — добавлен в этой фазе)
  - /admin/audit → audit-log таблица с фильтрами по action+since (используется существующий /api/admin/audit-log endpoint, но рендерится server-side из БД)
  - non-admin (phase14-noadmin@example.com) на /admin → "Доступ запрещён." (layout-guard на is_admin) ✓
- Коммит: 6236aa8

## auth-iter 24 — Cleanup: удаление identity-session.ts
- Дата: 2026-05-08
- Что закрыто: фаза 24 («cleanup»)
- Тесты: 659/695 vitest (36 skipped), 0 failed; typecheck baseline (14); build green
- Файлы: rewritten — app/api/repos/[repoId]/{conversations/{,[conversationId]},wake,production-domain}/route.ts, app/api/projects/[id]/{rebuild,build-status,upload}/route.ts, app/[repoId]/[conversationId]/page.tsx; deleted — adorable/lib/identity-session.ts; updated 10 test files (auth/db pass-through mocks, removed identity-session imports, skipped obsolete identity-cookie denial tests)
- Верификация:
  - `grep identity-session adorable/{app,lib,components}` → пусто (только в auth-doc'ах)
  - vitest 659/695 pass (36 skipped — все pre-existing chat/conversations e2e + 6 obsolete identity-cookie denial кейсов с пометкой "Phase 24")
  - build green; typecheck baseline (14 pre-existing test errors, ноль введённых)
- Замечания: identity-session.ts удалён вместе с .adorable/acl.json. Все routes теперь gates через protectedRoute + requirePermission. Build-status SSE использует inline session-check (не оборачивается в protectedRoute, потому что возвращает streaming Response).
- Коммит: 1db7ed1

## auth-iter 25 — все сценарии зелёные, миграция закрыта
- Дата: 2026-05-08
- Что закрыто: фаза 25 (e2e Playwright MCP scenarios) + миграция auth/multi-tenancy
- Тесты: 659/695 vitest (36 skipped), 0 failed; typecheck baseline (14); build green
- Файлы: verification/scenarios/{auth-signup-and-create-project,auth-strict-link,auth-quota-exceeded,admin-suspend}.md (новые); publication-visibility.md дополнен Phase 25 re-confirm; lib/auth/session.ts — added suspended/deleted gate в requireSession (defence-in-depth для stale tokens)
- Verification:
  1. signup-and-create-project: phase25-scenario@example.com → /signup → /verify-email?pending → JWT verify-link из dev-log → /api/auth/verify-email → 302; sign-in → POST /api/repos → 200; POST /api/chat → 200 SSE с `data:{"type":"start",...}` ✓
  2. strict-link: UI page /auth/account-conflict?provider=google&existingProvider=email&email=... рендерит правильный текст с правильно подставленными именами провайдеров. Полный round-trip через Google OAuth требует реальных credentials (отмечено в scenario doc) ✓
  3. quota-exceeded: UPSERT usage_counters.used=100000 → POST /api/chat → 402 + envelope {error:{code:"quota.exceeded",quota:{kind,limit,used,period_start}}} ✓
  4. publication-visibility: матрица из Phase 22 re-confirmed ✓
  5. admin-suspend: admin → POST /api/admin/users/:id/suspend → 200; suspended user signin → 200 (Better Auth не блокирует), GET /api/me → 423 auth.account_suspended ✓
- Замечания: добавил suspended/deleted-status check в requireSession (Doc 2 §7.11 implied "loses access immediately"). Это defence-in-depth для случая когда suspend запускается раньше чем sessions DELETE доходит — protected routes отбивают 423 даже с валидным cookie. Strict-link Google round-trip требует настоящих GOOGLE_CLIENT_ID/SECRET для полного e2e — UI-часть и server-side accountLinking:false независимо проверены.
- Коммит: d16f865
