# Phase 0 spike result — `resumable-stream` (BLOCKING)

## VERDICT: 🟢 GREEN

`resumable-stream@2.2.12` works as a cross-process Redis pub/sub exactly as the
spec's §4 bridge architecture requires. **Phase 3 implements §4 as written
(resumable-stream).** The RED fallback (hand-rolled Redis Streams XADD/XREAD)
is NOT needed.

## Proof (artifact, not words)

- Test: `adorable/tests/spike-resumable-stream.test.ts`
- Command: `cd adorable && RUN_CONTAINER_TESTS=1 npx vitest run tests/spike-resumable-stream.test.ts`
- Result: **exit 0**, 3/3 passing against Testcontainers `redis:7-alpine`.
- Run log: `verification/agent-loop/phase0-spike-run.log`

```
 ✓ late subscriber receives the fully buffered stream; bytes land in Redis without HTTP 141ms
 ✓ waitUntil:null (non-serverless) still drains the producer to completion 40ms
 ✓ createComposedUiStream: warmup data-* + LLM parts are ONE protocol-valid UIMessage stream 123ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## The 6 points of §11.0b / §12.3.1 — findings

1. **Bytes reach Redis with no HTTP client at the publisher.** The worker side
   uses `createResumableStreamContext({ publisher, subscriber })` with plain
   `ioredis` clients (subpath `resumable-stream/ioredis`). After publishing, an
   independent inspection client finds keys under the `spike:*` prefix — the
   transport is pure Redis pub/sub + buffer, no HTTP between worker and Next.

2. **Drain mechanism.** `createNewResumableStream(streamId, makeStream)` is the
   producer. It fully drains the source into Redis and **always completes the
   stream even if its own reader goes away** (the bridge POST can disconnect).
   The returned `ReadableStream<string>` is the live POST-response view.

3. **`waitUntil` outside serverless.** Type is `((p) => void) | null`. For a
   **long-running worker** pass `waitUntil: null` — the process stays alive, so
   no serverless keep-alive wrapper is needed and the producer still drains to
   completion (verified by the dedicated test). The "no-op drops the promise"
   hazard only applies to serverless `after()`; it does not apply to our worker.
   A real pump / tracked promise is the right pattern when you must await drain
   in tests.

4. **Late subscriber gets the full buffered stream.** A subscriber that calls
   `resumeExistingStream(streamId)` **after** publication has already started
   still receives the entire stream from the beginning (Redis buffer) plus the
   live remainder, in order. This is the property the bridge depends on
   (POST enqueues → waits for the active stream → resumes it).

5. **Exact API (resumable-stream@2.2.12, `/ioredis` subpath):**
   - `createResumableStreamContext({ keyPrefix?, waitUntil, publisher?, subscriber? }) → ResumableStreamContext`
   - `createNewResumableStream(streamId, () => ReadableStream<string>, skip?) → Promise<ReadableStream<string> | null>` — producer (worker).
   - `resumeExistingStream(streamId, skip?) → Promise<ReadableStream<string> | null | undefined>` — consumer (bridge/GET). `null` = stream done, `undefined` = no such stream.
   - `resumableStream(streamId, makeStream, skip?)` — idempotent create-or-resume.
   - `hasExistingStream(streamId) → Promise<null | true | "DONE">`.
   - Streams carry **strings** → UIMessage chunks must be SSE-serialised
     (`JsonToSseTransformStream`) before publish and parsed back after resume.
   - Root export (`resumable-stream`) needs the `redis` package; we use
     `resumable-stream/ioredis` with the already-present `ioredis`.

6. **`createComposedUiStream` — warmup + LLM in ONE frame.** `createUIMessageStream({ execute })`
   with `writer.write({ type: 'data-progress', …, transient: true })` for warmup
   parts and `writer.merge(streamText(…).toUIMessageStream())` for the LLM yields
   a **single** protocol frame: observed chunk order
   `data-progress · data-progress · start · start-step · text-start · text-delta… · text-end · finish-step · finish`
   — exactly **one `start` and one `finish`**. The merge absorbs the LLM stream's
   own framing (no double start/finish — the spec's "don't concatenate two
   independent UIMessage streams" hazard is avoided). Transient warmup data-*
   parts flush before the message `start`; the LLM parts live inside the frame.
   The composed SSE survives a resumable-stream round-trip intact.

## Consequence for Phase 3 (PRECONDITION)

GREEN → `worker/handle-agent-run.ts` uses `streamText → toUIMessageStream →
JsonToSseTransformStream → createNewResumableStream` (publish with explicit
drain). `POST /api/chat` bridges via `resumeExistingStream`; `GET /:id/stream`
resumes for reconnect. `waitUntil: null` in the worker. No fallback transport.
