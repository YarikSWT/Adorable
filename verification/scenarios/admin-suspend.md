# Scenario — Admin suspends user (Phase 25)

Verifies that an admin-issued suspend immediately locks the target out
of every protected route. Phase 14's suspend handler also nukes
`sessions` rows; this scenario doubles up by checking that even a
fresh post-suspend sign-in is rejected at the next protected call.

## Steps

1. Sign in as an admin (`phase13-chat@example.com`, promoted in
   Phase 14 with `is_admin=true` + `admin_role_assignments` for
   `admin.superadmin`).
2. Look up the target user via `GET /api/admin/users?q=…`.
3. `POST /api/admin/users/<id>/suspend` → 200 (handler also flips
   `users.status="suspended"` and deletes the user's sessions).
4. Sign out as admin.
5. Re-sign-in as the suspended user (Better Auth's email-and-password
   flow does NOT gate on `users.status`, so this succeeds with 200).
6. `GET /api/me` (any protected route works) → 423 with
   `auth.account_suspended`.

## Observed (8 May 2026)

```text
1. admin sign-in OK.
2. /api/admin/users?q=phase25-scenario → finds id=a042fa83-…
3. POST /api/admin/users/a042fa83-…/suspend → 200.
4. /api/auth/sign-out OK.
5. POST /api/auth/sign-in/email (phase25-scenario / password123) → 200,
   body.user.status = "suspended".
6. GET /api/me → 423 {"error":{"code":"auth.account_suspended",
   "message":"Аккаунт временно недоступен. Свяжитесь с поддержкой."}}.
```

The session-level guard lives in `lib/auth/session.ts:requireSession`
— added in this phase as defence-in-depth so a stale token issued
before suspend can't slip through. UI surfaces this via the standard
HttpError envelope; login form (Doc 3 §3.2) maps 423 to the
"Аккаунт временно недоступен" message.
