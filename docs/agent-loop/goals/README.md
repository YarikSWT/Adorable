# Agent-loop backend — launch kit (`/goal` contracts)

Цепочка Stop-hook контрактов для имплементации фичи из
[`../0-agent-loop-backend-core-design.md`](../0-agent-loop-backend-core-design.md) (спека v2.1).

8-фазная фича (Phase 0→6 в скоупе; Phase 7 — polish, без CI-гейта). Phase 0 — блокирующий
спайк с бинарным исходом, переписывающий §4 при RED. Один `/goal` на всё → 4000+ символов →
неуправляемые незапланированные проходы, поэтому работа разбита на фазы.

## Два режима запуска

- **ralph-loop (рекомендуется для автономного прогона):** один loop сам идёт по фазам,
  состояние на диске в [`ralph-state.json`](./ralph-state.json), guard вместо ручных
  чекпоинтов. Контракт: [`RALPH.md`](./RALPH.md). Запуск: `/ralph-loop` + блок из RALPH.md.
- **7 последовательных `/goal` (ручной контроль):** запускать по одному, чекпоинт-коммит
  между фазами (см. ниже). Контракты — в `goal-N-*.md`.

Оба режима используют ОДНИ И ТЕ ЖЕ `goal-N-*.md` как детальные критерии фаз.

## Порядок запуска (режим 7×`/goal`)

Запускать **строго по одному** `/goal` за раз (инвариант «один активный goal на репо» —
параллельные прогоны интерливят коммиты). Между фазами — чекпоинт-коммит. В режиме
ralph-loop этот порядок зашит в requires-gate ([`RALPH.md`](./RALPH.md) → ledger).

```
Goal 0 (СПАЙК, блокирует Goal 3)  ─┐
Goal 1 (инфра)                     │  0/1/2 не зависят по транспорту,
Goal 2 (транскрипт→PG)             │  но в одном репо идут последовательно
Goal 3 (bridge+worker+resumable) ←─┘  ветка Goal 3 зависит от исхода Goal 0
Goal 4 (fail-fast+reaper)
Goal 5 (stop+cancel)
Goal 6 (quota+usage+auto-retry)
[Goal 7 polish — опц., не гейтед]
```

| Файл | Назначение |
|---|---|
| [`RALPH.md`](./RALPH.md) | ralph-loop контракт (фазы 0–6, requires-gate, loop guard) |
| [`ralph-state.json`](./ralph-state.json) | ledger состояния loop (прогресс/корзины/попытки) |
| [`MANUAL-VERIFY.md`](./MANUAL-VERIFY.md) | playwright-mcp ручная верификация UX (гейтит фазы 3/5 + финал) |

| Файл | Фаза | §11 пункты | Таксономия (сумма) |
|---|---|---|---|
| [`goal-0-spike.md`](./goal-0-spike.md) | Phase 0 — спайк resumable-stream (БЛОКИРУЮЩИЙ) | 0a–0c | 3 |
| [`goal-1-infra.md`](./goal-1-infra.md) | Phase 1 — Redis/pg-boss/worker/reaper/схема | 1–5 | 5 |
| [`goal-2-transcript.md`](./goal-2-transcript.md) | Phase 2 — транскрипт → Postgres | 6–8 | 3 |
| [`goal-3-bridge-worker.md`](./goal-3-bridge-worker.md) | Phase 3 — bridge + worker + resumable | 9–15 | 7 |
| [`goal-4-failfast-reaper.md`](./goal-4-failfast-reaper.md) | Phase 4 — fail-fast + reaper + heartbeat | 16–18 | 3 |
| [`goal-5-stop-cancel.md`](./goal-5-stop-cancel.md) | Phase 5 — stop + cancel | 19–22 | 4 |
| [`goal-6-quota-usage.md`](./goal-6-quota-usage.md) | Phase 6 — quota + usage + auto-retry | 23–25 | 3 |

Phase 7 (polish: реальные `modelId`, cap tool-part, admin-панель active runs) не имеет
привязки к CI-гейту в §12.9 → нет надёжной артефакт-поверхности для Stop-hook. Запускать
обычной сессией после Goal 6 либо лёгким `/goal` с DoD = «modelId не плейсхолдер (grep registry)
AND part-size cap покрыт тестом».

## Как запускать

Скопировать содержимое блока ` ```markdown … ``` ` из нужного файла и вставить после `/goal`.

## Поверхность верификации (общая)

Все контракты клирятся на **артефактах**, не на «я сделал»:
- регрессия: `npm test` → exit 0 (vitest, требует Docker для Testcontainers Postgres+Redis);
- сборка: `npm run build` → exit 0;
- миграции: `cd adorable && npm run db:generate` → файл в `adorable/lib/db/migrations/`;
- скоуп-тест фазы: `cd adorable && npx vitest run tests/<file>`;
- `docker compose config` → exit 0 для инфра-проверок.

Поверх backend-тестов фазы 3 и 5 гейтятся **ручной верификацией через playwright-mcp**
(живой UX: стрим первого хода, reconnect, stop, навигация ≠ stop) с артефактами-скриншотами —
см. [`MANUAL-VERIFY.md`](./MANUAL-VERIFY.md).

**Главная зависимость:** раннер должен иметь доступ к Docker (Testcontainers), а для
manual-verify — к playwright-mcp + запущенному app+worker+infra. Чего нет — соответствующие
единицы уходят в корзину `external_blocker` (для этого она и есть).

## Параметры контракта

- **Retry ceiling = 3** на категорию ошибки во всех фазах.
- **Таксономия** per-фаза = число пунктов §11 этой фазы (4 корзины: fixed / ack_stale /
  abandoned / external_blocker).
- **Goal 3 ветвится по исходу Goal 0** (GREEN → §4 как в спеке; RED → fallback Redis Streams) —
  зашито в его PRECONDITION.
