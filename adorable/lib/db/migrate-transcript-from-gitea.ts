// One-time transcript migration: Gitea adorable-meta repo → Postgres
// (спец v2.1 §3.3). Reads the old UIMessage[] JSON per conversation and writes
// conversations + messages rows. The meta-repo is marked legacy, NOT physically
// removed (out of scope).
//
// IDEMPOTENT: a conversation that already has messages in Postgres is skipped,
// so a re-run never duplicates. The source is injected (real Gitea reader in
// prod; an in-memory fake in tests) so idempotency is provable against a
// Testcontainers Postgres without a live Gitea.

import type { UIMessage } from "ai";
import {
  ensureConversation,
  loadConversationUIMessages,
  saveConversationMessages,
  type TranscriptDB,
} from "@/lib/db/queries/transcript";

export interface MetaConversation {
  conversationId: string;
  userId: string;
  title?: string;
  messages: UIMessage[];
}

export interface MetaProject {
  projectId: string;
  conversations: MetaConversation[];
}

/** Source of legacy transcripts (Gitea meta-repos). Injected for testability. */
export interface TranscriptMigrationSource {
  listProjects(): Promise<MetaProject[]>;
}

export interface MigrationStats {
  projectsScanned: number;
  conversationsMigrated: number;
  conversationsSkipped: number;
  messagesInserted: number;
}

/** Migrate one conversation. No-op (skip) if it already has messages in PG. */
export async function migrateConversation(
  db: TranscriptDB,
  project: { projectId: string },
  conv: MetaConversation,
): Promise<{ migrated: boolean; messagesInserted: number }> {
  const existing = await loadConversationUIMessages(db, conv.conversationId);
  if (existing.length > 0) {
    return { migrated: false, messagesInserted: 0 };
  }
  await ensureConversation(db, {
    conversationId: conv.conversationId,
    projectId: project.projectId,
    userId: conv.userId,
    title: conv.title,
  });
  await saveConversationMessages(db, {
    conversationId: conv.conversationId,
    messages: conv.messages,
  });
  const after = await loadConversationUIMessages(db, conv.conversationId);
  return { migrated: true, messagesInserted: after.length };
}

/** Migrate every project's transcripts. Idempotent — safe to re-run. */
export async function migrateAllTranscripts(
  db: TranscriptDB,
  source: TranscriptMigrationSource,
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    projectsScanned: 0,
    conversationsMigrated: 0,
    conversationsSkipped: 0,
    messagesInserted: 0,
  };
  const projects = await source.listProjects();
  for (const project of projects) {
    stats.projectsScanned++;
    for (const conv of project.conversations) {
      const res = await migrateConversation(db, project, conv);
      if (res.migrated) {
        stats.conversationsMigrated++;
        stats.messagesInserted += res.messagesInserted;
      } else {
        stats.conversationsSkipped++;
      }
    }
  }
  return stats;
}
