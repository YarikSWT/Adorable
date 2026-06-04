// Shared fixtures for the Phase 3 bridge/worker integration tests.
// Gated callers must check RUN_CONTAINER_TESTS=1.

import { MockLanguageModelV3 } from "ai/test";
import { tool, type LanguageModel } from "ai";
import { z } from "zod";
import { createStreamContext } from "@/lib/agent-run/stream";
import type { AgentRunDeps } from "@/lib/agent-run/handle-agent-run";
import type { RunDB } from "@/lib/agent-run/run-state";
import type { TranscriptDB } from "@/lib/db/queries/transcript";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tool the mock model "calls" so the assistant message carries tool-parts. */
export const writeFileTool = tool({
  description: "write a file in the project",
  inputSchema: z.object({ path: z.string(), contents: z.string() }),
  execute: async ({ path }) => ({ ok: true, path }),
});

/**
 * A two-step mock model: step 1 streams text + a writeFile tool-call (finish
 * 'tool-calls'); step 2 streams closing text (finish 'stop'). Per-step delay so
 * the run is observably in-flight when the bridge attaches.
 */
export function mockToolCallModel(stepDelayMs = 60): LanguageModel {
  let call = 0;
  return new MockLanguageModelV3({
    modelId: "mock-main",
    provider: "mock",
    doStream: (async () => {
      const n = call++;
      if (n === 0) {
        return {
          stream: new ReadableStream({
            async start(c) {
              c.enqueue({ type: "stream-start", warnings: [] });
              c.enqueue({ type: "text-start", id: "t0" });
              await sleep(stepDelayMs);
              c.enqueue({ type: "text-delta", id: "t0", delta: "Creating the file. " });
              c.enqueue({ type: "text-end", id: "t0" });
              c.enqueue({ type: "tool-input-start", id: "tc1", toolName: "writeFile" });
              c.enqueue({
                type: "tool-input-delta",
                id: "tc1",
                delta: '{"path":"app.tsx","contents":"x"}',
              });
              c.enqueue({ type: "tool-input-end", id: "tc1" });
              c.enqueue({
                type: "tool-call",
                toolCallId: "tc1",
                toolName: "writeFile",
                input: '{"path":"app.tsx","contents":"x"}',
              });
              c.enqueue({
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
              });
              c.close();
            },
          }),
        };
      }
      return {
        stream: new ReadableStream({
          async start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t1" });
            await sleep(stepDelayMs);
            c.enqueue({ type: "text-delta", id: "t1", delta: "Done." });
            c.enqueue({ type: "text-end", id: "t1" });
            c.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
            });
            c.close();
          },
        }),
      };
    }) as never,
  });
}

export interface RunRecorder {
  commits: Array<{ branch: string; message: string; runId: string }>;
  usages: Array<{ runId: string; usage: { inputTokens: number; outputTokens: number } }>;
}

export function makeRecorder(): RunRecorder {
  return { commits: [], usages: [] };
}

export function makeAgentRunDeps(
  db: RunDB & TranscriptDB,
  streamCtx: AgentRunDeps["streamCtx"],
  model: LanguageModel,
  recorder: RunRecorder,
): AgentRunDeps {
  return {
    db,
    streamCtx,
    buildModel: () => model,
    system: "You are a test agent.",
    resolveSandbox: async () => ({ ensureHydrated: async () => undefined }),
    buildTools: () => ({ writeFile: writeFileTool }),
    gitCommit: async ({ branch, message, runId }) => {
      recorder.commits.push({ branch, message, runId });
    },
    recordUsage: async ({ runId, usage }) => {
      recorder.usages.push({ runId, usage });
    },
    maxSteps: 5,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child() {
        return this;
      },
    },
  };
}

/** Two resumable-stream contexts on the same redis: worker (publish) + bridge (resume). */
export function makeContexts(redisUrl: string): {
  workerCtx: ReturnType<typeof createStreamContext>;
  bridgeCtx: ReturnType<typeof createStreamContext>;
  close: () => Promise<void>;
} {
  const workerCtx = createStreamContext(redisUrl);
  const bridgeCtx = createStreamContext(redisUrl);
  return {
    workerCtx,
    bridgeCtx,
    close: async () => {
      await workerCtx.close();
      await bridgeCtx.close();
    },
  };
}

/** Concatenate up to `max` chunks read from a string stream (or until done). */
export async function readUpTo(
  stream: ReadableStream<string>,
  max = Infinity,
): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  let n = 0;
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        out += value;
        n++;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return out;
}
