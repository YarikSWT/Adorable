# Scenario — Signup, verify email, create project (Phase 25)

End-to-end check that the auth onboarding flow + project creation works
against the live dev server. Uses Playwright MCP for the UI driving and
psql for state assertions; verify-email JWT is plucked out of the
dev-server log because dev runs in console-mode (no real SMTP).

## Steps

1. **Sign out** existing session, navigate to `/signup`.
2. **Submit form**: name="Phase25 Scenario", email=`phase25-scenario@example.com`,
   password=`password123`, ToS checkbox ticked.
3. **Expect** redirect to `/verify-email?pending=true&email=…`.
4. **Pull verify URL** from the dev-server log (look for the
   `[mail:console]` block matching the email). The URL has the form
   `/api/auth/verify-email?token=<JWT>&callbackURL=%2F`.
5. **GET** that URL → server responds 302 → /; psql confirms
   `users.email_verified=true`.
6. **Sign in** with the same credentials.
7. **POST /api/repos** `{name:"Phase25 Demo", conversationTitle:"first"}` →
   200 with `{id, conversationId}` (id = wrapper-repo path).
8. **POST /api/chat** with the user message → expect 200 +
   `Content-Type: text/event-stream` + first chunk
   `data: {"type":"start", ...}` (mock LLM streaming).

## Observed (8 May 2026)

```text
1. /signup form submit → URL becomes
   /verify-email?pending=true&email=phase25-scenario%40example.com
2. dev-log verify URL captured (JWT format).
3. GET that URL → 302 to /; psql `email_verified` = t.
4. /api/auth/sign-in/email → 200.
5. POST /api/repos → 200,
   id = "adorable/adorable-meta-54a7b912-18ea-4e01-b1fd-2039ade10fd8".
6. POST /api/chat → 200, content-type text/event-stream,
   first chunk: `data: {"type":"start","messageId":"e536ab6e-..."}`.
```

All assertions met. Pre-flight quota gate (Phase 13) and bootstrap
hook (Phase 4) both fire silently — chat would 423 if the verify step
were skipped, and the persona-org/free-subscription pair shows up in
psql immediately after step 6.
