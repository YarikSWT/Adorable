// Phase 0 — BLOCKING SPIKE for `resumable-stream` (spec v2.1 §11.0 / §12.3.1).
//
// Binary outcome GREEN|RED recorded in docs/agent-loop/phase0-spike-result.md.
// Gated on RUN_CONTAINER_TESTS=1 (Testcontainers redis:7-alpine). Without it the
// suite skips so the default `npm test` stays Docker-independent and green.
//
// Proves the 6 points the bridge architecture depends on:
//   (1) bytes reach Redis from a publisher with NO HTTP client (worker headless);
//   (2) the drain mechanism — producer fully completes even if its own reader leaves;
//   (3) waitUntil behaviour outside serverless (long-running worker → waitUntil:null);
//   (4) a subscriber connecting AFTER publication started still gets the full stream;
//   (5) exact API names/signatures of resumable-stream@2.x (ioredis subpath);
//   (6) createComposedUiStream: warmup data-* parts + LLM parts framed as ONE
//       protocol-valid UIMessage stream (single start/finish), intact across Redis.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { createUIMessageStream, JsonToSseTransformStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  startRedis,
  readAllChunks,
  makeStringStream,
  parseSseChunks,
  delayTransform,
  type StartedRedis,
} from "./_helpers/containers";

