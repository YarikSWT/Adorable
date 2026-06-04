// runs — agent-loop run lifecycle (спец v2.1 §3.1).
//
// Источник правды по жизненному циклу одного хода агента. Воркер обновляет
// heartbeatAt каждые 10с (liveness для reaper определяется heartbeat-ом, НЕ
// job-expiration). activeStreamId связывает run с Redis-стримом (resumable-stream)
// для bridge/resume/stop. jobId сохраняется из boss.send, чтобы stop мог
// boss.cancel(jobId).
//
// Инвариант «один активный run на проект» обеспечен partial unique index
// one_active_run_per_project на уровне БД (§4.1) — НЕ racy explicit-check.

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";
import { projects } from "./projects";
import { conversations } from "./conversations";

export const RUN_STATUSES = [
  "queued",
  "running",
  "cancelling",
  "reaping",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// Не-терминальные статусы — те, что держат проект «занятым» (предикат
// one_active_run_per_project). Держим как единый источник правды для индекса,
// reaper-а и stop-эндпоинта.
export const ACTIVE_RUN_STATUSES = [
  "queued",
  "running",
  "cancelling",
  "reaping",
] as const;

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),

    status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),

    // Связь с активным Redis-стримом (resume/bridge/stop). NULL когда стрим неактивен.
    activeStreamId: text("active_stream_id"),

    // ID pg-boss джобы — чтобы stop мог boss.cancel(jobId). Сохраняется из boss.send.
    jobId: text("job_id"),

    prompt: text("prompt").notNull(),
    modelKey: text("model_key").notNull(),

    // Heartbeat для reaper: воркер обновляет каждые 10с пока run жив.
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    tokenUsage: jsonb("token_usage").$type<{
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
    }>(),
    stepCount: integer("step_count").notNull().default(0),
  },
  (t) => ({
    byUser: index("runs_user_created_idx").on(t.userId, t.createdAt.desc()),
    byConversation: index("runs_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    // Reaper-окно: быстрый поиск не-терминальных runs по протухшему heartbeat.
    reaperScan: index("runs_reaper_idx")
      .on(t.status, t.heartbeatAt)
      .where(sql`status IN ('queued','running','cancelling','reaping')`),
    // Атомарный «один активный run на проект» (§4.1): второй параллельный INSERT
    // падает на unique violation → 409. Re-enqueue работает, т.к. cancel быстро
    // уводит run в cancelled (вне предиката).
    oneActivePerProject: uniqueIndex("one_active_run_per_project")
      .on(t.projectId)
      .where(sql`status IN ('queued','running','cancelling','reaping')`),
  }),
);

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
