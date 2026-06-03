# Спецификация архитектуры платформы 44bolt — v2.1

**Статус:** v2.1, технический документ для разработчика
**Дата:** июнь 2026
**Скоуп:** Серверная часть платформы (генерация приложений). НЕ покрывает runtime юзерских приложений (Appwrite + workerd — отдельный слой).
**Изменения относительно v2.0:** учтено второе ревью транспорта. Главное: (1) добавлен **server-side bridge** для live-стрима первого хода — POST сам возвращает стрим из Redis, а не JSON `{runId}`; (2) добавлена **Phase 0 — блокирующий спайк** `resumable-stream` в headless-режиме; (3) **reaper теперь коммитит** осиротевший sandbox в draft-ветку (иначе hard-crash терял ход). Плюс правки схемы: `jobId` в `runs`, отвязка liveness от job-expiration, `noeviction` для Redis, идемпотентный ключ assistant-сообщения, резервация квоты.

---

## 0. Что изменилось между v1 и v2 (читать первым)

v1 строила **самописный** транспорт стрима: таблица `run_events` (append-only), event-emitter с batching, SSE-эндпоинт с LISTEN/NOTIFY и `Last-Event-ID`, reducer на фронте. Ревью нашло в этой реализации 6 критических дыр (недетерминированный replay, окно потери событий LISTEN/backlog, неработающий queued-cancel, потеря tool-истории, отсутствие reaper, выпавший биллинг).

**v2 заменяет самописный транспорт на готовый механизм AI SDK** (`resumable-stream` + Redis + `useChat({ resume: true })`). Это разом устраняет целый класс багов, потому что соответствующий код больше не наш.

### Решённые архитектурные развилки (зафиксированы)

1. **Транспорт стрима:** `resumable-stream` (npm) поверх **Redis**, не самописный `run_events`. Redis добавляется в стек. **⚠ Зависит от результата Phase 0 (спайк):** если headless-publish из воркера не подтвердится — fallback на свой тонкий Redis Streams pub/sub (§2.1).
2. **Модель исполнения:** loop крутится в **pg-boss воркере** (отдельный процесс), воркер публикует UIMessage-стрим в Redis как publisher. **Live-стрим первого хода — через server-side bridge:** `POST /api/chat` сам подписывается на Redis-стрим воркера и возвращает его клиенту (так `useChat` получает стрим из ответа на send). `GET /:id/stream` — только для reconnect. (Развилка «а» + bridge, ревью v2 §2.)
3. **Retry недетерминированного run-а:** **fail-fast** — pg-boss `retryLimit: 0`, повтора джобы нет вообще. Упал в середине → reaper доводит до `failed`, юзер перезапускает. (Закрывает ревью §1; колонка `hasStreamedContent` из v2.0 удалена как мёртвая — см. §6.)
4. **Хранение транскрипта:** в **Postgres** (новые таблицы `conversations` + `messages`), полный `UIMessage[]` с tool-parts через `onFinish` колбэк SDK. НЕ в Gitea. Идемпотентность по `runId` (уникальный индекс), чтобы stop-snapshot и onFinish не дублировали. (Закрывает ревью §5 + v2 §8.)
5. **Gitea:** только **код** проекта (`adorable-src`). Репо `adorable-meta` упраздняется.
6. **`activeStreamId` + `jobId`:** в Postgres, в таблице `runs`. Redis держит только байты стрима.
7. **Наработанные файлы при cancel/fail/crash:** коммит в draft-ветку Gitea. **Включая hard-crash:** reaper коммитит осиротевший sandbox (контейнер жив по idle-TTL). (Закрывает ревью §14 + v2 §3.)

### Что из v1 ВЫКИНУТО

- Таблица `run_events` — её роль (replay) берёт `resumable-stream` в Redis.
- Самописный event-emitter с batching (§4.4 v1).
- Самописный SSE-эндпоинт с LISTEN/NOTIFY + Last-Event-ID (§3.2 v1).
- Reducer на фронте — `useChat` делает это сам.
- Поэтому ревью §3 (гонка LISTEN/backlog), §11 (транзакционность NOTIFY), §12 (backpressure) — **более не применимы**, это был наш код, которого больше нет.

### Что ОСТАЁТСЯ нашим (готового нет)

- Очередь + воркер (pg-boss) и его durability.
- Reaper осиротевших runs (ревью §2).
- Fail-fast политика (ревью §1).
- Content auto-retry / validation loop.
- Model registry, quota pre-check, recordUsage во всех терминальных ветках (ревью §7).
- Stop endpoint → отмена pg-boss job (SDK про очередь не знает).
- Коммит кода в Gitea + draft-ветка на cancel/fail.

---

## 1. Архитектурная карта

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (browser)                              │
│   useChat({ id, resume: true, transport: DefaultChatTransport })         │
│     - POST /api/chat  → возвращает СТРИМ (bridge), не JSON               │
│     - GET  /api/chat/:id/stream → resume ТОЛЬКО при reconnect            │
│     - POST /api/chat/:id/stop   → явная остановка (наш эндпоинт)         │
│   SDK сам реконструирует UI из UIMessage-стрима. Нашего reducer-а нет.   │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼──────────────────────────────────────┐
│                      NEXT.JS (API ONLY, thin)                            │
│   POST /api/chat → createRun, enqueue, ЖДАТЬ activeStreamId,             │
│                    resumeExistingStream → вернуть стрим клиенту (BRIDGE) │
│   GET  /api/chat/:id/stream → resumeExistingStream (reconnect) | 204     │
│   POST /api/chat/:id/stop   → boss.cancel(jobId) + cancel-флаг + clear   │
│   GET  /api/chat/:id        → метаданные run + история messages          │
└──────────────┬────────────────────────────┬──────────────────────────────┘
               │ enqueue                     │ resumeExistingStream (read,
               │                             │   и для bridge, и для reconnect)
┌──────────────▼─────────┐            ┌──────▼──────────────────────────────┐
│      pg-boss queue     │            │   Redis (NEW)                       │
│   (existing postgres)  │            │   - resumable-stream storage        │
└──────────────┬─────────┘            │   - UIMessage stream bytes (TTL)    │
               │ poll                 │   - publisher: worker (с дренажом!) │
               │                      │   - subscriber: next.js (bridge+GET)│
┌──────────────▼──────────────────┐   │   - policy: noeviction (НЕ lru)     │
│  AGENT WORKER (Node process)    │   │   - cancel-флаг: cancel:{runId}     │
│  (NEW — separate process)       │   └─────────────────────────────────────┘
│  - boss.work('agent-run')       │
│  - reserve quota (резервация)   │   ┌─────────────────────────────────────┐
│  - resolve sandbox (Docker)     │   │   Postgres (existing v16)           │
│  - hydrate /workspace from git  │──▶│   Tables (new):                     │
│  - streamText (Vercel AI SDK)   │   │    - runs (+activeStreamId,+jobId)  │
│  - createNewResumableStream     │   │    - conversations                  │
│    + ЯВНЫЙ ДРЕНАЖ в Redis       │──▶│    - messages (UIMessage, uniq runId)│
│  - tools execute via vm         │   │    - pgboss.* (auto)                │
│  - content auto-retry loop      │   │   Existing: users, projects, orgs,  │
│  - heartbeat каждые 10с         │   │    quotas, usage, audit             │
│  - onFinish → save messages     │   └─────────────────────────────────────┘
│  - recordUsage (ALL branches)   │
│  - commit code (draft on !ok)   │   ┌─────────────────────────────────────┐
└────┬──────────────┬─────────────┘   │  Gitea (existing)                   │
     │              │ docker API      │  ТОЛЬКО код (adorable-src)          │
     │              ▼                  │  meta-репо упразднено               │
     │       ┌──────────────────────┐ └─────────────────────────────────────┘
     │       │ Docker sandbox/proj  │
     │       │ tmpfs /workspace     │ ┌───────────────────────────────────────┐
     │       │ (жив по idle-TTL 30м)│ │  REAPER (NEW)                         │
     │       └──────────────────────┘ │  - tick каждые 30с (advisory-lock)    │
     │                                 │  - status=running & heartbeat stale → │
     │ HTTP (external)                 │    КОММИТ sandbox в draft + fail +    │
     ▼                                 │    recordUsage(частичн.) + clear      │
