# Agent loop · долгоживущие runs

**TL;DR.** Agent loop переезжает из HTTP-хендлера `POST /api/chat` в отдельный **воркер**. Результат переживает закрытие вкладки, стрим резюмируется, слои масштабируются независимо. Координация — только через **Postgres** (durable state) и **Redis** (эфемерный транспорт стрима). Код проекта — в **Gitea**.

> Главный инвариант: **система не теряет и не портит runs.** Любой принятый run приходит к терминальному статусу, транскрипт воспроизводим, наработанный код не теряется — даже при закрытии вкладки, рестарте или смерти воркера.

## Документы

| Файл | Что внутри |
|---|---|
| [`0-agent-loop-backend-core-design.md`](./0-agent-loop-backend-core-design.md) | Полная техническая спека (v2.x): схема БД, API, воркер, reaper, state-machine, план миграции, верификация. |
| [`0-agent-loop-backend-core-architecture.html`](./0-agent-loop-backend-core-architecture.html) | Визуальный обзор: диаграммы, карта системы, потоки, машина состояний. Открой в браузере. |

## Суть за 60 секунд

- **Воркер вместо хендлера.** `pg-boss` поверх Postgres ставит джобу; долгоживущий Node-процесс крутит `streamText`. API стал тонким.
- **Транспорт стрима — `resumable-stream` + Redis.** Воркер — publisher, Next — subscriber. Свой event-log/SSE/reducer выкинут (это убрало класс багов).
- **Live первого хода — server-side bridge.** `POST /api/chat` сам подписывается на Redis-стрим воркера и отдаёт его клиенту; `useChat` получает стрим из ответа на send. `GET /:id/stream` — только для reconnect.
- **Fail-fast (`retryLimit: 0`).** Недетерминированную генерацию не переисполняем (иначе склейка двух разных ответов). Упал в середине → за дело берётся reaper.
- **Reaper.** Фоновый санитар: по heartbeat находит застрявшие runs (`running`/`cancelling`/`queued`), коммитит наработку в `draft`-ветку, доводит до терминала, возвращает резерв квоты. Гарант инварианта.
- **Транскрипт в Postgres.** Полный `UIMessage[]` с tool-parts через `onFinish`, идемпотентно по `runId`. Не теряем tool-историю между ходами.
- **State-machine на CAS.** Все переходы статуса через `finalizeRunCAS` — кто первый, тот владелец; нет флипов и двойных операций. Один активный run на проект — через partial unique index.
- **Квоты.** Резервация на входе → reconcile фактического в `recordUsage` во всех терминальных ветках.

## Три хранилища

- **Postgres** — источник правды: статус, метаданные, транскрипт, очередь, usage.
- **Redis** — эфемерный транспорт: живые байты стрима (TTL, `noeviction`, AOF) + cancel-флаг.
- **Gitea** — только код: `main` на успехе, `draft/run-*` на cancel/fail/crash.

## Что ещё наше (готового нет)

Очередь + воркер и его durability · reaper · fail-fast + state-machine · bounded validation feedback (auto-retry) · model registry · квоты/usage · stop ↔ pg-boss · commit + draft-ветка.

## Статус

Дизайн готов к реализации. **Phase 0 — блокирующий спайк** `resumable-stream` в headless-режиме (publish из воркера без HTTP-клиента + склейка warmup→llm стрима); при провале — fallback на свой тонкий Redis Streams pub/sub. План фаз и тесты-гейты — в design-доке (§11–12).
