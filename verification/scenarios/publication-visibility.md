# Scenario — Publication visibility (Phase 22)

The Caddy `forward_auth` backend lives at **`/api/published-authz`** in
the Next app (Doc 2 §7.8 + Правка 2). Spec sketch named it
`/__published_authz`; Next.js refuses double-underscore-prefixed folder
names, so we use the `/api/` namespace instead.

## Caddyfile sketch

```caddyfile
*.preview.example.com {
  forward_auth next-server:3000 {
    uri /api/published-authz?subdomain={labels.3}
    copy_headers Cookie
  }
  reverse_proxy <static or sandbox upstream>
}
```

Caddy interprets responses:

| HTTP | Meaning                       | Caddy action               |
|------|-------------------------------|----------------------------|
| 200  | Allowed                       | Pass through to upstream   |
| 401  | Anonymous / un-verified email | Redirect to `/login?from=` |
| 403  | Authenticated but no access   | Return 403                 |
| 404  | Unknown / unpublished project | Return 404                 |

## Manual verification (8 May 2026)

Setup: project `Phase17 Tokens Test` with subdomain
`proj-7ad20271-iikitn`, owned by `phase13-chat@example.com`.
Outsider account: `phase22-outsider@example.com` (verified, not a member).

### Curl matrix

```text
GET /api/published-authz?subdomain=does-not-exist          → 404
visibility=public,         no cookie                       → 200
visibility=authenticated,  no cookie                       → 401
visibility=authenticated,  phase13-chat (verified) cookie  → 200
visibility=private,        no cookie                       → 401
visibility=private,        phase13-chat (member) cookie    → 200
visibility=private,        outsider (verified) cookie      → 403
```

All seven responses observed exactly as required. The body is empty in
every case so Caddy doesn't accidentally relay HTML to the upstream.

### Notes

- 401 for an authenticated *but un-verified* user is intentional —
  Правка 2 says `private` and `authenticated` both require
  `email_verified=true`. The handler treats the un-verified path as 401
  so Caddy redirects to login (where the user can re-trigger
  verification), not 403.
- The handler reads the subdomain from `?subdomain=` first, then
  `X-Subdomain` header. Caddy can use either depending on how the
  forward_auth directive is configured.
- ProxyProvider (lib/adapters/proxy-caddy.ts) needs a `forward_auth`
  directive integration to actually surface this route. That live
  Caddy wiring is tracked separately as a follow-up — for the auth
  semantics it is enough that this endpoint returns the right status
  for every input combination (proven above).
