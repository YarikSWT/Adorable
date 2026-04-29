// Tests for sanitiseConversationMessages — defensive cleanup before
// persisting chat transcripts to Gitea (lib/repo-storage.ts).
//
// Backstory: assistant-ui v0.12 + ai v6 occasionally emit a transcript
// with (a) a phantom empty user/tool message and (b) duplicate parts
// keyed by the same toolCallId. Loading that transcript back triggers
// `Duplicate key toolCallId-… in tapResources` and crashes the chat UI.
// Sanitisation keeps the on-disk state loadable.

import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { sanitiseConversationMessages } from "@/lib/repo-storage";

describe("sanitiseConversationMessages", () => {
  it("returns identity for a clean transcript", () => {
    const input = [
      { role: "user", id: "u1", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        id: "a1",
        parts: [
          { type: "text", text: "hello" },
          { type: "tool-readFileTool", toolCallId: "call_1", state: "output-available" },
        ],
      },
    ] as unknown as UIMessage[];
    const out = sanitiseConversationMessages(input);
    expect(out).toHaveLength(2);
    expect(out[1].parts).toHaveLength(2);
  });

  it("drops empty user message (phantom placeholder)", () => {
    const input = [
      { role: "user", id: "u1", parts: [{ type: "text", text: "build me X" }] },
      { role: "user", id: "u2", parts: [] },
      { role: "assistant", id: "a1", parts: [{ type: "text", text: "ok" }] },
    ] as unknown as UIMessage[];
    const out = sanitiseConversationMessages(input);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("u1");
    expect(out[1].id).toBe("a1");
  });

  it("keeps empty assistant message (might be a step boundary)", () => {
    const input = [
      { role: "assistant", id: "a-empty", parts: [] },
    ] as unknown as UIMessage[];
    const out = sanitiseConversationMessages(input);
    expect(out).toHaveLength(1);
  });

  it("dedupes parts by toolCallId within a single message, keeping the last", () => {
    const input = [
      {
        role: "assistant",
        id: "a1",
        parts: [
          { type: "tool-readFileTool", toolCallId: "call_dup", state: "input-streaming", input: {} },
          { type: "text", text: "between" },
          { type: "tool-readFileTool", toolCallId: "call_dup", state: "output-available", input: { file: "x" }, output: "ok" },
        ],
      },
    ] as unknown as UIMessage[];
    const out = sanitiseConversationMessages(input);
    expect(out).toHaveLength(1);
    expect(out[0].parts).toHaveLength(2);
    // Last occurrence wins — final part is the output-available variant.
    const toolPart = (out[0].parts as Array<Record<string, unknown>>).find(
      (p) => p.toolCallId === "call_dup",
    );
    expect(toolPart?.state).toBe("output-available");
  });

  it("does not dedupe parts that have no toolCallId", () => {
    const input = [
      {
        role: "assistant",
        id: "a1",
        parts: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
          { type: "step-start" },
          { type: "step-start" },
        ],
      },
    ] as unknown as UIMessage[];
    const out = sanitiseConversationMessages(input);
    expect(out[0].parts).toHaveLength(4);
  });

  it("does not mutate the input array or messages", () => {
    const input = [
      { role: "user", id: "u1", parts: [] },
      { role: "user", id: "u2", parts: [{ type: "text", text: "hi" }] },
    ] as unknown as UIMessage[];
    const originalLength = input.length;
    const originalParts = input[1].parts;
    sanitiseConversationMessages(input);
    expect(input).toHaveLength(originalLength);
    expect(input[1].parts).toBe(originalParts);
  });
});
