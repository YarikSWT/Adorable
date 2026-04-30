// Pure helper: dedupes message parts by `toolCallId` across the entire
// thread, keeping the LAST occurrence.
//
// Background: `@assistant-ui/tap`'s `tapResources` throws when it sees two
// elements with the same key. The AI SDK message converter
// (`convertParts` in @assistant-ui/react-ai-sdk) only dedups within a
// single message — it doesn't deduplicate across messages. After a
// step-boundary (or any path that splits an assistant turn into multiple
// `UIMessage`s), the same `toolCallId` can appear in two messages and
// crash the UI mid-stream.
//
// We can't intercept the converter from outside the library, so we
// dedupe BEFORE the converter sees the messages — by wrapping
// `useChat()`'s `chatHelpers.messages` with this helper.
//
// Why "last wins": tool call lifecycle goes input-streaming → input-
// available → output-available. Later parts always carry strictly more
// information than earlier ones; dropping the earlier copy is safe.
//
// Persistence is unaffected — `lib/repo-storage.ts:sanitiseConversation
// Messages` does its own (different, more conservative) save-time
// sanitise. This file is UI-only.

// Minimal shape we depend on — tolerates the full UIMessage<unknown,
// UIDataTypes, UITools> from `ai`/`@ai-sdk/react` as well as our test
// fixtures. We never read fields outside `parts`, so the rest of the
// message stays opaque.
type WithOptionalParts = { parts?: ReadonlyArray<unknown> | undefined };

const partToolCallId = (part: unknown): string | undefined => {
  if (!part || typeof part !== "object") return undefined;
  const id = (part as { toolCallId?: unknown }).toolCallId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

export const dedupeToolCallsAcrossMessages = <M extends WithOptionalParts>(
  messages: readonly M[],
): M[] => {
  if (messages.length === 0) return [];

  // First pass: walk in order, record the last (messageIndex, partIndex)
  // for each toolCallId. Tuple is sufficient — we only need to recognize
  // "is THIS part the latest for its callId" later.
  const lastSeenAt = new Map<string, { mIdx: number; pIdx: number }>();
  for (let mIdx = 0; mIdx < messages.length; mIdx++) {
    const parts = messages[mIdx]?.parts;
    if (!Array.isArray(parts)) continue;
    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
      const id = partToolCallId(parts[pIdx]);
      if (id) lastSeenAt.set(id, { mIdx, pIdx });
    }
  }

  // No duplicates possible if every tool-call id appears once. Bail out
  // without re-allocating to keep the common path cheap.
  let totalToolParts = 0;
  for (const msg of messages) {
    if (!Array.isArray(msg.parts)) continue;
    for (const p of msg.parts) if (partToolCallId(p)) totalToolParts++;
  }
  if (totalToolParts === lastSeenAt.size) return messages.slice() as M[];

  // Second pass: rebuild, dropping any tool-call part whose (mIdx, pIdx)
  // doesn't match the last-seen entry.
  const out: M[] = [];
  for (let mIdx = 0; mIdx < messages.length; mIdx++) {
    const msg = messages[mIdx]!;
    const parts = Array.isArray(msg.parts) ? msg.parts : null;
    if (!parts) {
      out.push(msg);
      continue;
    }
    const filtered = parts.filter((p, pIdx) => {
      const id = partToolCallId(p);
      if (!id) return true;
      const last = lastSeenAt.get(id)!;
      return last.mIdx === mIdx && last.pIdx === pIdx;
    });
    out.push({ ...msg, parts: filtered });
  }
  return out;
};
