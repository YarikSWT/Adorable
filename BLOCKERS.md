# Blockers

Блокеры в процессе миграции. Формат:
```
## <ISO дата> — <заголовок>
- Задача: <которую пытались закрыть>
- Симптом: <что не получилось>
- Следующий шаг: <план>
```

---

## 2026-04-22 — Финальный e2e: Z.ai insufficient balance  — ✅ RESOLVED 2026-04-23
- Задача: `верификация: регистрация → создание проекта → промпт → AI (GLM-5.1) генерирует код → файл в sandbox → preview через Caddy → валидный HTML`.
- Симптом: дошли до фактического вызова GLM через `/api/chat`. Сервер Z.ai ответил `HTTP 429: {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}`. API ключ валидный (проверено на /api/v1/user), баланс ноль.
- Код-путь в форке полностью функционален: infra up, Gitea create repos OK, dockerode create container OK, streamText → lib/adapters/llm.ts → z.ai endpoint — запрос корректной формы отправляется (видно в exception log). Блок — внешняя биллинговая система.
- **Разблокировано 2026-04-23:** баланс Z.ai пополнен, API вернул 200. Playwright MCP final e2e прошёл полностью: POST /api/chat 200 in 108s (streaming GLM-5.1), agentic tool-use, файл в sandbox, preview через Caddy (после фикса DNS-63-limit в sandbox-docker.ts), валидный HTML в браузере. См. `VERIFICATION_LOG.md` 2026-04-23 запись.
