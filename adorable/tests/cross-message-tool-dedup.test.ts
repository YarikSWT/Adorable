// Pure unit tests for dedupeToolCallsAcrossMessages.
//
// The function dedups message parts by `toolCallId` across the whole
// thread (not just within a single message) so that
// @assistant-ui/tap's tapResources doesn't throw on duplicate keys.

import { describe, expect, it } from "vitest";
import { dedupeToolCallsAcrossMessages } from "@/lib/cross-message-tool-dedup";

type TestMsg = {
  id: string;
  role: "user" | "assistant" | "tool";
  parts: Array<{ type: string; toolCallId?: string; text?: string; output?: unknown }>;
};

describe("dedupeToolCallsAcrossMessages", () => {
  it("returns [] for empty input", () => {
    expect(dedupeToolCallsAcrossMessages([] as TestMsg[])).toEqual([]);
  });

  it("returns messages unchanged when every toolCallId is unique", () => {
    const msgs: TestMsg[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "tool-call", toolCallId: "call_A" },
          { type: "tool-call", toolCallId: "call_B" },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId: "call_C" }],
      },
    ];
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out).toEqual(msgs);
  });

  it("drops earlier tool-call parts when a later message reuses the same toolCallId", () => {
    const msgs: TestMsg[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "text", text: "thinking..." },
          { type: "tool-call", toolCallId: "call_X" }, // older, drop
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "tool-call", toolCallId: "call_X", output: "result" }, // newer, keep
        ],
      },
    ];
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[0].parts).toEqual([{ type: "text", text: "thinking..." }]);
    expect(out[1].parts).toEqual([
      { type: "tool-call", toolCallId: "call_X", output: "result" },
    ]);
  });

  it("keeps last occurrence within the same message when callId repeats", () => {
    const msgs: TestMsg[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "tool-call", toolCallId: "call_X" },
          { type: "tool-call", toolCallId: "call_X", output: "final" },
        ],
      },
    ];
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out[0].parts).toEqual([
      { type: "tool-call", toolCallId: "call_X", output: "final" },
    ]);
  });

  it("does not touch parts without a toolCallId", () => {
    const msgs: TestMsg[] = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "text", text: "hi" },
          { type: "text", text: "there" },
          { type: "tool-call", toolCallId: "call_A" },
        ],
      },
    ];
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out).toEqual(msgs);
  });

  it("handles messages with no parts array", () => {
    const msgs = [
      { id: "m1", role: "user" }, // no parts field
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId: "call_A" }],
      },
    ] as unknown as TestMsg[];
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[1].parts).toEqual([{ type: "tool-call", toolCallId: "call_A" }]);
  });

  it("preserves message-level fields (id, role, metadata) on rebuild", () => {
    const msgs = [
      {
        id: "m1",
        role: "assistant",
        metadata: { custom: "value" },
        parts: [{ type: "tool-call", toolCallId: "call_X" }],
      },
      {
        id: "m2",
        role: "assistant",
        metadata: { custom: "other" },
        parts: [{ type: "tool-call", toolCallId: "call_X" }],
      },
    ] as unknown as TestMsg[];
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out[0]).toMatchObject({ id: "m1", metadata: { custom: "value" } });
    expect(out[1]).toMatchObject({ id: "m2", metadata: { custom: "other" } });
  });

  it("dedupes across three messages with the same callId — keeps last", () => {
    const msgs: TestMsg[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId: "call_Y", output: "v1" }],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId: "call_Y", output: "v2" }],
      },
      {
        id: "m3",
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId: "call_Y", output: "v3" }],
      },
    ];
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out[0].parts).toEqual([]);
    expect(out[1].parts).toEqual([]);
    expect(out[2].parts).toEqual([
      { type: "tool-call", toolCallId: "call_Y", output: "v3" },
    ]);
  });

  it("handles empty toolCallId strings as if absent", () => {
    const msgs: TestMsg[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "tool-call", toolCallId: "" },
          { type: "tool-call", toolCallId: "" },
        ],
      },
    ];
    // Empty string is not a valid id — both parts kept untouched.
    const out = dedupeToolCallsAcrossMessages(msgs);
    expect(out[0].parts).toHaveLength(2);
  });
});
