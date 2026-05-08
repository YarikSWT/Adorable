# Scenario — Quota exceeded → 402 in chat (Phase 25)

End-to-end verification that hitting the per-org `llm.tokens.monthly`
limit returns the standard 402 envelope from `/api/chat`. The UI
renders this as a chat bubble (Doc 3 §8.3); the scenario here covers
the API layer + DB state.

## Steps

1. Identify the personal-org of the test user
   (`phase25-scenario@example.com`).
2. UPSERT `usage_counters` so `llm.tokens.monthly` for the current
   period equals the free-plan limit (100 000).
3. POST `/api/chat` with a one-message body.
4. Expect 402 + the canonical `{error:{code:"quota.exceeded",
   message, quota:{kind, limit, used, period_start}}}` envelope.

## Observed (8 May 2026)

```text
SQL: INSERT INTO usage_counters (organization_id, period_start, kind, used)
     VALUES ('5fa8f068-…', '2026-05-01', 'llm.tokens.monthly', 100000)
     ON CONFLICT (organization_id, period_start, kind)
     DO UPDATE SET used = 100000;

POST /api/chat → 402
{
  "error": {
    "code": "quota.exceeded",
    "message": "Превышена квота плана",
    "quota": {
      "kind": "llm.tokens.monthly",
      "limit": 100000,
      "used": 100000,
      "period_start": "2026-05-01T00:00:00.000Z"
    }
  }
}
```

The UI side (Doc 3 §8.3) renders this envelope into a chat bubble with
a CTA towards `/orgs/<personal>/billing` — that URL is also the home
QuotaBanner's CTA target (Phase 21).