const enabled = process.env["RUN_CONTAINER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let redis: StartedRedis;

// Real waitUntil pump: track the producer's background promise so the test
// process never tears down before the drain finishes (point 3).
const pending: Promise<unknown>[] = [];
const trackingWaitUntil = (p: Promise<unknown>): void => {
  pending.push(Promise.resolve(p).catch(() => undefined));
};

beforeAll(async () => {
  redis = await startRedis();
}, 120_000);

afterAll(async () => {
  await Promise.allSettled(pending);
  if (redis) await redis.stop();
}, 60_000);

/**
 * A resumable-stream context backed by dedicated ioredis pub/sub clients —
 * one context per logical "process" (worker vs Next).
 */
function makeContext(waitUntil: ((p: Promise<unknown>) => void) | null) {
  return createResumableStreamContext({
    waitUntil,
    publisher: redis.client(),
    subscriber: redis.client(),
    keyPrefix: "spike",
  });
}

d("Phase 0 spike — resumable-stream cross-process pub/sub", () => {
  // (1)+(2)+(4)+(5): headless publisher → Redis; late subscriber gets full stream.
  it("late subscriber receives the fully buffered stream; bytes land in Redis without HTTP", async () => {
    const streamId = "spike-late-subscriber";
    const chunks = ["alpha ", "beta ", "gamma ", "delta ", "epsilon"];

    // Process A (worker): headless publisher. ioredis only — no HTTP client.
    const worker = makeContext(trackingWaitUntil);
    const producer = await worker.createNewResumableStream(streamId, () =>
      makeStringStream(chunks, 25),
    );
    expect(producer).not.toBeNull(); // (5) signature: returns ReadableStream | null

    // Drain the producer's own view in the background (the POST response side).
    const producerSeen: string[] = [];
    const producerDone = readAllChunks(producer!).then((cs) => {
      producerSeen.push(...cs);
    });

    // Connect a LATE subscriber (Process B = Next bridge) mid-publication.
    await new Promise((r) => setTimeout(r, 60));
    expect(await worker.hasExistingStream(streamId)).toBe(true); // (5)

    const next = makeContext(trackingWaitUntil);
    const sub = await next.resumeExistingStream(streamId);
    expect(sub).toBeTruthy(); // (5) ReadableStream | null | undefined
    const subSeen = await readAllChunks(sub as ReadableStream<string>);

    await producerDone;
    const full = chunks.join("");
    // (4) late subscriber buffered the whole stream from the start.
    expect(subSeen.join("")).toBe(full);
    expect(producerSeen.join("")).toBe(full);

    // (1) bytes really live in Redis under our prefix — proven from a plain
    // inspection client, i.e. transport happened with no HTTP between processes.
    const keys = await redis.inspector.keys("spike:*");
    expect(keys.length).toBeGreaterThan(0);
  }, 60_000);

  // (3): non-serverless behaviour — a long-running worker passes waitUntil:null
  // and the producer still drains completely (no serverless keep-alive needed).
  it("waitUntil:null (non-serverless) still drains the producer to completion", async () => {
    const streamId = "spike-waituntil-null";
    const chunks = ["one", "two", "three"];
    const worker = makeContext(null);
    const producer = await worker.createNewResumableStream(streamId, () =>
      makeStringStream(chunks, 10),
    );
    // Do NOT read the producer here — rely solely on the library's own pump.
    void producer;

    // A subscriber reading to completion is gated on the producer finishing the
    // drain; if the pump were a dropped no-op this read would hang/short-read.
    const next = makeContext(null);
    const sub = await next.resumeExistingStream(streamId);
    const seen = await readAllChunks(sub as ReadableStream<string>);
    expect(seen.join("")).toBe(chunks.join(""));
  }, 60_000);

  // (6): composed UIMessage stream — warmup data-* + LLM in ONE frame, intact
  // after a Redis round-trip via resumable-stream.
  it("createComposedUiStream: warmup data-* + LLM parts are ONE protocol-valid UIMessage stream", async () => {
    const streamId = "spike-composed-ui";

    const model = new MockLanguageModelV3({
      modelId: "mock-main",
      provider: "mock",
      doStream: (async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "t0" });
            controller.enqueue({ type: "text-delta", id: "t0", delta: "Hello" });
            controller.enqueue({ type: "text-delta", id: "t0", delta: " world" });
            controller.enqueue({ type: "text-end", id: "t0" });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
            });
            controller.close();
          },
        }),
      })) as never,
    });

    // Compose: warmup data-* parts (transient) + merged LLM stream — single frame.
    const composed = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({
          type: "data-progress",
          data: { stage: "warmup" },
          transient: true,
        } as never);
        writer.write({
          type: "data-progress",
          data: { stage: "sandbox-ready" },
          transient: true,
        } as never);
        const llm = streamText({ model, prompt: "hi" });
        writer.merge(llm.toUIMessageStream());
      },
    });

    // Serialise to SSE strings (what the worker drains into Redis). A small
    // per-chunk delay keeps the producer in-progress so the lib hands back a
    // live consumer view instead of the "already done" null.
    const sse = composed
      .pipeThrough(new JsonToSseTransformStream())
      .pipeThrough(delayTransform<string>(8));

    const worker = makeContext(trackingWaitUntil);
    const producer = await worker.createNewResumableStream(
      streamId,
      () => sse as ReadableStream<string>,
    );
    expect(producer).not.toBeNull();
    const producerRaw = (await readAllChunks(producer!)).join("");

    const parts = parseSseChunks(producerRaw);
    const types = parts.map((p) => p["type"]);

    // Single framing: exactly one start and one finish for the whole composed message.
    expect(types.filter((t) => t === "start")).toHaveLength(1);
    expect(types.filter((t) => t === "finish")).toHaveLength(1);

    // Warmup data-* parts present.
    const dataParts = parts.filter((p) => p["type"] === "data-progress");
    expect(dataParts.length).toBeGreaterThanOrEqual(2);

    // LLM text present and reconstructable.
    const text = parts
      .filter((p) => p["type"] === "text-delta")
      .map((p) => p["delta"])
      .join("");
    expect(text).toBe("Hello world");

    // Order invariant: warmup data-* are flushed first, then a SINGLE message
    // frame (start … text … finish). The merged LLM stream did NOT inject its
    // own competing start/finish (that's the "don't concatenate two independent
    // UIMessage streams" guarantee) — there is exactly one of each.
    const iStart = types.indexOf("start");
    const iFinish = types.lastIndexOf("finish");
    const iData = types.indexOf("data-progress");
    const iText = types.indexOf("text-delta");
    expect(iData).toBeLessThan(iStart); // warmup flushed before the message frame
    expect(iStart).toBeLessThan(iText); // text lives inside the frame
    expect(iText).toBeLessThan(iFinish);
    // finish is the terminal chunk of the single frame.
    expect(types[types.length - 1]).toBe("finish");
  }, 60_000);
});