┌─────────────────────────────┐       └───────────────────────────────────────┘
│  External: Brave / Jina /   │
│  LLM (GLM-5.1 и др.)        │
└─────────────────────────────┘
```

**Ключевые архитектурные правила:**
- Next.js, Worker, Reaper общаются через **Postgres** (durable state) и **Redis** (эфемерный транспорт стрима).
- Postgres = источник правды для статуса/метаданных/транскрипта. Redis = только живые байты стрима с TTL. Gitea = только код.
- Воркер — **publisher** в Redis (с явным дренажом стрима, не no-op waitUntil); Next.js — **subscriber** и для bridge (live первый ход), и для GET (reconnect).
- **⚠ Допущение, проверяемое в Phase 0:** `resumable-stream` корректно работает как кросс-процессный pub/sub (publisher в воркере, subscriber в Next). Если нет — fallback на свой Redis Streams pub/sub.

---

## 2. Стек: что добавляется

| Компонент | Статус | Назначение |
|---|---|---|
| Redis | **НОВОЕ** | `resumable-stream` storage (байты UIMessage-стрима, TTL). Один инстанс в docker-compose. |
| `resumable-stream` (npm) | **НОВОЕ** | publisher/subscriber поверх Redis для resumable стримов. |
| pg-boss | **НОВОЕ** | очередь задач поверх существующего Postgres. |
| `@ai-sdk/react` `useChat` | используется иначе | теперь с `resume: true`, без кастомного reducer. |
| Postgres 16 | существует | + новые таблицы. |
| Gitea | существует | сужается до кода. |
| Docker sandbox + `vm` | существует | без изменений интерфейса. |
| Better Auth + Drizzle | существует | + новые таблицы в схеме. |

**Redis в docker-compose:**
```yaml
services:
  redis:                            # НОВОЕ
    image: redis:7-alpine
    # КРИТИЧНО: НЕ allkeys-lru — LRU выселит ЖИВОЙ стрим под нагрузкой
    # (подписчик получит обрезанный стрим, воркер пишет в выселенный ключ → подвисание).
    # noeviction: при достижении лимита новые записи падают с ошибкой (видимо, лечимо),
    # а не молча портят активные стримы. TTL на ключах стримов чистит завершённые.
    command: redis-server --maxmemory 1gb --maxmemory-policy noeviction --appendonly yes --appendfsync everysec
    restart: unless-stopped
    volumes:
      - redis-data:/data           # AOF everysec — переживает рестарт, минимум потерь
```

**Замечание про durability Redis (уточнено по ревью v2 §7).** Redis теперь — **критичная зависимость доступности**: при его флапе все in-flight runs теряют живой стрим. Поэтому:
- `appendonly yes` + `appendfsync everysec` — переживает рестарт с потерей ≤1с.
- `noeviction` — лучше явная ошибка записи (которую воркер залогирует и переведёт run в failed), чем тихая порча активного стрима.
- Размер `maxmemory` — по нагрузке: оценить как (средний размер стрима) × (пик одновременных runs) × запас 2–3×.
- Всё равно: при полной потере Redis активные runs → reaper переведёт в `failed` с draft-commit (§7), транскрипт завершённых не страдает (он в Postgres). Это осознанно принятый уровень.

### 2.1 Полный инвентарь сервисов (для docker-compose / Kamal)

Решение по воркеру/риперу: **pg-boss + OpenTelemetry, без durable-фреймворка** (Trigger.dev/Hatchet). Причины: (1) on-prem/суверенный деплой — каждый лишний сервис усложняет установку и сертификацию в закрытом контуре заказчика; pg-boss живёт внутри уже стоящего Postgres, ноль новой инфраструктуры; (2) durable-модель готовых фреймворков построена на «переисполнить шаг до успеха» — конфликтует с нашим fail-fast; (3) наблюдаемость дешевле решается OTel-трейсингом, который Vercel AI SDK пишет нативно.

| Сервис | Роль | Образ/база | Новый? | Реплики | Зависимости |
|---|---|---|---|---|---|
| `app` | Next.js (thin API + фронт) | `node:22-alpine` | существует | 1–N | postgres, redis |
| `worker` | agent loop, publisher стрима | `node:22-alpine` (Dockerfile.worker) | **НОВЫЙ** | 2+ (scale) | postgres, redis, docker.sock |
| `reaper` | sweep застрявших runs | тот же образ, др. command | **НОВЫЙ** | ровно 1 (advisory-lock) | postgres, redis, docker.sock |
| `postgres` | durable state + pg-boss + транскрипт | `postgres:16-alpine` | существует | 1 | — |
| `redis` | транспорт стрима (resumable-stream) | `redis:7-alpine` | **НОВЫЙ** | 1 | — |
| `gitea` | код проектов (только код) | существует | существует | 1 | — |
| `jaeger` (или Tempo) | приём OTel-трейсов, дебаг loop | `jaegertracing/all-in-one` | **НОВЫЙ (observability)** | 1 | — |

Sandbox-контейнеры юзерских проектов создаёт `worker`/`reaper` через `dockerode` (mount `docker.sock`) — это не сервис compose, а динамические контейнеры.

### 2.2 Стек воркера и рипера (детально)

Воркер и reaper — **один Docker-образ** (`Dockerfile.worker`), разный `command` (`worker/index.js` vs `reaper/index.js`). Оба — обычные Node-процессы, **без веб-фреймворка** (это consumer очереди, не HTTP-сервер).

| Библиотека | Назначение | Примечание |
|---|---|---|
| Node 22 LTS | рантайм | не Bun на старте (риск несовместимости долгоживущих либ) |
| `pg-boss` | очередь задач | поверх существующего Postgres; lifecycle, `retryLimit:0`, `boss.cancel`, graceful stop |
| `ai` (Vercel AI SDK) | agent loop, `streamText`, `toUIMessageStream` | model-agnostic; `experimental_telemetry` → OTel |
| `resumable-stream` | публикация UIMessage-стрима в Redis | publisher; механизм дренажа — предмет Phase 0 |
| `drizzle-orm` + `postgres.js` | доступ к БД | переиспользуются из `app`; 3 пула — см. ниже |
| `dockerode` | управление sandbox-контейнерами | существующие адаптеры (`sandbox-docker.ts`) |
| `@opentelemetry/sdk-node` + exporter | трейсинг шагов agent loop | приём в Jaeger/Tempo; основной инструмент дебага |
| `pino` | структурные логи (JSON) | `runId`/`projectId`/`userId` в каждой строке |
| `zod` | схемы tool-параметров | уже в проекте |

**Health-check (без фреймворка):** крошечный `http.createServer` на один эндпоинт `/health` (порт 8080) — для Docker `healthcheck`/k8s liveness. Возвращает 200, если `boss` запущен.

**Три пула к Postgres (НЕ один):**
1. Drizzle pool (`max:10`) — обычные запросы.
2. pg-boss — свой внутренний пул.
3. LISTEN-пул — отдельное `postgres.js` подключение для bridge-сигнала `run-stream-ready:{runId}` и прочих NOTIFY (LISTEN держит коннект в режиме listening).

**Graceful shutdown:** `SIGTERM` → `boss.stop({ graceful: true, timeout: 60_000 })` → дать активным runs дойти до heartbeat-чекпоинта, затем закрыть пулы и OTel-flush.

### 2.3 Наблюдаемость и дебаг

- **OpenTelemetry трейсинг** — главный инструмент. `streamText({ experimental_telemetry: { isEnabled: true, functionId: 'run:'+runId } })` даёт span на каждый шаг loop (LLM-вызов, tool-call, tool-result) с таймингами и токенами. Смотришь в Jaeger/Tempo — видно весь agent loop по шагам, где завис, что упало.
- **pino-логи** — структурные, с `runId` в каждой строке; агрегатор (Loki/любой) опционально.
- **Свой мини-dashboard «активные runs»** — одна страница в `app`, читает таблицу `runs` (статус, heartbeat, stepCount, длительность). Добавляется в Phase 7, не на старте.
- **pg-boss мониторинг** — SQL-запросы к `pgboss.job` (глубина очереди, failed) либо Bull-Board-аналог позже.

---

## 3. Изменения в БД (Postgres + Drizzle)

### 3.1 `runs`

```typescript
// lib/db/schema/runs.ts
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),

  userId: uuid("user_id").notNull().references(() => users.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id),

  status: text("status", {
    enum: ["queued", "running", "cancelling", "reaping", "completed", "failed", "cancelled"]
  }).notNull().default("queued"),

  // Связь с активным Redis-стримом (для resume/bridge/stop). NULL когда стрим неактивен.
  activeStreamId: text("active_stream_id"),

  // ID pg-boss джобы — чтобы stop мог boss.cancel(jobId) (закрытие ревью v2 §4).
  // Сохраняется из результата boss.send в POST /api/chat.
  jobId: text("job_id"),

  prompt: text("prompt").notNull(),
  modelKey: text("model_key").notNull(),

  // Heartbeat для reaper: воркер обновляет каждые 10с, пока run жив.
  // Liveness определяется ТОЛЬКО heartbeat-ом, НЕ job-expiration (ревью v2 §6).
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),

  errorCode: text("error_code"),
  errorMessage: text("error_message"),

  tokenUsage: jsonb("token_usage").$type<{
    inputTokens: number; outputTokens: number; cachedInputTokens?: number;
  }>(),
  stepCount: integer("step_count").notNull().default(0),
});
// Индексы: (userId, createdAt desc); (conversationId, createdAt);
//          partial (status, heartbeatAt) where status in ('queued','running') — для reaper
```

### 3.2 `conversations` и `messages` (НОВЫЕ — транскрипт переезжает из Gitea)

```typescript
// lib/db/schema/conversations.ts
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// lib/db/schema/messages.ts
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => runs.id), // для assistant-сообщений; null для user
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),

  // ПОЛНЫЙ UIMessage с parts (text + tool-call + tool-result + reasoning).
  // Это то, что отдаёт onFinish от toUIMessageStreamResponse. НЕ плоский текст.
  uiMessage: jsonb("ui_message").$type<UIMessage>().notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byConversation: index("messages_conv_idx").on(t.conversationId, t.createdAt),
  // Идемпотентность assistant-сообщения (закрытие ревью v2 §8): один run →
  // максимум одно assistant-сообщение. stop-snapshot и onFinish используют
  // upsert по этому ключу, а не два независимых insert.
  uniqAssistantPerRun: uniqueIndex("messages_run_assistant_uniq")
    .on(t.runId).where(sql`role = 'assistant'`),
}));
```

**Почему `uiMessage` целиком в jsonb.** SDK `onFinish` отдаёт массив `UIMessage` с готовыми `parts`. Храня их as-is, мы (1) не теряем tool-историю, (2) скармливаем модели на следующем ходу её же tool-calls (`convertToModelMessages`), (3) на фронте отдаём `useChat` `initialMessages` в нативном формате без конверсий. Это и есть закрытие ревью §5.

**Допущение uniq-индекса (ревью v2.1, мелочь).** Уникальный индекс `(runId) WHERE role='assistant'` предполагает **ровно одно** assistant-сообщение на run. Для многошагового агента AI SDK так и есть — один `UIMessage` с множеством parts (text + все tool-call/tool-result). Если когда-нибудь появится >1 assistant-сообщения на run — индекс и upsert надо пересмотреть (иначе upsert затрёт все, кроме одного). На текущей модели SDK это безопасно.

**Precedence stop-snapshot vs onFinish (ревью v2.1, мелочь).** При cancel оба пути пишут assistant-сообщение по одному `runId`. Авторитетный — **воркерский `onFinish`** (полный partial от SDK), а не фронтовый снапшот: `upsertAssistantMessages` (воркер) выполняется в `finally` и перезаписывает то, что мог положить stop-эндпоинт. Фронтовый снапшот — лишь страховка на случай, если воркер не успел зафиксировать.

### 3.3 Миграция транскрипта из Gitea

Разовый скрипт: для каждого проекта прочитать `adorable-meta-{uuid}` репо (старый `UIMessage[]` JSON), создать `conversations` + `messages` строки, затем пометить meta-репо как legacy. После миграции `repo-storage.ts: readConversationMessages/saveConversationMessages` переписываются на Postgres. Meta-репо больше не создаётся при `POST /api/repos`.

### 3.4 Изменения в существующих
- `projects` — `currentRunId uuid` nullable (активный run проекта). Поддерживается **в `finalizeRunCAS`/`transitionRun`** (явный UPDATE, не триггер): при queued→running ставится, при терминальном статусе — NULL. Явный UPDATE предпочтён триггеру для прозрачности в коде воркера.
- Quotas/usage таблицы — без изменений схемы, меняется только **когда** пишем (см. §5).

---

## 4. API Layer (Next.js, thin)

### 4.1 `POST /api/chat` — server-side bridge (live-стрим первого хода)

**Главное изменение v2.1 (закрытие ревью v2 §2).** POST НЕ возвращает JSON `{runId}`. Он возвращает **сам UIMessage-стрим**, подписавшись на Redis-стрим воркера. Так `useChat`+`DefaultChatTransport` получает живой стрим из ответа на send (как и ожидает), а `GET /:id/stream` нужен только для reconnect.

```typescript
// app/api/chat/route.ts
import { createResumableStreamContext } from "resumable-stream";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { after } from "next/server";

