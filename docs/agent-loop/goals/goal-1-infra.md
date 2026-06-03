# Goal 1 — Инфраструктура (Redis, pg-boss, worker/reaper, схема)

Phase 1 спеки v2.1. Вставить блок ниже после `/goal`.

```markdown
# GOAL CONTRACT — PHASE 1 (INFRA)

## OBJECTIVE
Поднята инфраструктура транспорта и очереди: Redis(noeviction)+Jaeger в compose, таблицы runs/conversations/messages + unique-индекс one_active_run_per_project, pg-boss, скелет worker+reaper(/health) — всё компилируется и проходит smoke.

## SUCCESS CRITERIA (артефакты, не со слов)
- `docker compose config` exit 0; вывод содержит сервисы redis, worker, reaper, jaeger; у redis команда содержит `--maxmemory-policy noeviction` (НЕ allkeys-lru) и `--appendonly yes`.
- `cd adorable && npm run db:generate` создаёт новую миграцию в adorable/lib/db/migrations/. `grep -rl one_active_run_per_project adorable/lib/db/migrations` находит partial UNIQUE INDEX с предикатом `status IN ('queued','running','cancelling','reaping')`; в schema есть таблицы runs(+jobId,+activeStreamId,+heartbeatAt, enum со статусами cancelling/reaping), conversations, messages(uniqAssistantPerRun WHERE role='assistant').
- `cd adorable && npx vitest run tests/worker-smoke.test.ts` exit 0 против Testcontainers postgres: enqueue → воркер логает job; reaper тикает под pg_try_advisory_lock (ассерт: второй reaper-инстанс не получает лок).
- `npm run build` exit 0.
- Регрессия: `npm test` exit 0.

## OUTCOME TAXONOMY (сумма = 5)  // §11 пункты 1–5
- fixed             — пункт работает, доказан прогоном/наличием артефакта на диске
- ack_stale         — нужен upstream-апгрейд вне скоупа; с доказательством в коммите
- abandoned         — сознательно отложено; залогировано
- external_blocker  — нет Docker для Testcontainers / docker.sock недоступен / реестр образов недоступен
Запрещено: пустой стаб помечать fixed.

## HARD CONSTRAINTS
- RETRY CEILING: 3 попытки на категорию (например «drizzle partial-index синтаксис», «pg-boss bootstrap»).
- 0 регрессий: `npm test` на уже-зелёных тестах остаётся exit 0.
- One active goal в этом репо.
- Один коммит на переход корзины, причина в сообщении.
- Зависит от Phase 0 ТОЛЬКО для Phase 3; сама инфра-фаза от транспорта не зависит.

## ITERATIVE PASSES
- Pass 1: схема+миграция+compose+pg-boss bootstrap; снять лог.
- Pass N: читать лог, бить по реальным ошибкам генерации/буста.
- Стоп при ceiling на остатке.

## OUT OF SCOPE
- Реальный agent loop / streamText (Phase 3).
- Переписывание /api/chat, транскрипт-функции (Phase 2/3).
- Реальная сборка Dockerfile.worker, если Docker недоступен → external_blocker.

## DEFINITION OF DONE
Клир ТОЛЬКО ЕСЛИ: docker compose config exit 0 с redis/worker/reaper/jaeger+noeviction AND миграция с one_active_run_per_project на диске AND worker-smoke exit 0 AND npm run build exit 0 AND npm test exit 0 AND сумма корзин = 5 AND ничего вне таксономии. Иначе — продолжать / честная корзина при ceiling.
```
