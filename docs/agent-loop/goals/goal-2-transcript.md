# Goal 2 — Транскрипт переезжает в Postgres

Phase 2 спеки v2.1. Вставить блок ниже после `/goal`.

```markdown
# GOAL CONTRACT — PHASE 2 (TRANSCRIPT → POSTGRES)

## OBJECTIVE
Транскрипт хранится в Postgres (conversations+messages, полный UIMessage[] с tool-parts), repo-storage conversation-функции переписаны на PG, meta-репо больше не создаётся, есть разовый скрипт миграции из adorable-meta.

## SUCCESS CRITERIA (артефакты)
- `cd adorable && npx vitest run tests/migrate-metadata.test.ts tests/transcript-postgres.test.ts` exit 0: loadConversationUIMessages/saveConversationMessages читают/пишут PG; ассерт — сохранённый assistant-UIMessage содержит tool-parts (не плоский текст).
- Тест на POST /api/repos НЕ создаёт meta-репо: `cd adorable && npx vitest run tests/repos-route-idempotency.test.ts` exit 0 + явная ассерт-проверка отсутствия adorable-meta создания.
- Скрипт миграции существует и идемпотентен: повторный прогон не дублирует messages (ассерт по count в тесте против Testcontainers PG).
- Регрессия: `npm test` exit 0; `npm run build` exit 0.

## OUTCOME TAXONOMY (сумма = 3)  // §11 пункты 6–8
- fixed             — функция работает, доказана прогоном на PG
- ack_stale         — зависит от Phase 3 onFinish-формата; с доказательством
- abandoned         — сознательно отложено; залогировано
- external_blocker  — нет Docker для Testcontainers / Gitea-источник для миграции недоступен

## HARD CONSTRAINTS
- RETRY CEILING: 3 на категорию.
- 0 регрессий: `npm test` зелёный.
- One active goal в репо. Коммит на переход корзины.

## ITERATIVE PASSES
- Pass 1: переписать conversation-функции на PG + тест.
- Pass N: читать лог, бить по реальным ошибкам сериализации UIMessage/jsonb.

## OUT OF SCOPE
- resumable-stream / bridge / worker loop (Phase 3).
- Удаление legacy meta-репо физически (только пометка legacy).

## DEFINITION OF DONE
Клир ТОЛЬКО ЕСЛИ: transcript-тесты exit 0 (с ассертом tool-parts) AND repos-тест подтверждает «meta-репо не создаётся» AND миграционный скрипт идемпотентен (count-ассерт) AND npm test exit 0 AND сумма корзин = 3 AND ничего вне таксономии. Иначе — продолжать / корзина при ceiling.
```
