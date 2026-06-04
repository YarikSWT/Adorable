// Phase 2 (спец v2.1 §3.3): the one-time Gitea→Postgres transcript migration is
// IDEMPOTENT — re-running it does NOT duplicate messages (count assertion).
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { messages } from "@/lib/db/schema/messages";
import {
  migrateAllTranscripts,
  type TranscriptMigrationSource,
} from "@/lib/db/migrate-transcript-from-gitea";
import { loadConversationUIMessages } from "@/lib/db/queries/transcript";
import { startPostgres, type StartedPostgres } from "./_helpers/containers";
import {
  connectAndMigrate,
  seedProjectGraph,
  type TestDbHandle,
  type SeededGraph,
} from "./_helpers/db";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let pg: StartedPostgres;
let handle: TestDbHandle;
let graph: SeededGraph;

beforeAll(async () => {
  pg = await startPostgres();
  handle = await connectAndMigrate(pg.url);
  graph = await seedProjectGraph(handle.db);
}, 180_000);

afterAll(async () => {
  if (handle) await handle.end();
  if (pg) await pg.stop();
}, 60_000);

function transcript(): UIMessage[] {
  return [
    { id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] },
    {
      id: "m2",
      role: "assistant",
      parts: [
        { type: "text", text: "hi" },
        {
          type: "tool-readFile",
          toolCallId: "t1",
          state: "output-available",
          input: { path: "a" },
          output: "contents",
        },
      ],
    },
    { id: "m3", role: "user", parts: [{ type: "text", text: "thanks" }] },
  ] as unknown as UIMessage[];
}

d("Phase 2 transcript migration (Gitea → Postgres)", () => {
  it("is idempotent — second run inserts nothing", async () => {
    // The legacy conversation reuses the seeded conversation id so its FK
    // (project/user) is valid; in prod the id comes from the meta-repo.
    const source: TranscriptMigrationSource = {
      listProjects: async () => [
        {
          projectId: graph.projectId,
          conversations: [
            {
              conversationId: graph.conversationId,
              userId: graph.userId,
              title: "Legacy chat",
              messages: transcript(),
            },
          ],
        },
      ],
    };

    const first = await migrateAllTranscripts(handle.db, source);
    expect(first.conversationsMigrated).toBe(1);
    expect(first.messagesInserted).toBe(3);

    const countAfterFirst = await handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages);
    expect(countAfterFirst[0].n).toBe(3);

    // Re-run: must skip, insert nothing.
    const second = await migrateAllTranscripts(handle.db, source);
    expect(second.conversationsMigrated).toBe(0);
    expect(second.conversationsSkipped).toBe(1);
    expect(second.messagesInserted).toBe(0);

    const countAfterSecond = await handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages);
    expect(countAfterSecond[0].n).toBe(3); // unchanged

    const loaded = await loadConversationUIMessages(
      handle.db,
      graph.conversationId,
    );
    expect(loaded).toHaveLength(3);
    // tool-parts preserved through migration.
    const assistant = loaded.find((m) => m.role === "assistant")!;
    expect(
      assistant.parts.some((p) =>
        String((p as { type?: string }).type).startsWith("tool-"),
      ),
    ).toBe(true);
  }, 60_000);
});
