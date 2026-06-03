# Goal 4 — fail-fast + reaper + heartbeat

Phase 4 спеки v2.1. Вставить блок ниже после `/goal`.

```markdown
# GOAL CONTRACT — PHASE 4 (FAIL-FAST + REAPER + HEARTBEAT)

## OBJECTIVE
retryLimit:0; статусы cancelling/reaping в enum+unique-индексе; heartbeat в воркере (10с); reaper под advisory-lock сметает running(crash)/cancelling(stuck)/queued(lost-job) с per-run CAS→reaping перед git-commit. Инвариант: любой не-терминальный run приходит к терминальному ≤90с, проект не лочится навсегда.

## SUCCESS CRITERIA (артефакты, §12.4.2–3 + §12.5.4–6)
- `cd adorable && npx vitest run tests/fail-fast-sigkill.test.ts tests/reaper-orphan-commit.test.ts tests/reaper-cas-vs-handler.test.ts` exit 0 (Testcontainers PG+Redis, fake vm).
- Ассерты: (a) SIGKILL воркера в середине → retryLimit:0, джоба НЕ переисполняется, нет склейки двух генераций; (b) status=running+heartbeat stale+живой sandbox → reaper: draft-commit наработки + failed + release reservation + clear stream, код наработки в draft-ветке; (c) reaper CAS не проходит при живом handler-commit → no-op, один git-commit, нет флипа статуса; (d) reaper сметает stuck cancelling → cancelled, проект свободен; (e) lost queued (нет джобы в очереди) → failed.
- Регрессия `npm test` exit 0; `npm run build` exit 0.

## OUTCOME TAXONOMY (сумма = 3)  // §11 пункты 16–18
- fixed             — единица работает, доказана живым прогоном
- ack_stale         — легитимно нельзя сейчас; с доказательством в коммите
- abandoned         — сознательно вне скоупа; залогировано
- external_blocker  — нет Docker/Testcontainers для симуляции crash

## HARD CONSTRAINTS
- RETRY CEILING: 3 на категорию.
- 0 регрессий: `npm test` зелёный.
- One active goal в репо. Коммит на переход корзины.
- Reaper строго в одном экземпляре (advisory-lock) — ассерт в тесте.

## ITERATIVE PASSES
- Pass 1: heartbeat + reaper sweep + CAS→reaping.
- Pass N: читать лог, бить по реальным гонкам reaper↔handler.

## OUT OF SCOPE
- stop-эндпоинт (Phase 5), quota (Phase 6).

## DEFINITION OF DONE
Клир ТОЛЬКО ЕСЛИ: fail-fast+reaper тесты exit 0 со всеми ассертами (a–e) AND npm run build+npm test exit 0 AND сумма корзин = 3 AND ничего вне таксономии. Иначе — продолжать / корзина при ceiling.
```
