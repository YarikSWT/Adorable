// Resumable-stream transport + server-side bridge plumbing (спец v2.1 §4/§5.2).
//
// Phase 0 verdict GREEN → resumable-stream as written. The worker publishes via
// createNewResumableStream (drain to Redis); the Next bridge / GET reconnect
// resume via resumeExistingStream. Streams carry SSE strings, so UIMessage
// chunks are serialised with JsonToSseTransformStream before publish.

import Redis from "ioredis";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import type { ResumableStreamContext } from "resumable-stream/ioredis";
import {
  createUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamWriter,
} from "ai";
import {
  loadRun,
  loadLatestRunForConversation,
  type RunDB,
} from "./run-state";

/**
 * A resumable-stream context for a long-running, non-serverless process
 * (worker OR Next server). waitUntil:null — the process stays alive, so the
 * producer pump completes without a serverless keep-alive wrapper (Phase 0
 * finding). Pass dedicated pub/sub ioredis clients.
 */
export function createStreamContext(redisUrl: string): {
  ctx: ResumableStreamContext;
  publisher: Redis;
  subscriber: Redis;
  close: () => Promise<void>;
} {
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const ctx = createResumableStreamContext({
    waitUntil: null,
    publisher,
    subscriber,
    keyPrefix: "agent-run",
  });
  return {
    ctx,
    publisher,
    subscriber,
    close: async () => {
      publisher.disconnect();
      subscriber.disconnect();
    },
  };
}

/**
 * A composed UIMessage stream: warmup data-* parts (cold-start progress) flushed
 * first, then the LLM stream merged in — ONE protocol-valid frame (single
 * start/finish), validated by the Phase 0 spike. pushWarmup before switchToLlm;
 * the LLM parts embed into the same frame.
 */
export interface ComposedUiStream {
  stream: ReadableStream<UIMessageChunk>;
  pushWarmup: (part: UIMessageChunk) => void;
  switchToLlm: (llm: ReadableStream<UIMessageChunk>) => void;
  finishWithoutLlm: () => void;
}

export function createComposedUiStream(): ComposedUiStream {
  const warmupQueue: UIMessageChunk[] = [];
  let writer: UIMessageStreamWriter | null = null;
  let resolveLlm!: (llm: ReadableStream<UIMessageChunk> | null) => void;
  const llmPromise = new Promise<ReadableStream<UIMessageChunk> | null>(
    (r) => (resolveLlm = r),
  );

  const stream = createUIMessageStream({
    execute: async ({ writer: w }) => {
      writer = w;
      for (const part of warmupQueue) w.write(part as never);
      warmupQueue.length = 0;
      const llm = await llmPromise;
      if (llm) w.merge(llm as never);
    },
  }) as ReadableStream<UIMessageChunk>;

  return {
    stream,
    pushWarmup: (part) => {
      if (writer) writer.write(part as never);
      else warmupQueue.push(part);
    },
    switchToLlm: (llm) => resolveLlm(llm),
    finishWithoutLlm: () => resolveLlm(null),
  };
}

/**
 * Bridge: wait until the worker publishes its stream (sets runs.activeStreamId),
 * polling Postgres. Returns the streamId, or null on timeout (caller → 504).
 * The worker now publishes BEFORE heavy hydration, so this resolves in <1s.
 */
export async function waitForActiveStream(
  db: RunDB,
  runId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const pollMs = opts.pollMs ?? 75;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await loadRun(db, runId);
    if (run?.activeStreamId) return run.activeStreamId;
    // Terminal already (super-fast run) → no live stream; caller reads from PG.
    if (run && ["completed", "failed", "cancelled"].includes(run.status)) {
      return null;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export type UIMessageList = UIMessage[];

/**
 * POST /api/chat bridge: enqueue happened upstream; wait for the worker stream,
 * then resume it. Returns the live stream, or null on timeout (caller → 504,
 * which the front treats as "reconnect", NOT a failed run).
 */
export async function bridgeFirstStream(
  ctx: ResumableStreamContext,
  db: RunDB,
  runId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ReadableStream<string> | null> {
  const streamId = await waitForActiveStream(db, runId, opts);
  if (!streamId) return null;
  const s = await ctx.resumeExistingStream(streamId);
  return (s as ReadableStream<string> | null) ?? null;
}

export type ResumeResult =
  | { kind: "stream"; stream: ReadableStream<string> }
  | { kind: "204"; retryAfter?: number };

/**
 * GET /api/chat/:id/stream reconnect logic. 204+Retry-After in the brief
 * enqueue→setActiveStream window (front retries, не "пусто"); plain 204 when
 * terminal / no active stream (front loads from Postgres); otherwise resume.
 */
export async function resumeRunStream(
  ctx: ResumableStreamContext,
  db: RunDB,
  conversationId: string,
): Promise<ResumeResult> {
  const run = await loadLatestRunForConversation(db, conversationId);
  if (
    run &&
    ["queued", "running"].includes(run.status) &&
    run.activeStreamId == null
  ) {
    return { kind: "204", retryAfter: 1 };
  }
  if (!run || run.activeStreamId == null) {
    return { kind: "204" };
  }
  const s = await ctx.resumeExistingStream(run.activeStreamId);
  if (!s) return { kind: "204" };
  return { kind: "stream", stream: s as ReadableStream<string> };
}

/**
 * Read a ReadableStream<string> to completion (the explicit drain). The worker
 * MUST drain the producer so the stream fully reaches Redis and result.usage
 * resolves (regression: a no-op pump leaves usage hanging — Phase 0 finding).
 */
export async function drainStream(stream: ReadableStream<string>): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
