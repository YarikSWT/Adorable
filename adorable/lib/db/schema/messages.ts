// messages — полный UIMessage[] транскрипта (спец v2.1 §3.2).
//
// uiMessage хранит ЦЕЛЫЙ UIMessage с parts (text + tool-call + tool-result +
// reasoning) as-is из onFinish toUIMessageStream — НЕ плоский текст. Это
// сохраняет tool-историю для следующего хода (convertToModelMessages) и отдаётся
// useChat initialMessages без конверсий.

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { conversations } from "./conversations";
import { runs } from "./runs";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // для assistant-сообщений; null для user.
    runId: uuid("run_id").references(() => runs.id),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),

    // ПОЛНЫЙ UIMessage с parts. Не плоский текст.
    uiMessage: jsonb("ui_message").$type<UIMessage>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byConversation: index("messages_conv_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    // Идемпотентность assistant-сообщения (§3.2): один run → максимум одно
    // assistant-сообщение. stop-snapshot и onFinish делают upsert по этому ключу.
    uniqAssistantPerRun: uniqueIndex("messages_run_assistant_uniq")
      .on(t.runId)
      .where(sql`role = 'assistant'`),
  }),
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
