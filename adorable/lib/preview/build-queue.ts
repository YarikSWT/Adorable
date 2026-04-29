// In-memory BuildQueue — singleton в процессе builder'а.
//
// Контракт: docs/preview-provider/CONTRACTS.md §7.
// State machine: docs/preview-provider/BUILD_PIPELINE.md §3.
//
// Инвариант: на каждый projectId max 1 running + 1 queued.
// При новом enqueue:
//   - нет running          → новый job становится running (started immediately).
//   - running, нет queued  → cancel running, новый становится queued.
//   - running + queued     → старый queued получает event {status:"superseded"},
//                             новый job заменяет его в queued.
// При завершении running:
//   - emit финальный event ({succeeded|failed|cancelled}).
//   - если queued есть — promote (становится running).
//
// runJob — DI: BuildQueue не знает про PreviewProvider, чтобы не было
// циклической зависимости. Производственный код передаёт closure,
// тесты — mock.

import { randomUUID } from "node:crypto";

import type {
  BuildEvent,
  BuildJob,
  BuildJobStatus,
  BuildOptions,
  BuildQueue,
  BuildResult,
} from "@/lib/adapters/preview";
import type { AuditLogger } from "@/lib/sandbox/audit-log";

export interface RunJobInput {
  job: BuildJob;
  signal: AbortSignal;
}

export type RunJobFn = (input: RunJobInput) => Promise<BuildResult>;

export interface InMemoryBuildQueueOptions {
  runJob: RunJobFn;
  /** Override now() для детерминизма в тестах. */
  now?: () => string;
  /**
   * Optional audit logger. When provided, queue emits build_* events
   * (BUILD_PIPELINE §9). Default: not logged. Production singleton wires
   * getSharedAuditLogger().
   */
  auditLogger?: AuditLogger;
}

interface RunningEntry {
  job: BuildJob;
  abortCtrl: AbortController;
}

const cancelledResult = (): BuildResult => ({
  status: "cancelled",
  exitCode: -1,
  durationMs: 0,
  wasSwapped: false,
  errors: [],
  warnings: [],
  stdout: "",
  stderr: "",
});

const failedResult = (message: string): BuildResult => ({
  status: "failed",
  exitCode: -1,
  durationMs: 0,
  wasSwapped: false,
  errors: [{ code: "unknown", message }],
  warnings: [],
  stdout: "",
  stderr: "",
});

