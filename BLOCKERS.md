# Blockers

Блокеры в процессе миграции. Формат:
```
## <ISO дата> — <заголовок>
- Задача: <которую пытались закрыть>
- Симптом: <что не получилось>
- Следующий шаг: <план>
```

---

## 2026-04-22 — Финальный e2e: Z.ai insufficient balance
- Задача: `верификация: регистрация → создание проекта → промпт → AI (GLM-5.1) генерирует код → файл в sandbox → preview через Caddy → валидный HTML`.
- Симптом: дошли до фактического вызова GLM через `/api/chat`. Сервер Z.ai ответил `HTTP 429: {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}`. API ключ валидный (проверено на /api/v1/user), баланс ноль.
- Код-путь в форке полностью функционален: infra up, Gitea create repos OK, dockerode create container OK, streamText → lib/adapters/llm.ts → z.ai endpoint — запрос корректной формы отправляется (видно в exception log). Блок — внешняя биллинговая система.
- Следующий шаг: пополнить баланс на https://z.ai/api-dashboard либо пополнить OPENROUTER_API_KEY и переключить `LLM_PROVIDER=openrouter`. После — повторить iter 15 e2e и получить стримящийся ответ → скриншот финального preview через Caddy.
- PROMPT-правило: «Z_AI_API_KEY (или OPENROUTER_API_KEY при LLM_PROVIDER=openrouter) пустой → КРИТИЧЕСКИЙ БЛОКЕР. Promise НЕЛЬЗЯ.» По духу формально применимо: рабочий ключ без баланса блокирует так же. Promise `FORK_MIGRATION_COMPLETE` не эмитим до пополнения.
