# Goal 5 — stop + cancel

Phase 5 спеки v2.1. Вставить блок ниже после `/goal`.

```markdown
# GOAL CONTRACT — PHASE 5 (STOP + CANCEL)

## OBJECTIVE
POST /api/chat/:id/stop: queued → CAS прямо в cancelled (+release резерва, без дедлока в cancelling); running → cancelling+cancel-флаг (воркер довершит ≤5с). Cancel-флаг опрашивается в воркере+abort; step-0 cancel с release+clear. Навигация ≠ stop.

## SUCCESS CRITERIA (артефакты, §12.5)
- `cd adorable && npx vitest run tests/stop-queued-no-deadlock.test.ts tests/stop-running-cancel.test.ts tests/cancel-state-machine.test.ts` exit 0 (Testcontainers PG+Redis).
- Ассерты: (a) queued-cancel → статус cancelled (НЕ застрял в cancelling), резерв возвращён, проект свободен (новый run встаёт) — регресс на дедлок; (b) step-0 cancel → cancelled + release + clear, резервация возвращена; (c) running-cancel → cancelling+флаг → abort ≤5с → cancelled, частичный assistantMessage сохранён (onFinish авторитетнее snapshot); (d) re-enqueue после cancel работает; (e) stale stop (устаревший activeStreamId) → no-op; (f) disconnect/навигация НЕ переводит в cancelled.
- Регрессия `npm test` exit 0; `npm run build` exit 0.

## MANUAL VERIFICATION (playwright-mcp, см. MANUAL-VERIFY.md)
В реальном браузере против запущенного app+worker+infra, с артефактами:
- MV-5.1 stop в середине → стрим стоп ≤5с, частичный ответ остаётся, run cancelled;
- MV-5.2 навигация (уход/возврат) ≠ stop → run НЕ cancelled, стрим резюмируется;
- MV-5.3 re-enqueue после cancel → новый run стартует (проект не залочен).
Доказательство: `verification/agent-loop/MV-5.*.png` + PASS в `verification/agent-loop/manual-verify-log.md`. Нет браузера/среды → external_blocker с причиной, не фейк-PASS.

## OUTCOME TAXONOMY (сумма = 4)  // §11 пункты 19–22
- fixed             — единица работает, доказана живым прогоном
- ack_stale         — легитимно нельзя сейчас; с доказательством в коммите
- abandoned         — сознательно вне скоупа; залогировано
- external_blocker  — нет Docker/Testcontainers

## HARD CONSTRAINTS
- RETRY CEILING: 3 на категорию.
- 0 регрессий: `npm test` зелёный.
- One active goal в репо. Коммит на переход корзины.
- stop НЕ вызывается из cleanup роута/навигации — только явная кнопка.

## ITERATIVE PASSES
- Pass 1: stop-эндпоинт ветвление по статусу + cancel-флаг в воркере.
- Pass N: читать лог, бить по реальным гонкам queued-cancel/re-enqueue.

## OUT OF SCOPE
- quota-резервация/usage/auto-retry (Phase 6).

## DEFINITION OF DONE
Клир ТОЛЬКО ЕСЛИ: stop/cancel тесты exit 0 со всеми ассертами (a–f) AND npm run build+npm test exit 0 AND manual-verify MV-5.1–5.3 = PASS с артефактами verification/agent-loop/MV-5.*.png (либо external_blocker с причиной) AND сумма корзин = 4 AND ничего вне таксономии. Иначе — продолжать / корзина при ceiling.
```
