// One-time migration: project metadata + transcript Gitea adorable-meta repo →
// Postgres (спец v2.1 §3.3, closing Phase 2 unit 8). Writes projects.metadata
// (the RepoMetadata blob minus conversations) and the conversations/messages
// rows, then the wrapper repo is legacy (no longer created). The source is
// injected (real Gitea reader in prod; in-memory fake in tests).
//
// IDEMPOTENT: a project that already has projects.metadata is skipped, and the
// transcript migration is itself idempotent (skip-if-has-messages), so a re-run
// never duplicates.

import { eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { projects } from "@/lib/db/schema/projects";
import {
  ensureConversation,
  saveConversationMessages,
} from "@/lib/db/queries/transcript";

export type MetadataMigrationDB = PostgresJsDatabase<typeof schema>;

export interface MetaConversationRecord {
  conversationId: string;
  userId: string;
  title?: string;
  messages: UIMessage[];
}

export interface MetaProjectRecord {
  /** PG projects.id */
  projectId: string;
  /** RepoMetadata blob (minus conversations) read from the Gitea wrapper. */
  metadataBlob: Record<string, unknown>;
  conversations: MetaConversationRecord[];
}

export interface MetadataMigrationSource {
  /** Projects that still need migrating (have a wrapper, no projects.metadata). */
  listProjects(): Promise<MetaProjectRecord[]>;
}

export interface MetadataMigrationStats {
  projectsScanned: number;
  projectsMigrated: number;
  projectsSkipped: number;
  conversationsMigrated: number;
  messagesInserted: number;
}

/** Migrate one project. No-op (skip) if projects.metadata is already set. */
export async function migrateProjectMetadata(
  db: MetadataMigrationDB,
  rec: MetaProjectRecord,
): Promise<{ migrated: boolean; messagesInserted: number; conversations: number }> {
  const existing = await db
    .select({ metadata: projects.metadata })
    .from(projects)
    .where(eq(projects.id, rec.projectId));
  if (existing[0]?.metadata) {
    return { migrated: false, messagesInserted: 0, conversations: 0 };
  }

  await db
    .update(projects)
    .set({ metadata: rec.metadataBlob })
    .where(eq(projects.id, rec.projectId));

  let messagesInserted = 0;
  for (const conv of rec.conversations) {
    await ensureConversation(db, {
      conversationId: conv.conversationId,
      projectId: rec.projectId,
      userId: conv.userId,
      title: conv.title,
    });
    await saveConversationMessages(db, {
      conversationId: conv.conversationId,
      messages: conv.messages,
    });
    messagesInserted += conv.messages.length;
  }
  return {
    migrated: true,
    messagesInserted,
    conversations: rec.conversations.length,
  };
}

/** Migrate every project's metadata + transcript. Idempotent — safe to re-run. */
export async function migrateAllMetadata(
  db: MetadataMigrationDB,
  source: MetadataMigrationSource,
): Promise<MetadataMigrationStats> {
  const stats: MetadataMigrationStats = {
    projectsScanned: 0,
    projectsMigrated: 0,
    projectsSkipped: 0,
    conversationsMigrated: 0,
    messagesInserted: 0,
  };
  for (const rec of await source.listProjects()) {
    stats.projectsScanned++;
    const res = await migrateProjectMetadata(db, rec);
    if (res.migrated) {
      stats.projectsMigrated++;
      stats.conversationsMigrated += res.conversations;
      stats.messagesInserted += res.messagesInserted;
    } else {
      stats.projectsSkipped++;
    }
  }
  return stats;
}