export const POST = protectedRoute(async ({ req, session }) => {
  requireEmailVerified(session);
  const { id: conversationId, message, projectId, modelKey } = await req.json();

  const project = await loadProjectForUser(projectId, session.user.id);
  if (!project) return new Response("Not found", { status: 404 });

  // QUOTA: резервация, не просто чтение (закрытие ревью v2 §9).
  // ESTIMATED_TURN_TOKENS сайзится под РЕАЛИСТИЧНЫЙ МАКСИМУМ многошагового run-а
  // (≈ MAX_TOTAL_STEPS × средний контекст шага), НЕ под средний ход (ревью v2.1-2 §4),
  // иначе overshoot actual−estimate у лимита не ограничен и квота декоративна.
  // Reconcile фактического в recordUsage возвращает неизрасходованный резерв.
  const reservation = await reserveQuota({
    userId: session.user.id, organizationId: project.organizationId,
    estimatedTokens: ESTIMATED_TURN_TOKENS,
  });
  if (!reservation.ok) return Response.json({ error: "quota_exceeded" }, { status: 429 });

  const conversation = await ensureConversation(conversationId, project, session.user.id);
  await db.insert(messages).values({
    conversationId: conversation.id, role: "user", uiMessage: message,
  });

  const [run] = await db.insert(runs).values({
    userId: session.user.id, organizationId: project.organizationId,
    projectId: project.id, conversationId: conversation.id,
    status: "queued", prompt: extractText(message),
    modelKey: modelKey ?? DEFAULT_MODEL_KEY,
  }).returning();

  // enqueue + СОХРАНИТЬ jobId (закрытие ревью v2 §4)
  const jobId = await boss.send("agent-run", {
    runId: run.id, userId: session.user.id,
    organizationId: project.organizationId, projectId: project.id,
    conversationId: conversation.id, modelKey: run.modelKey,
    reservationId: reservation.id,
  }, {
    retryLimit: 0,                  // fail-fast: повтора джобы нет
    // expire НЕ привязан к длительности run-а (ревью v2 §6): ставим заведомо большой,
    // liveness определяет heartbeat+reaper, не job-expiration.
    expireInHours: 24,
    // singletonKey УБРАН (ревью v2 §5): вместо него explicit-check ниже,
    // чтобы отменённый-но-ещё-active job не блокировал re-enqueue.
  });
  await db.update(runs).set({ jobId }).where(eq(runs.id, run.id));

  // BRIDGE: дождаться, пока воркер опубликует стрим (выставит activeStreamId),
  // затем подписаться на него и вернуть клиенту.
  const streamId = await waitForActiveStream(run.id, { timeoutMs: 20_000 });
  if (!streamId) {
    // воркер не стартовал за таймаут — вернуть управляемую ошибку,
    // фронт покажет «не удалось начать», run подхватит reaper.
    return Response.json({ error: "stream_start_timeout", runId: run.id }, { status: 504 });
  }

  const ctx = createResumableStreamContext({ waitUntil: after });
  return new Response(
    await ctx.resumeExistingStream(streamId),
    { headers: UI_MESSAGE_STREAM_HEADERS },
  );
});
```

**`waitForActiveStream`** — Postgres LISTEN на канал `run-stream-ready:{runId}`, который воркер шлёт сразу после `setActiveStream` (поллинг как fallback). Поскольку воркер теперь публикует стрим **до** тяжёлой гидрации (§5.2, закрытие ревью v2.1 §2), bridge цепляется за <1с. Таймаут оставляем 20с как страховку на случай, что воркер вообще не подхватил job (нет свободного воркера) — но это уже НЕ про холодный старт.

**Таймаут bridge ≠ провал run-а.** Если 504 всё же случился (воркер не стартовал за 20с), фронт должен трактовать это как «переподключусь», а НЕ «run провалился»: показать «подключаюсь…» и поллить `GET /api/chat/:id` + `GET /:id/stream`. Run при этом либо ещё стартует (reaper его не трогает, heartbeat пойдёт), либо осиротел (reaper доведёт до failed). Фронт не должен показывать ошибку и провоцировать повторный POST — иначе дубль (см. ревью v2.1 §2).

**Атомарность «один активный run на проект»** (закрытие ревью v2.1 §4). НЕ racy explicit-check, а **partial unique index на уровне БД**:
```sql
CREATE UNIQUE INDEX one_active_run_per_project
  ON runs (project_id) WHERE status IN ('queued','running','cancelling','reaping');
