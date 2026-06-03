# Goal 3 — resumable stream + server-side bridge + worker loop

Phase 3 спеки v2.1. **Зависит от исхода Goal 0** (см. PRECONDITION). Вставить блок ниже после `/goal`.

```markdown
# GOAL CONTRACT — PHASE 3 (BRIDGE + WORKER + RESUMABLE STREAM)

## PRECONDITION (из Goal 0)
Если вердикт Phase 0 = GREEN → реализовать §4 как в спеке (resumable-stream).
Если RED → реализовать fallback Redis Streams pub/sub (XADD в воркере, XREAD blocking в bridge/GET, resume по last-id); §4 переписать под него. Прочая архитектура (worker/reaper/schema) не меняется.

## OBJECTIVE
Loop живёт в worker/handle-agent-run.ts; POST /api/chat возвращает СТРИМ через server-side bridge (не JSON); GET /:id/stream — reconnect; onFinish пишет полный UIMessage[] идемпотентно по runId; ранняя публикация стрима ДО гидрации.

## SUCCESS CRITERIA (артефакты, §12.3 + §12.4.1 + §12.4.7 + §12.7)
- `cd adorable && npx vitest run tests/bridge-resumable.test.ts tests/worker-happy.test.ts tests/e2e-tab-close.test.ts` exit 0 против Testcontainers Postgres+Redis + MockLanguageModelV2 + fake vm.
- Ассерты: (a) первый chunk приходит из ответа на POST до завершения run; (b) result.usage резолвится — НЕ виснет (регресс v2.0); (c) reconnect через GET отдаёт остаток, 204+Retry-After в окне activeStreamId=null; (d) несколько подписчиков получают полный стрим; (e) завершённый run → GET /api/chat/:id отдаёт messages, resume-GET → 204; (f) happy: messages содержит assistant-UIMessage С tool-parts, код в main; (g) одна assistant-строка на run (uniq-индекс).
- Фронт: кастомный reducer удалён, `useChat({ resume:true })` + DefaultChatTransport.
- `npm run build` exit 0; регрессия `npm test` exit 0.

## MANUAL VERIFICATION (playwright-mcp, см. MANUAL-VERIFY.md)
Backend-тесты не покрывают живой UX. Прогнать в реальном браузере против запущенного app+worker+infra и сохранить АРТЕФАКТЫ:
- MV-3.1 live первый ход из POST (network: ответ POST = СТРИМ, не JSON);
- MV-3.2 закрыл вкладку → reconnect через GET, транскрипт с tool-parts цел;
- MV-3.3 несколько подписчиков (2 вкладки) видят стрим;
- MV-3.4 завершённый → из Postgres, resume-GET → 204.
Доказательство: `verification/agent-loop/MV-3.*.png` + PASS-записи в `verification/agent-loop/manual-verify-log.md`. Нет браузера/среды → external_blocker с причиной, не фейк-PASS.

## OUTCOME TAXONOMY (сумма = 7)  // §11 пункты 9–15
- fixed             — единица работает, доказана живым прогоном
- ack_stale         — легитимно нельзя сейчас; с доказательством в коммите
- abandoned         — сознательно вне скоупа; залогировано
- external_blocker  — нет Docker для Testcontainers / Redis недоступен / упёрлись в баг resumable-stream, требующий fallback (тогда зафиксировать как смену ветки PRECONDITION, не как fixed-стаб)

## HARD CONSTRAINTS
- RETRY CEILING: 3 на категорию (например «drain/usage hang», «bridge timeout», «composed stream framing»).
- 0 регрессий: `npm test` зелёный.
- One active goal в репо. Коммит на переход корзины.
- workerWaitUntil — реальный pump, НЕ no-op (иначе usage виснет).

## ITERATIVE PASSES
- Pass 1: перенос loop + публикация + bridge happy-path.
- Pass N: читать лог фейлов (drain, reconnect, multi-subscriber), бить по реальным.

## OUT OF SCOPE
- Reaper/heartbeat (Phase 4), stop/cancel (Phase 5), quota/auto-retry (Phase 6).

## DEFINITION OF DONE
Клир ТОЛЬКО ЕСЛИ: bridge+worker+e2e тесты exit 0 со всеми ассертами (a–g) AND reducer удалён AND npm run build+npm test exit 0 AND manual-verify MV-3.1–3.4 = PASS с артефактами verification/agent-loop/MV-3.*.png (либо external_blocker с причиной) AND сумма корзин = 7 AND ничего вне таксономии. Иначе — продолжать / корзина при ceiling.
```
