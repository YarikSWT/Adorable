// Transcript persistence on Postgres (спец v2.1 §3.2/§3.3).
//
// The conversation transcript moves out of the Gitea meta-repo into the
// conversations + messages tables. The full UIMessage (with tool-parts) is
// stored as-is in messages.uiMessage (jsonb), so the next turn feeds the model
// its own tool-calls and useChat gets native initialMessages without conversion.
//
// Idempotency:
//   - the assistant message of a run is UPSERTED by the partial unique index
//     messages_run_assistant_uniq (run_id WHERE role='assistant') — stop-snapshot
//     and worker onFinish converge on one row;
//   - user/system messages are deduped by their UIMessage `id`, so re-saving a
//     transcript (or re-running the Gitea→PG migration) never duplicates rows.

import { and, asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { UIMessage } from "ai";
import * as schema from "@/lib/db/schema";
import { conversations } from "@/lib/db/schema/conversations";
import { messages } from "@/lib/db/schema/messages";
import { sanitiseConversationMessages } from "@/lib/repo-storage";

export type TranscriptDB = PostgresJsDatabase<typeof schema>;

/** Full UIMessage[] transcript for a conversation, chronological order. */
export async function loadConversationUIMessages(
  db: TranscriptDB,
  conversationId: string,
): Promise<UIMessage[]> {
  const rows = await db
    .select({ uiMessage: messages.uiMessage, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  return rows.map((r) => r.uiMessage);
}

/**
 * Idempotent upsert of THE assistant message of a run. Authoritative path is
 * the worker onFinish (full SDK partial); a stop-snapshot writing first is
 * overwritten. Keyed by the partial unique index (run_id WHERE role='assistant').
 */
export async function upsertAssistantMessage(
  db: TranscriptDB,
  args: { conversationId: string; runId: string; uiMessage: UIMessage },
): Promise<void> {
  await db
    .insert(messages)
    .values({
      conversationId: args.conversationId,
      runId: args.runId,
      role: "assistant",
      uiMessage: args.uiMessage,
    })
    .onConflictDoUpdate({
      target: messages.runId,
      targetWhere: sql`role = 'assistant'`,
      set: { uiMessage: args.uiMessage },
    });
}

/** Append a user/system message, deduped by its UIMessage id within the conversation. */
export async function insertNonAssistantMessage(
  db: TranscriptDB,
  args: { conversationId: string; uiMessage: UIMessage },
): Promise<void> {
  const id = (args.uiMessage as { id?: string }).id;
  if (id) {
    const dupes = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, args.conversationId),
          sql`${messages.uiMessage}->>'id' = ${id}`,
        ),
      );
    if (dupes.length > 0) return;
  }
  await db.insert(messages).values({
    conversationId: args.conversationId,
    role: args.uiMessage.role,
    uiMessage: args.uiMessage,
  });
}

/**
 * Persist a full transcript to Postgres. The assistant message of `runId` is
 * upserted (idempotent); other messages are appended deduped by UIMessage id.
 * Sanitises tool-parts first (shared with the legacy path).
 */
export async function saveConversationMessages(
  db: TranscriptDB,
  args: { conversationId: string; runId?: string; messages: UIMessage[] },
): Promise<void> {
  const sanitised = sanitiseConversationMessages(args.messages);
  for (const m of sanitised) {
    if (m.role === "assistant" && args.runId) {
      await upsertAssistantMessage(db, {
        conversationId: args.conversationId,
        runId: args.runId,
        uiMessage: m,
      });
    } else {
      await insertNonAssistantMessage(db, {
        conversationId: args.conversationId,
        uiMessage: m,
      });
    }
  }
}

/** Ensure a conversation row exists (one-conversation-per-project fork invariant). */
export async function ensureConversation(
  db: TranscriptDB,
  args: { conversationId?: string; projectId: string; userId: string; title?: string },
): Promise<string> {
  if (args.conversationId) {
    const existing = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, args.conversationId));
    if (existing.length > 0) return existing[0].id;
  }
  const [row] = await db
    .insert(conversations)
    .values({
      ...(args.conversationId ? { id: args.conversationId } : {}),
      projectId: args.projectId,
      userId: args.userId,
      title: args.title ?? null,
    })
    .returning({ id: conversations.id });
  return row.id;
}
