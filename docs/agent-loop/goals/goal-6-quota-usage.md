# Goal 6 — quota-резервация + usage-reconcile + validation feedback

Phase 6 спеки v2.1. Вставить блок ниже после `/goal`.

```markdown
# GOAL CONTRACT — PHASE 6 (QUOTA + USAGE + AUTO-RETRY)

## OBJECTIVE
Резервация квоты в POST /api/chat (reserve, не check-then-act); recordUsage+reconcile во ВСЕХ терминальных ветках (вкл. release при orphan); bounded validation feedback без жёсткого abort при budget-exhausted.

## SUCCESS CRITERIA (артефакты, §12.4.6 + §12.6)
- `cd adorable && npx vitest run tests/quota-reserve-reconcile.test.ts tests/validation-feedback.test.ts` exit 0 (Testcontainers PG+Redis, MockLanguageModelV2).
- Ассерты: (a) failed/cancelled → recordUsage с частичным usage; orphan → release reservation (идемпотентно по runId); (b) reserveQuota блокирует при превышении (429 quota_exceeded); ESTIMATED_TURN_TOKENS сайзится под многошаговый максимум (не средний ход) — зафиксировано в коде/комменте; (c) fix с 1-й попытки: validate fail→fix→pass→completed; (d) budget-exhausted БЕЗ обрыва: после 3 фейлов validate отдаёт «explain to user», run completed с финальным объяснением (НЕ failed-abort); (e) дедуп по hash → ранняя эскалация; (f) счётчик обнуляется после passed; stepCount пишется из result SDK (один счётчик, без incrementStep).
- Регрессия `npm test` exit 0; `npm run build` exit 0.

## OUTCOME TAXONOMY (сумма = 3)  // §11 пункты 23–25
- fixed             — единица работает, доказана живым прогоном
- ack_stale         — легитимно нельзя сейчас; с доказательством в коммите
- abandoned         — сознательно вне скоупа; залогировано
- external_blocker  — нет Docker/Testcontainers

## HARD CONSTRAINTS
- RETRY CEILING: 3 на категорию.
- 0 регрессий: `npm test` зелёный.
- One active goal в репо. Коммит на переход корзины.
- recordUsage/releaseReservation идемпотентны по runId (handler vs reaper).

## ITERATIVE PASSES
- Pass 1: reserveQuota + recordUsage reconcile во всех ветках.
- Pass N: читать лог, бить по реальным leak-кейсам резерва / budget-exhausted abort.

## OUT OF SCOPE
- Polish (Phase 7): реальные modelId, cap tool-part, admin-панель.

## DEFINITION OF DONE
Клир ТОЛЬКО ЕСЛИ: quota+validation тесты exit 0 со всеми ассертами (a–f) AND npm run build+npm test exit 0 AND сумма корзин = 3 AND ничего вне таксономии. Иначе — продолжать / корзина при ceiling.
```