export const createInMemoryBuildQueue = (
  options: InMemoryBuildQueueOptions,
): BuildQueue => {
  const runJob = options.runJob;
  const now = options.now ?? (() => new Date().toISOString());
  const audit = options.auditLogger;
  const fireAndForget = (p: Promise<unknown>): void => {
    p.catch(() => undefined);
  };

  const running = new Map<string, RunningEntry>();
  const queued = new Map<string, BuildJob>();
  const listeners = new Map<string, Set<(event: BuildEvent) => void>>();

  const emit = (event: BuildEvent): void => {
    const set = listeners.get(event.projectId);
    if (!set || set.size === 0) return;
    // Snapshot чтобы listener'ы могли unsubscribe внутри callback'а.
    for (const l of Array.from(set)) {
      try {
        l(event);
      } catch (err) {
        // Listener'ы не должны валить queue.
        process.stderr.write(
          `build-queue: listener threw — ${(err as Error).message}\n`,
        );
      }
    }
  };

  const promote = (job: BuildJob): void => {
    const ts = now();
    job.status = "running";
    job.startedAt = ts;
    const abortCtrl = new AbortController();
    running.set(job.projectId, { job, abortCtrl });
    emit({
      jobId: job.jobId,
      projectId: job.projectId,
      status: "running",
      at: ts,
    });
    if (audit) {
      fireAndForget(
        audit.log({
          event: "build_started",
          ts,
          jobId: job.jobId,
          projectId: job.projectId,
        }),
      );
    }

    void runJob({ job, signal: abortCtrl.signal })
      .catch((err: Error) => failedResult(`runJob threw: ${err.message}`))
      .then((result) => {
        // Final event resolution. Если был abort, считаем cancelled даже
        // если runJob вернул succeeded (race between cancel and completion).
        let finalStatus: BuildJobStatus = result.status;
        if (abortCtrl.signal.aborted && result.status !== "cancelled") {
          finalStatus = "cancelled";
        }
        const finalTs = now();
        job.status = finalStatus;
        job.finishedAt = finalTs;
        job.result =
          finalStatus === "cancelled" && result.status !== "cancelled"
            ? cancelledResult()
            : result;
        running.delete(job.projectId);
        emit({
          jobId: job.jobId,
          projectId: job.projectId,
          status: finalStatus,
          result: job.result,
          at: finalTs,
        });
        if (audit) {
          fireAndForget(
            audit.log({
              event: "build_finished",
              ts: finalTs,
              jobId: job.jobId,
              projectId: job.projectId,
              status: finalStatus,
              exitCode: job.result.exitCode,
              durationMs: job.result.durationMs,
              errorsCount: job.result.errors.length,
            }),
          );
        }
        // Promote queued if any.
        const next = queued.get(job.projectId);
        if (next) {
          queued.delete(job.projectId);
          promote(next);
        }
      });
  };

  const queue: BuildQueue = {
    async enqueue(opts: { projectId: string; reason: BuildOptions["reason"] }) {
      const newJob: BuildJob = {
        jobId: randomUUID(),
        projectId: opts.projectId,
        reason: opts.reason,
        status: "queued",
        enqueuedAt: now(),
      };

      const isRunning = running.has(opts.projectId);
      const isQueued = queued.has(opts.projectId);

      const auditEnqueued = (queueDepth: number, replacedJobId?: string): void => {
        if (!audit) return;
        fireAndForget(
          audit.log({
            event: "build_enqueued",
            ts: newJob.enqueuedAt,
            jobId: newJob.jobId,
            projectId: opts.projectId,
            reason: opts.reason,
            queueDepth,
            ...(replacedJobId ? { replacedJobId } : {}),
          }),
        );
      };

      if (!isRunning && !isQueued) {
        auditEnqueued(0);
        // Synchronously promote so caller's awaiters see "running" state.
        promote(newJob);
        return { jobId: newJob.jobId, status: "running" as BuildJobStatus };
      }

      if (isRunning && !isQueued) {
        auditEnqueued(1);
        // Cancel running, queue new.
        const runningEntry = running.get(opts.projectId)!;
        runningEntry.abortCtrl.abort();
        if (audit) {
          fireAndForget(
            audit.log({
              event: "build_cancelled",
              ts: now(),
              jobId: runningEntry.job.jobId,
              projectId: opts.projectId,
              reason: "superseded",
            }),
          );
        }
        queued.set(opts.projectId, newJob);
        emit({
          jobId: newJob.jobId,
          projectId: opts.projectId,
          status: "queued",
          at: now(),
        });
        return { jobId: newJob.jobId, status: "queued" as BuildJobStatus };
      }

      // running + queued → supersede the old queued.
      const oldQueued = queued.get(opts.projectId)!;
      auditEnqueued(2, oldQueued.jobId);
      const ts = now();
      emit({
        jobId: oldQueued.jobId,
        projectId: opts.projectId,
        status: "superseded",
        at: ts,
      });
      if (audit) {
        fireAndForget(
          audit.log({
            event: "build_cancelled",
            ts,
            jobId: oldQueued.jobId,
            projectId: opts.projectId,
            reason: "superseded",
          }),
        );
      }
      queued.set(opts.projectId, newJob);
      emit({
        jobId: newJob.jobId,
        projectId: opts.projectId,
        status: "queued",
        at: ts,
      });
      return { jobId: newJob.jobId, status: "queued" as BuildJobStatus };
    },

    async cancel(projectId: string) {
      const run = running.get(projectId);
      if (run) {
        run.abortCtrl.abort();
        if (audit) {
          fireAndForget(
            audit.log({
              event: "build_cancelled",
              ts: now(),
              jobId: run.job.jobId,
              projectId,
              reason: "destroy",
            }),
          );
        }
      }
      const queuedJob = queued.get(projectId);
      if (queuedJob) {
        const ts = now();
        emit({
          jobId: queuedJob.jobId,
          projectId,
          status: "superseded",
          at: ts,
        });
        if (audit) {
          fireAndForget(
            audit.log({
              event: "build_cancelled",
              ts,
              jobId: queuedJob.jobId,
              projectId,
              reason: "destroy",
            }),
          );
        }
        queued.delete(projectId);
      }
    },

    getActive(projectId: string): BuildJob | null {
      return running.get(projectId)?.job ?? null;
    },

    getQueued(projectId: string): BuildJob | null {
      return queued.get(projectId) ?? null;
    },

    subscribe(
      projectId: string,
      listener: (event: BuildEvent) => void,
    ): () => void {
      let set = listeners.get(projectId);
      if (!set) {
        set = new Set();
        listeners.set(projectId, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
      };
    },
  };

  return queue;
};
