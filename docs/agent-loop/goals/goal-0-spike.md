# Goal 0 — Спайк resumable-stream (БЛОКИРУЮЩИЙ)

Phase 0 спеки v2.1. Блокирует Goal 3. Бинарный исход GREEN|RED.
Вставить блок ниже после `/goal`.

```markdown
# GOAL CONTRACT — PHASE 0 (BLOCKING SPIKE)

## OBJECTIVE
Бинарно доказать: resumable-stream работает как кросс-процессный pub/sub (publisher в воркере headless, subscriber в Next) ИЛИ зафиксировать fallback на свой Redis Streams pub/sub. Без этого Phase 3 не стартует.

## SUCCESS CRITERIA (проверяемо из артефактов, не со слов)
- `cd adorable && npx vitest run tests/spike-resumable-stream.test.ts` → exit 0 против Testcontainers redis:7-alpine.
- Тест ПОКРЫВАЕТ 6 пунктов §12.3.1 / §11.0b: (1) байты уезжают в Redis без HTTP-клиента у publisher; (2) корректный механизм дренажа; (3) поведение waitUntil вне serverless (нужен ли реальный pump, не no-op); (4) subscriber, подключившийся ПОЗЖЕ начала публикации, получает буферизованный стрим целиком; (5) точные имена/сигнатуры API текущей версии пакета; (6) createComposedUiStream: warmup data-* парты + LLM-парты в ОДНОМ протокол-валидном UIMessage-стриме (один start/finish-фрейминг).
- Артефакт решения на диске: `docs/agent-loop/phase0-spike-result.md` с вердиктом GREEN|RED + вставленным выводом прогона как доказательством.
- НЕ принимать «спайк прошёл» без файла-вердикта и зелёного теста.

## OUTCOME TAXONOMY (каждая единица → ровно одна корзина; сумма = 3)
- fixed             — пункт доказан живым прогоном (1: прототип publisher↔subscriber; 2: 6-точечная валидация; 3: вердикт-файл закоммичен)
- ack_stale         — пункт нельзя проверить в этой версии пакета; с доказательством в коммите
- abandoned         — сознательно вне скоупа спайка; залогировано
- external_blocker  — Docker/Testcontainers недоступен в раннере / Redis-образ не тянется / пакет не публикуется в реестр

## HARD CONSTRAINTS
- RETRY CEILING: максимум 3 попытки на КАТЕГОРИЮ ошибки (например «дренаж», «composed-stream framing»). Дальше — честная корзина, дальше не долбить.
- One active goal в этом репо. Параллельный /goal не запускать.
- Каждый переход корзины = один коммит с причиной в сообщении.
- Бинарность: вердикт ОБЯЗАН быть GREEN или RED, «не определились» = провал контракта.

## ITERATIVE PASSES
- Pass 1: поднять минимальный прототип (процесс-A дренит, процесс-B читает), снять лог.
- Pass N: читать лог прошлого прохода, бить по реальным ошибкам API/дренажа, не по гипотезам.
- Стоп прохода при достижении ceiling на оставшихся пунктах.

## OUT OF SCOPE
- Реальный agent loop, streamText, sandbox — это Phase 3.
- Любые изменения схемы БД / эндпоинтов /api/chat.

## DEFINITION OF DONE (что читает Stop hook)
Клир ТОЛЬКО ЕСЛИ: spike-тест exit 0 AND файл phase0-spike-result.md с вердиктом GREEN|RED+доказательство закоммичен AND сумма корзин = 3 AND ни одной единицы вне таксономии. Иначе продолжать; при ceiling — честная корзина + отчёт, затем клир.
```
