// Handler of one agent run (спец v2.1 §5.2) — Phase 3 core (happy path + early
// publish + drain + idempotent persistence). Cancel/heartbeat-reaper/quota are
// layered on in Phases 4-6; the deps shape leaves room for them.
//
// Injectable deps keep the heavy sandbox/git/LLM out of tests: the worker
// entrypoint wires the real model + sandbox + git commit; tests pass a
// MockLanguageModelV3, a fake in-memory vm, and a recording gitCommit.

import {
  convertToModelMessages,
  generateId,
  stepCountIs,
  streamText,
  JsonToSseTransformStream,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { ResumableStreamContext } from "resumable-stream/ioredis";
import {
  loadConversationUIMessages,
  upsertAssistantMessage,
  type TranscriptDB,
} from "@/lib/db/queries/transcript";
import {
  clearActiveStream,
  finalizeRunCAS,
  loadRun,
  setActiveStream,
  touchHeartbeat,
  transitionRun,
  type RunDB,
} from "./run-state";
import {
  createComposedUiStream,
  drainStream,
} from "./stream";
import type { AgentRunJob } from "./queue";
import { createLogger, type Logger } from "./logger";

export const MAX_TOTAL_STEPS = 10;
export const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

/** Minimal sandbox contract the handler needs (fake in tests, real in prod). */
export interface SandboxLike {
  ensureHydrated: () => Promise<void>;
}

export interface AgentRunDeps {
  db: RunDB & TranscriptDB;
  streamCtx: ResumableStreamContext;
  /** Resolve the LLM for a modelKey. */
  buildModel: (modelKey: string) => LanguageModel;
  system?: string;
  /** Resolve (cold-start) the project's sandbox. */
  resolveSandbox?: (args: {
    projectId: string;
    userId: string;
  }) => Promise<SandboxLike>;
  /** Build the agent tools against the sandbox. */
  buildTools?: (vm: SandboxLike) => ToolSet;
  /** Commit the workspace: completed→main, otherwise→draft branch. */
  gitCommit?: (args: {
    branch: string;
    message: string;
    vm: SandboxLike | undefined;
    runId: string;
  }) => Promise<void>;
  /** Reconcile usage/reservation (Phase 6 fills the real impl). */
  recordUsage?: (args: {
    runId: string;
    usage: { inputTokens: number; outputTokens: number };
  }) => Promise<void>;
  /** Release the quota reservation (cancel/step-0 paths). */
  releaseReservation?: (runId: string) => Promise<void>;
  /** Poll for the Redis cancel flag (Phase 5). Returns true to abort. */
  cancelChecker?: (runId: string) => Promise<boolean>;
  /** Clear the cancel flag on terminal (Phase 5). */
  onCancelClear?: (runId: string) => Promise<void>;
  /** Cancel-flag poll interval (default 5s). */
  cancelPollMs?: number;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  logger?: Logger;
}

export interface AgentRunOutcome {
  terminal: "completed" | "failed" | "cancelled";
  streamId: string | null;
  usage: { inputTokens: number; outputTokens: number };
  stepCount: number;
  finalized: boolean;
}

function classifyTerminal(err: unknown): "failed" | "cancelled" {
  const msg = err instanceof Error ? err.message : String(err);
  if (/cancel|abort/i.test(msg)) return "cancelled";
  return "failed";
}

/**
 * Run one agent turn. Publishes its UIMessage stream to Redis BEFORE heavy
 * hydration (so the bridge attaches in <1s), drains it explicitly (so usage
 * resolves), then persists the assistant message idempotently and finalizes via
 * CAS. Never throws (retryLimit:0, fail-fast).
 */
export async function handleAgentRun(
  data: AgentRunJob,
  deps: AgentRunDeps,
): Promise<AgentRunOutcome> {
  const log = deps.logger ?? createLogger({ service: "agent-worker" });
  const { runId, userId, projectId, conversationId, modelKey } = data;
  const { db, streamCtx } = deps;

  // step-0 cancel (спец §5.2): a cancel flag set while queued → finalize fully
  // (CAS + release + clear) so the quota reservation doesn't leak.
  if (deps.cancelChecker && (await deps.cancelChecker(runId))) {
    const ok = await finalizeRunCAS(db, runId, {
      expectStatusIn: ["queued", "cancelling"],
      status: "cancelled",
      finishedAt: new Date(),
    });
    if (ok) {
      if (deps.recordUsage)
        await deps.recordUsage({ runId, usage: ZERO_USAGE }).catch(() => undefined);
      if (deps.releaseReservation)
        await deps.releaseReservation(runId).catch(() => undefined);
      await clearActiveStream(db, runId);
      if (deps.onCancelClear)
        await deps.onCancelClear(runId).catch(() => undefined);
    }
    return {
      terminal: "cancelled",
      streamId: null,
      usage: ZERO_USAGE,
      stepCount: 0,
      finalized: ok,
    };
  }

  // queued → running (atomic). If not queued anymore, exit silently.
  const run = await transitionRun(db, runId, "queued", "running", {
    startedAt: new Date(),
  });
  if (!run) {
    return {
      terminal: "failed",
      streamId: null,
      usage: ZERO_USAGE,
      stepCount: 0,
      finalized: false,
    };
  }

  const heartbeat = setInterval(() => {
    void touchHeartbeat(db, runId).catch(() => undefined);
  }, 10_000);

  // Cancel: abort streamText when the flag appears (or an external signal fires).
  const abort = new AbortController();
  if (deps.abortSignal) {
    if (deps.abortSignal.aborted) abort.abort();
    else
      deps.abortSignal.addEventListener("abort", () => abort.abort(), {
        once: true,
      });
  }
  let cancelPoll: ReturnType<typeof setInterval> | undefined;
  if (deps.cancelChecker) {
    cancelPoll = setInterval(() => {
      void deps
        .cancelChecker!(runId)
        .then((c) => {
          if (c) abort.abort(new Error("cancelled-by-user"));
        })
        .catch(() => undefined);
    }, deps.cancelPollMs ?? 5_000);
  }

  let finalMessages: UIMessage[] | undefined;
  let usage = { ...ZERO_USAGE };
  let stepCount = 0;
  let terminal: "completed" | "failed" | "cancelled" = "failed";
  let lastError: string | undefined;
  let vm: SandboxLike | undefined;
  const streamId = generateId();

  try {
    // EARLY PUBLISH — before heavy hydration (no 20s race window).
    await setActiveStream(db, runId, streamId);
    const composed = createComposedUiStream();
    const sse = composed.stream.pipeThrough(new JsonToSseTransformStream());
    const producer = await streamCtx.createNewResumableStream(
      streamId,
      () => sse as ReadableStream<string>,
    );
    const drain = producer
      ? drainStream(producer)
      : Promise.resolve();

    // Heavy hydration with progress parts in the live stream.
    composed.pushWarmup({
      type: "data-progress",
      data: { stage: "sandbox", message: "Preparing environment…" },
      transient: true,
    } as unknown as UIMessageChunk);
    vm = deps.resolveSandbox
      ? await deps.resolveSandbox({ projectId, userId })
      : undefined;
    composed.pushWarmup({
      type: "data-progress",
      data: { stage: "hydrate", message: "Loading project…" },
      transient: true,
    } as unknown as UIMessageChunk);
    if (vm) await vm.ensureHydrated();

    const tools: ToolSet | undefined =
      deps.buildTools && vm ? deps.buildTools(vm) : undefined;
    const history = await loadConversationUIMessages(db, conversationId);
    const modelMessages = await convertToModelMessages(history);

    const result = streamText({
      model: deps.buildModel(modelKey),
      ...(deps.system ? { system: deps.system } : {}),
      messages: modelMessages,
      ...(tools ? { tools } : {}),
      stopWhen: stepCountIs(deps.maxSteps ?? MAX_TOTAL_STEPS),
      abortSignal: abort.signal,
    });

    const uiStream = result.toUIMessageStream({
      originalMessages: history,
      onFinish: ({ messages }) => {
        finalMessages = messages as UIMessage[];
      },
    });
    composed.switchToLlm(uiStream as ReadableStream<UIMessageChunk>);

    // Explicit drain: wait until the whole stream reached Redis.
    await drain;

    const u = await Promise.resolve(result.usage).catch(() => ({})); // resolves even on abort
    usage = {
      inputTokens: (u as { inputTokens?: number }).inputTokens ?? 0,
      outputTokens: (u as { outputTokens?: number }).outputTokens ?? 0,
    };
    try {
      stepCount = (await result.steps).length;
    } catch {
      stepCount = 0;
    }
    // An abort (cancel flag / external signal) wins even if the stream ended
    // gracefully — a real provider stops mid-generation, the mock closes early.
    terminal = abort.signal.aborted ? "cancelled" : "completed";
  } catch (err) {
    terminal = abort.signal.aborted ? "cancelled" : classifyTerminal(err);
    lastError = err instanceof Error ? err.message : String(err);
    if (terminal !== "cancelled") log.warn("agent-run error", { runId, err: lastError });
  } finally {
    // Persist transcript idempotently by runId (handler is authoritative).
    if (finalMessages?.length) {
      const assistant = [...finalMessages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (assistant) {
        await upsertAssistantMessage(db, {
          conversationId,
          runId,
          uiMessage: assistant,
        }).catch((e) => log.warn("upsert assistant failed", { err: String(e) }));
      }
    }

    // Commit code: completed→main, otherwise→draft branch.
    if (deps.gitCommit) {
      const branch =
        terminal === "completed" ? "main" : `draft/run-${runId.slice(0, 8)}`;
      await deps
        .gitCommit({
          branch,
          message: `${terminal}: run ${runId.slice(0, 8)}`,
          vm,
          runId,
        })
        .catch((e) => log.warn("git commit failed", { err: String(e) }));
    }

    // Usage reconcile in every branch (Phase 6 makes it idempotent+reservation).
    if (deps.recordUsage) {
      await deps
        .recordUsage({ runId, usage })
        .catch((e) => log.warn("recordUsage failed", { err: String(e) }));
    }
    // On cancel, release the reservation (idempotent by runId).
    if (terminal === "cancelled" && deps.releaseReservation) {
      await deps.releaseReservation(runId).catch(() => undefined);
    }

    const finalized = await finalizeRunCAS(db, runId, {
      expectStatusIn: ["running", "cancelling"],
      status: terminal,
      finishedAt: new Date(),
      tokenUsage: usage,
      stepCount,
      ...(terminal === "failed" && lastError
        ? { errorMessage: lastError }
        : {}),
    });
    if (finalized) {
      await clearActiveStream(db, runId);
      if (deps.onCancelClear) {
        await deps.onCancelClear(runId).catch(() => undefined);
      }
    }
    if (cancelPoll) clearInterval(cancelPoll);
    clearInterval(heartbeat);

    // eslint-disable-next-line no-unsafe-finally
    return {
      terminal,
      streamId,
      usage,
      stepCount,
      finalized,
    };
  }
}

/** Re-export for the worker entrypoint / GET routes. */
export { loadRun };