```
Тогда два одновременных POST по одному проекту: первый INSERT проходит, второй падает на unique violation → ловим, возвращаем 409. Никакой TOCTOU-гонки. Re-enqueue после cancel работает, потому что cancel быстро уводит run в `cancelled` (вне предиката индекса), разблокируя вставку. Это надёжнее singleton, который выкинут не зря, а потому что освобождение его ключа зависело от нерабочего `boss.cancel` (теперь починен, но БД-индекс всё равно атомарнее).

**Окно `activeStreamId=null`**: bridge ждёт появления стрима (а он теперь рано), поэтому окна для первого хода нет. Для reconnect-GET — 204+`Retry-After` (см. §4.2).

### 4.2 `GET /api/chat/:id/stream` — resume (по доке AI SDK)

```typescript
// app/api/chat/[id]/stream/route.ts
import { createResumableStreamContext } from "resumable-stream";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { after } from "next/server";

export const GET = protectedRoute(async ({ session, params }) => {
  const run = await loadLatestRunForConversation(params.id, session.user.id);

  // Нет активного стрима, но run ещё живой → попроси ретрай (ревью v2, мелочь про 204).
  // Окно между enqueue и setActiveStream: фронт повторит resume, не сочтёт «пусто».
  if (run && ["queued", "running"].includes(run.status) && run.activeStreamId == null) {
    return new Response(null, { status: 204, headers: { "Retry-After": "1" } });
  }
  if (!run || run.activeStreamId == null) {
    return new Response(null, { status: 204 }); // терминальный/нет стрима — грузи из Postgres
  }

  const ctx = createResumableStreamContext({ waitUntil: after });
  return new Response(
    await ctx.resumeExistingStream(run.activeStreamId),
    { headers: UI_MESSAGE_STREAM_HEADERS },
  );
});
```

Это subscriber к Redis-стриму, который **публикует воркер**. Гонки backlog/live (ревью §3) тут нет — `resumable-stream` решает это внутри себя.

### 4.3 `POST /api/chat/:id/stop` — явная остановка (по доке + наша интеграция с pg-boss)

```typescript
// app/api/chat/[id]/stop/route.ts
export const POST = protectedRoute(async ({ req, session, params }) => {
  const run = await loadLatestRunForConversation(params.id, session.user.id);
  if (!run) return new Response("Not found", { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Игнорировать устаревший stop (пришёл после старта нового стрима)
  if (body.activeStreamId && run.activeStreamId && body.activeStreamId !== run.activeStreamId) {
    return Response.json({ success: true });
  }

  // 1. Persist частичный assistant-снапшот, если фронт прислал
  if (body.assistantMessage) {
    await upsertMessage({ conversationId: run.conversationId, runId: run.id,
      role: "assistant", uiMessage: body.assistantMessage });
  }

  // 2. РАЗВЕТВЛЕНИЕ ПО СТАТУСУ (закрытие ревью v2.1-2 §1 — дедлок cancelling).
  if (run.jobId) await boss.cancel(run.jobId).catch(() => {});  // снять джобу, если ещё queued

  // CAS queued → cancelled НАПРЯМУЮ: воркер эту джобу уже не подберёт
  // (boss.cancel её удалил), значит некому довести cancelling→cancelled.
  // Поэтому финализируем сразу здесь, освобождая проект из unique-индекса.
  const finalizedQueued = await finalizeRunCAS(run.id, {
    expectStatusIn: ["queued"], status: "cancelled", finishedAt: new Date(),
  });
  if (finalizedQueued) {
    await releaseReservation(run.id).catch(() => {});  // вернуть резерв квоты
    await clearCancelFlag(run.id);
    await clearActiveStreamIfMatches(run.id, run.activeStreamId);
    return Response.json({ success: true });
  }

  // Иначе run уже running (или гонка): ставим cancelling + cancel-флаг,
  // воркер увидит флаг на следующей итерации loop (≤5с) и сам финализирует.
  await finalizeRunCAS(run.id, { expectStatusIn: ["running"], status: "cancelling" });
  await setCancelFlag(run.id);            // Redis cancel:{runId}=1, TTL
  await clearActiveStreamIfMatches(run.id, run.activeStreamId);

  return Response.json({ success: true });
});
```

**Queued-cancel — без дедлока (закрытие ревью v2.1-2 §1).** Ключевая развилка: если run ещё `queued`, `boss.cancel` удаляет джобу из очереди — воркер её **никогда не подберёт**, поэтому `cancelling → cancelled` некому довести. Значит queued-путь финализируем **сразу в `cancelled`** прямо в `/stop`, освобождая проект из `one_active_run_per_project`. Статус `cancelling` остаётся только для уже-`running` (его доводит воркер по cancel-флагу). Reaper дополнительно подметает stale `cancelling` (§7) — на случай гонки.

**Важно (из доки):** stop-эндпоинт **не вызывается** из cleanup-кода роута/навигации — только по явному нажатию кнопки. Закрытие вкладки = disconnect, стрим остаётся резюмируемым.

### 4.4 `GET /api/chat/:id`

Возвращает метаданные последнего run + историю `messages` для гидрации `useChat` `initialMessages`. Фронт по `run.status` решает: если `running` — `useChat({ resume: true })` сам подключится к стриму; если терминальный — просто покажет историю.

---

## 5. Agent Worker

### 5.1 Запуск (docker-compose)

Воркер и reaper — один образ (`Dockerfile.worker`), разный `command`. Reaper в единственном экземпляре (advisory-lock страхует даже при случайном дубле).

```yaml
  worker:                              # НОВОЕ
    build: { context: ., dockerfile: Dockerfile.worker }
    command: ["node", "dist/worker/index.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}          # НОВОЕ
      GITEA_URL: ${GITEA_URL}
      GITEA_TOKEN: ${GITEA_TOKEN}
      DOCKER_HOST: unix:///var/run/docker.sock
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4318   # трейсы agent loop
      OTEL_SERVICE_NAME: platform-worker
    volumes: [ /var/run/docker.sock:/var/run/docker.sock ]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 15s
      timeout: 3s
      retries: 3
    depends_on: [ postgres, redis ]
    deploy: { replicas: 2 }            # scale воркеров

  reaper:                              # НОВОЕ (тот же образ)
    build: { context: ., dockerfile: Dockerfile.worker }
    command: ["node", "dist/reaper/index.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      GITEA_URL: ${GITEA_URL}
      GITEA_TOKEN: ${GITEA_TOKEN}
      DOCKER_HOST: unix:///var/run/docker.sock
      OTEL_SERVICE_NAME: platform-reaper
    volumes: [ /var/run/docker.sock:/var/run/docker.sock ]
    restart: unless-stopped
    depends_on: [ postgres, redis ]
    deploy: { replicas: 1 }            # ровно один

  jaeger:                              # НОВОЕ (observability)
    image: jaegertracing/all-in-one:latest
    environment: { COLLECTOR_OTLP_ENABLED: "true" }
    ports: [ "16686:16686" ]           # UI трейсов
    restart: unless-stopped
```
Масштабирование воркеров: `docker compose up --scale worker=3` (или `deploy.replicas`). Reaper не масштабируется.

### 5.2 Handler одного run-а

```typescript
// worker/handle-agent-run.ts
import { createResumableStreamContext } from "resumable-stream";

export async function handleAgentRun(data: AgentRunJob, ctx: { jobId: string }) {
  const { runId, userId, organizationId, projectId, conversationId, modelKey } = data;

  // 0. Если уже отменён в очереди — финализировать ПОЛНОСТЮ (закрытие ревью v2.1-2 §2).
  //    Через CAS, и с release резерва + clear, иначе резервация квоты течёт.
  if (await hasCancelFlag(runId)) {
    const ok = await finalizeRunCAS(runId, {
      expectStatusIn: ["queued", "cancelling"], status: "cancelled", finishedAt: new Date(),
    });
    if (ok) {
      await recordUsage({ userId, organizationId, projectId, runId,
        usage: ZERO_USAGE, reservationId: data.reservationId });
      await clearCancelFlag(runId);
      await clearActiveStream(runId);
    }
    return;
  }

  // 1. Re-check user status (snapshot мог устареть)
  await ensureUserActive(userId);

  // 2. queued → running (атомарно; если не queued — выйти молча)
  const run = await transitionRun(runId, "queued", "running", { startedAt: new Date() });
  if (!run) return;

  // 3. Heartbeat для reaper (§7)
  const heartbeat = setInterval(() => void touchHeartbeat(runId), 10_000);

  // 4. Cancel-флаг: опрос в loop + AbortController
  const abort = new AbortController();
  const cancelPoll = setInterval(async () => {
    if (await hasCancelFlag(runId)) abort.abort(new Error("cancelled-by-user"));
    if (!(await isUserStillActive(userId))) abort.abort(new Error("user-status-changed"));
  }, 5_000);

  let vm: Vm | undefined;
  let finalMessages: UIMessage[] | undefined;
  let usage: TokenUsage | undefined;
  let terminal: "completed" | "failed" | "cancelled" = "failed";

  try {
    // 5. РАННЯЯ ПУБЛИКАЦИЯ СТРИМА — ДО тяжёлой гидрации (закрытие ревью v2.1 §2).
    //    Bridge (§4.1) цепляется за <1с, а холодный старт sandbox (git clone +
    //    npm install, легко >20с) идёт уже ВНУТРИ стрима как progress-парты.
    //    Так нет 20-секундного окна гонки и «призрачных успехов».
    const streamId = generateId();
    const streamCtx = createResumableStreamContext({ waitUntil: workerWaitUntil });

    // Композитный источник: сначала warmup-парты (холодный старт), затем
    // переключение на реальный uiStream от streamText. Реализуется как
    // склейка двух ReadableStream (warmup → llm) в один UIMessage-стрим.
    const { stream: outboundStream, pushWarmup, switchToLlm } = createComposedUiStream();

    // Публикуем СРАЗУ и сигналим bridge — до hydration.
    await setActiveStream(runId, streamId);    // UPDATE runs.activeStreamId
    await notifyStreamReady(runId);            // LISTEN-сигнал для bridge (§4.1)
    const published = streamCtx.createNewResumableStream(streamId, () => outboundStream);

    // 6. Тяжёлая гидрация — теперь с прогрессом в стрим (юзер видит «warming up»)
    pushWarmup({ type: "data-progress", data: { stage: "sandbox", message: "Готовлю окружение…" } });
    vm = await resolveProjectSandbox({ projectId, userId });
    pushWarmup({ type: "data-progress", data: { stage: "hydrate", message: "Загружаю проект…" } });
    await vm.ensureHydrated();                  // git clone + npm install (может быть >20с)

    // 7. Tools (существующий create-tools, + внешние + validation)
    const retryState = createRetryState();
    const tools = createTools(vm, { sourceRepoId: run.project.sourceRepoId });
    tools.validate = buildValidationTool(vm, retryState);
    tools.webSearch = createWebSearchTool({ apiKey: process.env.BRAVE_API_KEY! });
    tools.webFetch = createWebFetchTool({ apiKey: process.env.JINA_API_KEY! });

    // 8. История из Postgres (полные UIMessage с tool-parts)
    const history = await loadConversationUIMessages(conversationId);

    // 9. streamText
    const result = streamText({
      model: resolveModel(modelKey),
      system: buildSystemPrompt({ projectKind: "vite-react-ts" }),
      messages: convertToModelMessages(history),
      tools,
      stopWhen: stepCountIs(MAX_TOTAL_STEPS),   // единственный лимит шагов (ревью §9)
      abortSignal: abort.signal,
    });

    // 10. Переключаем композитный стрим на вывод LLM
    const uiStream = result.toUIMessageStream({
      originalMessages: history,
      onFinish: ({ messages }) => { finalMessages = messages; }, // ПОЛНЫЙ UIMessage[]
    });
    switchToLlm(uiStream);

    // 11. Явный дренаж: дожидаемся, пока весь стрим уедет в Redis.
    //     workerWaitUntil НЕ no-op (закрытие ревью v2 §1) — реальный pump,
    //     иначе публикация оборвётся / result.usage повиснет.
    //     Точный механизм дренажа — предмет Phase 0 спайка.
    await drainToCompletion(published);

    usage = await result.usage;                // теперь не повиснет — источник вычитан
    void retryState.budgetExhausted;
    // При budget-exhausted НЕ абортим (ревью §9): модель уже доиграла finish-шаг
    // с объяснением (validate-tool перестал кормить ошибки) — стрим завершился штатно.

    terminal = "completed";
  } catch (err) {
    terminal = classifyTerminal(err); // cancelled | failed
    usage = usage ?? (await safeUsage(result));   // частичный usage даже при abort (может быть undefined)
  } finally {
    // ВАЖНО (закрытие ревью v2.1 §3): heartbeat держим ЖИВЫМ до конца финализации,
    // иначе медленный commit/push (>STALE_MS) → reaper решит, что run осиротел,
    // и параллельно сделает draft-commit + release + status=failed, пока handler
    // финализирует completed. Гасим интервал ПОСЛЕ finalizeRun.
    clearInterval(cancelPoll);

    // 12. Транскрипт — идемпотентно по runId (закрытие ревью v2 §8): upsert.
    if (finalMessages?.length) {
      await upsertAssistantMessages(conversationId, runId, finalMessages);
    }

    // 13. Коммит КОДА. completed → main; cancel/fail → draft-ветка (ревью §14).
    //     При hard-crash этот finally НЕ выполнится — draft-commit делает REAPER (§7).
    if (vm) {
      const branch = terminal === "completed" ? "main" : `draft/run-${runId.slice(0, 8)}`;
      await autoCommitWorkspace(vm, run.project, {
        branch, message: `${terminal}: run ${runId.slice(0, 8)}`,
      }).catch((e) => logger.warn("commit failed", e));
    }

    // 14. usage + reconcile резервации во ВСЕХ ветках (ревью §7, v2 §9).
    //     usage может быть undefined (abort до первого токена) → 0 фактических +
    //     полный release. recordUsage идемпотентен по runId (handler vs reaper).
    await recordUsage({
      userId, organizationId, projectId, runId,
      usage: usage ?? ZERO_USAGE,
      reservationId: data.reservationId,        // reconcile: фактический vs зарезервировано
    });

    // 15. Финализация через CAS (закрытие ревью v2.1 §3): только если ещё running/cancelling.
    //     Если reaper уже опередил (status=failed) — наш UPDATE затронет 0 строк, no-op,
    //     статус не флипается completed↔failed.
    const steps = await safeSteps(result);      // (await result.steps).length
    const finalized = await finalizeRunCAS(runId, {
      expectStatusIn: ["running", "cancelling"],
      status: terminal, finishedAt: new Date(),
      tokenUsage: usage, stepCount: steps,
      errorMessage: terminal === "failed" ? lastError(err) : undefined,
    });
    if (finalized) {
      await clearActiveStream(runId);
      await clearCancelFlag(runId);
    }
    // Гасим heartbeat в самом конце — после того как статус терминальный.
    clearInterval(heartbeat);
  }
  // НЕ throw — retryLimit:0, повтор не нужен (fail-fast).
}
```

**Про `hasStreamedContent` (удалено из v2.1).** В v2.0 была колонка-маркер «контент пошёл». Ревью верно заметило: reaper всё равно всегда ставит `failed` (retryLimit:0, пути воскрешения нет), значит колонка мёртвая. Удалена. fail-fast реализован проще — отсутствием retry.

### 5.3 Что забрал на себя SDK (и чего больше нет в нашем коде)
- **Batching, порядок, backpressure стрима** — внутри `resumable-stream`/`toUIMessageStream`.
- **Реконструкция UIMessage с tool-parts** — `onFinish` отдаёт готовое.
- **Resume после reconnect** — `useChat({ resume })` + GET endpoint.

### 5.4 Cancel внутри loop
Воркер опрашивает Redis cancel-флаг каждые 5с и абортит `streamText` через `AbortController`. Долгие tools получают `abort.signal` (Vercel AI SDK прокидывает в `execute`). Это согласовано с тем, что stop-эндпоинт (§4.3) ставит флаг.

---

## 6. Fail-fast, heartbeat и lifecycle джобы (закрытие ревью §1, §6)

**Политика повторов:**
- `retryLimit: 0` — pg-boss не переисполняет джобу. Никогда не склеиваем две недетерминированные генерации.
- Если воркер упал в середине → джоба в pg-boss завершается, но **статус run остаётся `running`** → это ловит reaper (§7), который доводит до `failed` и коммитит наработку в draft.
- Нет колонки-маркера. fail-fast реализован просто отсутствием retry, а не флагом (колонка `hasStreamedContent` из v2.0 удалена — путь «воскрешения» отсутствует в принципе).

**Liveness = heartbeat + reaper, НЕ job-expiration (закрытие ревью §6 + v2 §6):**
- `expireInHours: 24` на джобе — заведомо большой грубый потолок, НЕ привязан к реальной длительности run-а. Он не используется как сигнал liveness.
- Пока run жив, воркер каждые 10с обновляет `runs.heartbeatAt`.
- Reaper считает run осиротевшим, если `status='running'` и `heartbeatAt` старше `STALE_MS` (60с).
- Так устранено опасное взаимодействие expiration × двойное исполнение: повтора джобы нет (`retryLimit: 0`), а singleton заменён атомарным partial-unique-индексом (§4.1), поэтому двух воркеров на один проект не возникает.

---

## 7. Reaper застрявших runs (закрытие ревью §2 + v2 §3 + v2.1-2 §1,§5)

Отдельный периодический процесс (в worker-контейнере, `setInterval` с глобальным advisory-lock, чтобы при scale>1 работал один экземпляр).

**Reaper сметает ВСЕ не-терминальные застревания, не только `running`** (закрытие ревью v2.1-2 §1). Иначе инвариант «не теряем runs» дыряв для `cancelling`/`queued`, чья джоба потерялась, — а из-за partial-unique-индекса такой застрявший run **насмерть лочит проект**.

```typescript
// worker/reaper.ts
const STALE_MS = 60_000;

export async function reapStuck() {
  // A) running с протухшим heartbeat → осиротевший воркер (crash)
  const orphans = await db.select().from(runs).where(and(
    eq(runs.status, "running"),
    lt(runs.heartbeatAt, new Date(Date.now() - STALE_MS)),
  ));
  for (const run of orphans) await reapOne(run, "failed", "orphaned");

  // B) cancelling, которые никто не довёл (гонка queued-cancel) → cancelled
  const stuckCancelling = await db.select().from(runs).where(and(
    eq(runs.status, "cancelling"),
    lt(runs.heartbeatAt, new Date(Date.now() - STALE_MS)),  // или updatedAt, если heartbeat null
  ));
  for (const run of stuckCancelling) await reapOne(run, "cancelled", "stuck-cancelling");

  // C) queued, чья pg-boss джоба потерялась (нет в очереди, не стартовала) → failed
  const stuckQueued = await db.select().from(runs).where(and(
    eq(runs.status, "queued"),
    lt(runs.createdAt, new Date(Date.now() - STALE_MS * 3)),  // более щедрый порог
  ));
  for (const run of stuckQueued) {
    if (!(await jobExistsInQueue(run.jobId))) await reapOne(run, "failed", "lost-job");
  }
}

async function reapOne(run: Run, terminal: "failed" | "cancelled", code: string) {
  // CAS running→reaping ПЕРЕД git-операциями (закрытие ревью v2.1-2 §5):
  // забираем эксклюзивное право на этот run, чтобы не пересечься с живым
  // handler-commit на том же sandbox. Если CAS не прошёл — handler жив, пропускаем.
  const claimed = await finalizeRunCAS(run.id, {
    expectStatusIn: [run.status], status: "reaping",
  });
  if (!claimed) return;  // кто-то опередил (живой handler/другой reaper) — no-op

  // Спасти наработку (только для crash-кейса; для cancelled код уже в draft из handler)
  if (terminal === "failed") {
    try {
      const vm = await tryAttachExistingSandbox(run.projectId); // НЕ создавать новый
      if (vm) await autoCommitWorkspace(vm, await loadProject(run.projectId), {
        branch: `draft/run-${run.id.slice(0, 8)}`,
        message: `${code}: run ${run.id.slice(0, 8)}`,
      });
    } catch (e) { logger.warn("reaper draft-commit failed", { runId: run.id, e }); }
  }

  // Терминальный статус (reaping → terminal — всегда проходит, мы владелец)
  await finalizeRunCAS(run.id, {
    expectStatusIn: ["reaping"], status: terminal, finishedAt: new Date(),
    errorCode: terminal === "failed" ? code : undefined,
    errorMessage: terminal === "failed" ? "Reaped: " + code : undefined,
  });

  await releaseReservation(run.id).catch(() => {});  // идемпотентно по runId
  await clearActiveStream(run.id);
  await clearCancelFlag(run.id);
}
// Запуск: setInterval(reapStuck, 30_000) с pg_try_advisory_lock.
```

**Новый промежуточный статус `reaping`** добавлен в enum `runs.status` (§3.1) и в предикат unique-индекса (§4.1), чтобы проект оставался занят на время reap-операции и не было гонки за sandbox. Он терминализируется в том же тике.

Это гарантия инварианта: **любой run из любого не-терминального статуса (`queued`/`running`/`cancelling`/`reaping`) приходит к терминальному**, проект не лочится навсегда, наработка не теряется даже при hard-crash, и нет конкурентного git-commit на один sandbox.

### 7.1 Сводная state-machine (источник правды по переходам)

Терминальные статусы: `completed`, `failed`, `cancelled`. Не-терминальные (входят в unique-индекс, занимают проект): `queued`, `running`, `cancelling`, `reaping`.

| Из | В | Кто | Через | Условие |
|---|---|---|---|---|
| — | `queued` | API POST | INSERT | unique-индекс не даёт второй активный на проект |
| `queued` | `running` | Worker | CAS | step-2 старта; если не `queued` — выход |
| `queued` | `cancelled` | API stop | CAS | если `boss.cancel` снял джобу (queued-путь) + release |
| `queued` | `cancelled` | Worker step-0 | CAS | cancel-флаг уже стоял к старту + release |
| `queued` | `failed` | Reaper | CAS→reaping→fail | джоба потеряна (нет в очереди), `lost-job` |
| `running` | `cancelling` | API stop | CAS | running-путь stop; воркер довершит |
| `running` | `completed` | Worker finally | CAS | стрим завершился штатно |
| `running` | `failed` | Worker finally | CAS | пойманная ошибка (не cancel) |
| `running` | `cancelled` | Worker finally | CAS | abort по cancel-флагу |
| `running` | `reaping`→`failed` | Reaper | CAS | heartbeat протух (crash); draft-commit наработки |
| `cancelling` | `cancelled` | Worker finally | CAS | abort долетел, штатное завершение |
| `cancelling` | `reaping`→`cancelled` | Reaper | CAS | застрял (heartbeat протух), `stuck-cancelling` |
| `reaping` | terminal | Reaper | CAS | владелец reap-операции, всегда проходит |

**Ключевые правила:**
- Все переходы — через `finalizeRunCAS(expectStatusIn, …)`: кто первым сменил статус, тот и владелец; остальные — no-op. Нет флипов и двойных операций.
- `reaping` — эксклюзивный lock на git-операции reaper-а: пока он держит `reaping`, живой handler уже не может (его CAS из `running`/`cancelling` не пройдёт).
- `releaseReservation` и `recordUsage` — идемпотентны по `runId` (повторный вызов из handler+reaper безопасен).
- Из каждого не-терминального состояния есть путь к терминальному — либо актором (worker/api), либо reaper-ом по таймауту. Проект не лочится навсегда никогда.

---

## 8. Content auto-retry / validation loop (уточнено по ревью §9)

Без изменений в идее (bounded feedback), но с правками:

1. **Один счётчик шагов.** `MAX_TOTAL_STEPS` = `stopWhen: stepCountIs(MAX_TOTAL_STEPS)`. Убран дублирующий `incrementStep` в validate. `runs.stepCount` пишется из `result` (фактические шаги SDK), а не из счётчика валидаций.
2. **Per-category retry budget** для эскалации контекста остаётся (3 попытки на категорию, дедуп по hash, эскалация контекста: ошибка → связанные файлы → «revert & rewrite»).
3. **Нет жёсткого abort при budget-exhausted (ревью §9).** При исчерпании бюджета validate-tool перестаёт возвращать ошибки и возвращает «budget exhausted, explain to user» — модель **доигрывает finish-шаг с объяснением**, не обрывается на полуслове.
4. Переименовано: это не «retry loop», а **bounded validation feedback** — отражено в названиях.

(Реализация RetryState, escalation builder, error parser — как в v1 §5, минус `incrementStep`.)

---

## 9. Model registry (без преждевременных абстракций — ревью «мелочи»)

```typescript
// lib/llm/registry.ts
export const DEFAULT_MODEL_KEY = "glm-5.1";

const MODELS = {
  "glm-5.1": { provider: "zai", modelId: /* реальный id из доки Z.ai, не плейсхолдер */ "<verify>",
    contextWindow: 128_000, costTier: "balanced" },
  // добавлять по мере надобности
} as const;

export function resolveModel(key: string) {
  const d = MODELS[key] ?? MODELS[DEFAULT_MODEL_KEY];
  switch (d.provider) {
    case "zai": return zai(d.modelId);
    // ...
  }
}
```
- `selectModelForTask` (plan/code/review) **не вводим в v1** — единственный `streamText`. YAGNI (ревью). Multi-step с разными моделями — phase 2, когда появится отдельный plan-шаг.
- `modelId` обязательно сверить с актуальной докой провайдера перед коммитом (не плейсхолдер).

---

## 10. Прочие решения

- **EventSource/auth.** Resume-GET идёт same-origin с cookie better-auth (EventSource не шлёт кастомные заголовки). Для self-hosted same-origin — ок. Зафиксировано явно.
- **Холодный старт sandbox (ревью §13).** Sticky-sandbox между последовательными runs одного проекта уже есть (cleanup по idle 30мин). Кэш node_modules-слоя — оптимизация phase 2.
- **Распухание данных (ревью §10).** Транскрипт теперь в Postgres `messages` (jsonb). Крупные tool-результаты (полное содержимое файла в args/result) — cap на размер part: если > N КБ, заменять тело на ссылку на git-объект. Применять **с первого дня**. **Но (ревью v2.1):** обрезать так, чтобы на следующем ходу модель не получила «висячий ref», который не развернуть. Правило: обрезаем только transient-результаты (stdout билда, длинные read), которые модели на след. ходу не нужны дословно; то, на что модель может ссылаться (содержимое файла, которое она писала), либо оставляем, либо заменяем на компактное «(файл X, N строк, см. текущее состояние через read_file)». Партиционирование `messages` — при росте (phase 2).
- **`pg_notify` vs `sql.raw`.** Где остаётся NOTIFY (cancel-сигнал, если используется) — через `pg_notify(channel, payload)` с параметрами, не интерполяция.
- **Multiple clients на один стрим.** `resumable-stream` поддерживает нескольких подписчиков на один стрим из коробки — две вкладки/устройства работают без нашего кода.

---

## 11. План миграции

### Phase 0: СПАЙК `resumable-stream` (БЛОКИРУЮЩИЙ, 1–2 дня)
**Блокирует Phase 3.** Phase 1–2 могут идти параллельно (от транспорта не зависят).
0a. Минимальный прототип: процесс-A (эмулирует воркер) вызывает `createNewResumableStream` и **явно дренит** стрим в Redis; процесс-B (эмулирует Next) вызывает `resumeExistingStream` и читает.
0b. Проверить: (1) данные реально уезжают в Redis без HTTP-клиента у publisher-а; (2) корректный механизм дренажа (что должно вычитать источник); (3) поведение `waitUntil` вне serverless — нужен ли реальный pump вместо no-op; (4) буферизуется ли стрим, если subscriber подключился ПОЗЖЕ начала публикации (критично для bridge с таймаутом); (5) точные имена/сигнатуры API в текущей версии пакета; (6) **`createComposedUiStream`: склейка warmup-партов (`data-progress`) + LLM-стрима в ОДИН протокол-валидный UIMessage-стрим** (закрытие ревью v2.1-2 §3) — нельзя конкатенировать два независимых UIMessage-стрима (у каждого свой start/finish-фрейминг); warmup должны быть transient `data-*` партами внутри одной message-обёртки, `switchToLlm` корректно встраивает LLM-парты.
0c. **Бинарный результат спайка:** `resumable-stream` подходит → Phase 3 как описано. НЕ подходит → **fallback: свой тонкий Redis Streams pub/sub** (XADD в воркере, XREAD blocking в bridge/GET; resume по last-id). Тогда §4 переписывается под него, но вся остальная архитектура (worker/reaper/schema) не меняется.

### Phase 1: инфраструктура (2–3 дня) — параллельно Phase 0
1. Redis в docker-compose (`noeviction`, AOF); Jaeger для OTel-трейсов.
2. Таблицы `runs` (с `jobId`, статусы `cancelling`/`reaping`), `conversations`, `messages` (uniq assistant per run); unique-индекс `one_active_run_per_project`.
3. Поднять pg-boss.
4. Структура кода: `worker/` как npm-workspace; общий код (schema, `create-tools`, `repo-storage`, llm-registry) — в `packages/shared` или импорт из `adorable`. `Dockerfile.worker` (multi-stage, `node:22-alpine`). Сервисы `worker` + `reaper` (один образ, разный command) + `/health` эндпоинт. pino + OTel-bootstrap.
5. Smoke: enqueue → worker логает job (видно в Jaeger span); reaper тикает под advisory-lock.

### Phase 2: транскрипт в Postgres (2–3 дня) — параллельно Phase 0
6. Переписать `repo-storage` conversation-функции на Postgres.
7. Разовый скрипт миграции из `adorable-meta` репо.
8. Перестать создавать meta-репо в `POST /api/repos`.

### Phase 3: resumable stream + bridge + воркер (5–8 дней; зависит от Phase 0)
9. Перенести loop в `worker/handle-agent-run.ts`.
10. `streamText` → `toUIMessageStream` → publish в Redis **с явным дренажом** (механизм из Phase 0).
11. `POST /api/chat` → **server-side bridge**: enqueue → `waitForActiveStream` → `resumeExistingStream` → вернуть СТРИМ (не JSON).
12. `GET /api/chat/:id/stream` → resume для reconnect; 204+Retry-After в окне `activeStreamId=null`.
13. Фронт: `useChat({ resume: true })`, `DefaultChatTransport`, `prepareSendMessagesRequest`. Убрать кастомный reducer.
14. `onFinish` → `upsertAssistantMessages` (полный UIMessage[], идемпотентно по runId).
15. Тест: первый ход стримит из POST; закрыть вкладку → reconnect через GET; завершённый — из Postgres.

### Phase 4: fail-fast + reaper-sweep + heartbeat (2–3 дня)
16. `retryLimit: 0`; статусы `cancelling`/`reaping` в enum + unique-индекс.
17. Heartbeat в воркере + reaper с advisory-lock, сметающий `running`(crash)/`cancelling`(stuck)/`queued`(lost-job), с per-run CAS `→reaping` перед git-commit.
18. Тест: SIGKILL воркера в середине → reaper за ≤90с: CAS-claim + draft-commit + `failed` + release reservation; нет конкурентного commit с живым handler.

### Phase 5: stop + cancel (2 дня)
19. `POST /api/chat/:id/stop`: queued → CAS прямо в `cancelled` (+release); running → `cancelling`+cancel-флаг (воркер довершит).
20. Cancel-флаг опрос в воркере + abort; step-0 cancel с release+clear.
21. Фронт: кнопка stop (шлёт assistantMessage + activeStreamId); 504-bridge → resume в `onError`, не ошибка.
22. Тест: queued-cancel (не лочит проект, →cancelled, резерв возвращён), running-cancel (≤5с), re-enqueue после cancel.

### Phase 6: quota + usage + auto-retry (2–3 дня)
23. **Резервация** квоты в `POST /api/chat` (не check-then-act).
24. `recordUsage` + reconcile резервации во всех терминальных ветках (вкл. release при orphan).
25. Validation feedback loop (без жёсткого abort при budget-exhausted).

### Phase 7: polish
- Model registry финализация (реальные modelId).
- Cap на размер tool-part + ссылки на git-объекты.
- Observability, admin-панель active runs.

---

## 12. Верификация

Главный инвариант прежний: **система не теряет и не портит runs.** Фокус — integration + e2e на Testcontainers (Postgres) + **Redis-контейнер** + mock LLM + fake vm. Vitest уже настроен.

### 12.1 Инфраструктура тестов
- Testcontainers: `postgres:16-alpine` + `redis:7-alpine`.
- `MockLanguageModelV2` (`ai/test`) — детерминированные сценарии стрима (text-delta, tool-call, finish).
- Fake `vm` (in-memory) — основной; реальный Docker — отдельный nightly smoke.

### 12.2 Unit (чистая логика)
- RetryState (budget per-category, дедуп по hash, обнуление при passed).
- Escalation builder (attempt 1/2/3 уровни).
- Error parser (tsc/build фикстуры).
- `hashError` нормализация.
- `classifyTerminal` (err → cancelled/failed).

### 12.3 Integration: resumable stream + bridge (центральный сценарий)
1. **Phase 0 спайк-тест (предусловие).** Publisher (отдельный процесс/контекст) дренит стрим в Redis, subscriber читает полный UIMessage-стрим в порядке. **Подключение subscriber-а ПОСЛЕ начала публикации** → стрим буферизован, не потерян (критично для bridge с таймаутом).
2. **Bridge: live первый ход.** POST /api/chat → возвращает СТРИМ (не JSON); ассерт: первый chunk приходит из ответа на POST, до завершения run-а.
3. **Дренаж/usage не виснет.** Ассерт: `result.usage` резолвится (источник вычитан) — регрессионный тест на баг v2.0.
4. **Reconnect через GET.** Оборвать → GET resume → остаток. 204+Retry-After в окне `activeStreamId=null`.
5. **Несколько подписчиков.** Bridge + второй GET одновременно → оба получают полный стрим.
6. **Завершённый → из Postgres.** После completed + TTL стрим протух → GET /api/chat/:id отдаёт messages; resume-GET → 204.

### 12.4 Integration: durability воркера (инвариант)
1. **Happy path.** enqueue → completed; `messages` содержит assistant-UIMessage **с tool-parts** (явный ассерт — закрытие §5); код в main.
2. **Fail-fast: SIGKILL воркера в середине.** Ассерт: `retryLimit:0` → джоба НЕ переисполняется; нет склейки двух генераций (закрытие §1).
3. **Reaper коммитит осиротевший sandbox (закрытие v2 §3).** status=running + heartbeat stale + живой sandbox → reaper: draft-commit наработки + `failed` + release reservation + clear stream. Ассерт: код наработки в draft-ветке, не потерян.
4. **Idempotent queued→running.** Два воркера на один job → один обрабатывает.
5. **User suspended во время run.** → abort → cancelled.
6. **recordUsage + reconcile во всех ветках.** failed/cancelled → recordUsage с частичным usage; orphan → release reservation (закрытие §7, v2 §9).
7. **Идемпотентность assistant-сообщения (закрытие v2 §8).** stop-snapshot + onFinish для одного run → ровно одна assistant-строка (uniq-индекс).

### 12.5 Integration: stop / cancel + state machine
1. **Queued-cancel НЕ лочит проект (закрытие v2.1-2 §1).** stop при `queued` → `boss.cancel` + CAS прямо в `cancelled`; ассерт: статус `cancelled` (НЕ застрял в `cancelling`), резерв возвращён, проект свободен (новый run встаёт). Регрессионный тест на дедлок.
2. **Step-0 cancel освобождает резерв (закрытие v2.1-2 §2).** cancel-флаг к старту воркера → step-0 финализирует cancelled + release + clear; ассерт: резервация возвращена.
3. **Running-cancel.** stop → `cancelling` + флаг → abort ≤5с → `cancelled`; частичный assistantMessage сохранён (onFinish авторитетнее snapshot).
4. **Reaper сметает stuck `cancelling` (закрытие v2.1-2 §1).** Симулировать `cancelling` с протухшим heartbeat → reaper → `cancelled`, проект свободен.
5. **Reaper сметает lost `queued`.** `queued` без джобы в очереди дольше порога → reaper → `failed`.
6. **Reaper CAS vs живой handler (закрытие v2.1-2 §5).** Handler жив, делает долгий commit; reaper пытается claim → CAS не проходит → reaper no-op; ассерт: один git-commit, нет флипа статуса.
7. **Re-enqueue после cancel.** cancel → сразу новое сообщение → встаёт (проект свободен).
8. **Stale stop игнорируется.** устаревший activeStreamId → no-op.
9. **Навигация ≠ stop.** disconnect НЕ переводит в cancelled — стрим резюмируем.

### 12.6 Integration: auto-retry
1. Fix с 1-й попытки (validate fail → fix → pass → completed).
2. Budget-exhausted БЕЗ обрыва: после 3 фейлов validate отдаёт «explain to user», модель доигрывает finish с текстом (ассерт: run completed, есть финальное объяснение, НЕ failed-abort) — закрытие §9.
3. Дедуп → ранняя эскалация.
4. Счётчик обнуляется после passed.

### 12.7 E2E (вертикальный срез)
Реальный Next.js (test server) + воркер-процесс + Postgres + Redis (Testcontainers) + fake vm + mock model, через HTTP + `useChat`-совместимый клиент.

**Главный сценарий «закрыл вкладку — не потерял»:**
1. POST /api/chat → runId.
2. Подключиться к стриму, получить часть, **оборвать** (disconnect).
3. Дождаться завершения воркера (poll GET /api/chat/:id до completed).
4. GET /api/chat/:id → история `messages` содержит полный assistant-UIMessage с tool-parts.
5. Ассерт: транскрипт целостный, код в git, usage записан.

**Сценарий «reconnect во время живого run-а»:** оборвать → пока running, `useChat({resume})` → GET stream резюмит активный → получены остаток + финал.

### 12.8 Что НЕ тестируем автоматически
- Реальные ответы GLM / качество кодогенерации — отдельный eval-харнес, вне CI-гейта.
- Реальный Docker sandbox — nightly smoke.
- Внутренности `resumable-stream` — доверяем пакету; тестируем только наши эндпоинты-обёртки.

### 12.9 CI-гейт и привязка к фазам
- PR-гейт: unit + integration + e2e на Testcontainers (Postgres+Redis), ≤5–7 мин.
- Phase 0 → 12.3.1 (спайк publish/subscribe + поздний subscriber).
- Phase 1 → 12.4 happy + reaper тик.
- Phase 2 → миграция транскрипта, loadConversationUIMessages.
- Phase 3 → 12.3 (bridge + resumable + drain/usage), 12.4.1, 12.4.7, 12.7.
- Phase 4 → 12.4.2–3 (fail-fast + reaper-commit).
- Phase 5 → 12.5 (stop/cancel + re-enqueue).
- Phase 6 → 12.4.6 (usage/reservation), 12.6 (auto-retry).

---

## 13. Открытые вопросы (следующие итерации)
1. **Инкрементальный usage** для осиротевших runs (недо-биллим фактические токены при hard-crash; резерв возвращаем — leak закрыт, недо-биллинг остаётся).
2. **Multi-step с разными моделями** (plan→code). Phase 2.
3. **Шаринг проектов в команде** (permission-checks; `organizationId` есть).
4. **Streaming tool execution** (живой stdout долгих bash) — через data-parts.
5. **Sandboxing safety** — принятый техдолг, вне скоупа.
6. **Партиционирование `messages`** при росте.
7. **Кэш node_modules** для холодного старта sandbox (сейчас warmup-парты маскируют задержку, но не убирают её).
8. **Redis как критичная зависимость** — при недоступности in-flight runs падают (ловит reaper). Кластер/replica — если SLA потребует.

---

## 14. Чеклист готовности к продакшну
- [ ] **Phase 0 спайк зелёный**: headless-publish + дренаж + **валидация composed warmup→llm стрима** (закрытие v2.1-2 §3), ИЛИ fallback на Redis Streams.
- [ ] Drizzle миграции: `runs` (`jobId`, статусы `cancelling`/`reaping`), `conversations`, `messages` (uniq assistant-per-run); unique-индекс `one_active_run_per_project` включает все 4 не-терминальных статуса.
- [ ] Redis: `noeviction`, AOF everysec, `maxmemory` по нагрузке. НЕ allkeys-lru.
- [ ] pg-boss; `retryLimit:0`; `jobId` сохраняется при enqueue.
- [ ] Worker падает с корректным exit code (Docker рестартит).
- [ ] Reaper в одном экземпляре (advisory-lock); сметает `running`/`cancelling`/`queued`; CAS `→reaping` перед git-commit; release reservation.
- [ ] Heartbeat обновляется; застрявший run (любой не-терминальный) → терминал ≤90с; проект не лочится навсегда.
- [ ] **State-machine (§7.1)**: все переходы через `finalizeRunCAS`; нет флипов; `releaseReservation`/`recordUsage` идемпотентны по runId.
- [ ] **Bridge**: первый ход стримит из POST (стрим до гидрации, warmup-парты); `result.usage` не виснет; 504 → resume в `useChat.onError`, НЕ ошибка.
- [ ] Resume: закрыл вкладку → reconnect через GET; 204+Retry-After; завершённый — из Postgres.
- [ ] Fail-fast: SIGKILL → НЕТ склейки; reaper → failed + draft-commit.
- [ ] Stop: queued-cancel → сразу `cancelled` (НЕ дедлок в `cancelling`) + release; running-cancel ≤5с; re-enqueue работает; навигация ≠ stop.
- [ ] Транскрипт: assistant с tool-parts; одна assistant-строка на run.
- [ ] Quota: **резервация** в POST; release во ВСЕХ путях отмены (stop queued, step-0, reaper); `ESTIMATED_TURN_TOKENS` обоснован под многошаговый run (не «магия»).
- [ ] Код: completed→main; cancel/fail/orphan→draft-ветка.
- [ ] UX: при залоченном после краша проекте показывать «восстанавливаю прошлый run», не «занято».
- [ ] Model registry: реальные modelId.
- [ ] CI-гейт зелёный (Postgres+Redis Testcontainers) ≤7 мин.
- [ ] E2E «закрыл вкладку» + «bridge первый ход» + «queued-cancel не лочит проект» проходят автоматически.

---

**Конец спеки v2.1.**