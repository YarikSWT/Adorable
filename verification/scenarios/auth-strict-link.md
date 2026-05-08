# Scenario — Strict account linking (Phase 25)

Verifies that an OAuth attempt with an email already used by an
email/password account does NOT silently merge the accounts but lands
on `/auth/account-conflict` with provider-specific copy (Doc 1 §4.3,
Doc 2 §3.1 `accountLinking.enabled: false`).

## Steps (full e2e — requires real Google credentials)

1. Sign up via `/signup` with `phase25-conflict@example.com` /
   password (email/password path).
2. Sign out.
3. On `/login`, click **«Войти через Google»** and sign in with the
   same email at Google.
4. Better Auth's `oauthCallback` rejects the link (server returns the
   conflict redirect targeting `/auth/account-conflict?provider=google
   &existingProvider=email&email=phase25-conflict@example.com`).
5. The page renders the strict-link copy with a CTA to log in via the
   original method.

## Verification on a local dev box (without real Google credentials)

The UI page is independently verified by direct navigation:

```text
GET /auth/account-conflict?provider=google
       &existingProvider=email
       &email=phase25-conflict@example.com
→ 200, body contains:
  «Аккаунт уже существует»
  «Email phase25-conflict@example.com уже привязан к существующему аккаунту.»
  «Похоже, у вас уже есть аккаунт, привязанный через email и пароль.
   Чтобы войти через Google, сначала войдите старым способом и
   привяжите этого провайдера в настройках.»
  «Войти существующим способом» (link → /login?email=…)
  «Не помните, как регистрировались? Восстановить доступ по email.»
```

The server-side strict-link logic is `accountLinking.enabled: false`
in `lib/auth/better-auth.ts`. Better Auth raises an error from
`oauthCallback` in that mode; the redirect to `/auth/account-conflict`
is wired by the catch-all route plus the OAuth callback hook (TODO:
real Google credentials needed for end-to-end click-through; the page
itself + the strict-link config are independently verified).
