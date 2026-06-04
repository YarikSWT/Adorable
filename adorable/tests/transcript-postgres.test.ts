// Phase 2 (спец v2.1 §3.2): the transcript lives in Postgres.
//   - saveConversationMessages / loadConversationUIMessages round-trip a full
//     UIMessage[] with tool-parts (NOT flattened text);
//   - the assistant message of a run is idempotent (upsert by run_id), so a
//     re-save / stop-snapshot + onFinish converge on ONE row.
//
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers postgres:16-alpine).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import { messages } from "@/lib/db/schema/messages";
import {
  loadConversationUIMessages,
  saveConversationMessages,
  upsertAssistantMessage,
} from "@/lib/db/queries/transcript";
import { startPostgres, type StartedPostgres } from "./_helpers/containers";
import {
  connectAndMigrate,
  seedProjectGraph,
  seedRun,
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

// An assistant UIMessage with a tool-call + tool-result part (the thing we MUST
// not flatten — спец §3.2 "не плоский текст").
function assistantWithTools(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: "Creating the file." },
      {
        type: "tool-writeFile",
        toolCallId: "call-1",
        state: "output-available",
        input: { path: "src/main.tsx", contents: "console.log(1)" },
        output: { ok: true },
      },
      { type: "text", text: "Done." },
    ],
  } as unknown as UIMessage;
}

d("Phase 2 transcript on Postgres", () => {
  it("saves + loads a full transcript with tool-parts (not flattened)", async () => {
    const runId = await seedRun(handle.db, graph);
    const userMsg = {
      id: "u-1",
      role: "user",
      parts: [{ type: "text", text: "make a file" }],
    } as unknown as UIMessage;

    await saveConversationMessages(handle.db, {
      conversationId: graph.conversationId,
      runId,
      messages: [userMsg, assistantWithTools("a-1")],
    });

    const loaded = await loadConversationUIMessages(
      handle.db,
      graph.conversationId,
    );
    expect(loaded).toHaveLength(2);
    const assistant = loaded.find((m) => m.role === "assistant")!;
    expect(assistant).toBeTruthy();
    // tool-part survived round-trip as a structured part, not flat text.
    const toolPart = assistant.parts.find((p) =>
      String((p as { type?: string }).type).startsWith("tool-"),
    ) as { type: string; toolCallId: string; output: unknown } | undefined;
    expect(toolPart).toBeTruthy();
    expect(toolPart!.toolCallId).toBe("call-1");
    expect(toolPart!.output).toEqual({ ok: true });
  }, 60_000);

  it("assistant message is idempotent per run (upsert, one row)", async () => {
    const g2 = await seedProjectGraph(handle.db, "2");
    const runId = await seedRun(handle.db, g2);

    // First write (e.g. stop-snapshot) then authoritative onFinish overwrite.
    await upsertAssistantMessage(handle.db, {
      conversationId: g2.conversationId,
      runId,
      uiMessage: assistantWithTools("partial"),
    });
    await upsertAssistantMessage(handle.db, {
      conversationId: g2.conversationId,
      runId,
      uiMessage: {
        ...assistantWithTools("final"),
        parts: [
          ...assistantWithTools("final").parts,
          { type: "text", text: "FINAL" },
        ],
      } as UIMessage,
    });

    const rows = await handle.db
      .select()
      .from(messages)
      .where(eq(messages.runId, runId));
    expect(rows).toHaveLength(1); // exactly one assistant row per run
    const finalText = (rows[0].uiMessage.parts as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("|");
    expect(finalText).toContain("FINAL"); // onFinish authoritative
  }, 60_000);

  it("re-saving the same transcript does not duplicate (migration idempotency)", async () => {
    const g3 = await seedProjectGraph(handle.db, "3");
    const runId = await seedRun(handle.db, g3);
    const payload = {
      conversationId: g3.conversationId,
      runId,
      messages: [
        { id: "u-x", role: "user", parts: [{ type: "text", text: "hi" }] } as unknown as UIMessage,
        assistantWithTools("a-x"),
      ],
    };
    await saveConversationMessages(handle.db, payload);
    await saveConversationMessages(handle.db, payload); // re-run

    const loaded = await loadConversationUIMessages(handle.db, g3.conversationId);
    expect(loaded).toHaveLength(2); // user deduped by id, assistant upserted
  }, 60_000);
});
