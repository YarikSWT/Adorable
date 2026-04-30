#!/usr/bin/env node
// bench-static-build.ts — load test for STATIC_MODE_REMAINING #10.
//
// What it does:
//   1. POST /api/projects/<id>/rebuild N times against a running adorable
//      instance (sequentially or with limited concurrency).
//   2. Wait for each build_finished event by polling the SSE endpoint.
//   3. Read the audit log and extract build_finished events that landed
//      during the bench window.
//   4. Print p50 / p95 / p99 / mean / success-rate to stdout, optionally
//      also as JSON for machine parsing.
//
// Usage:
//   npx tsx scripts/bench-static-build.ts \
//     --project <projectId> \
//     --base-url http://localhost:3000 \
//     --audit-log /var/log/adorable/audit.log \
//     --iterations 100 \
//     [--concurrency 1] \
//     [--json]
//
// Notes:
//   - The script does NOT create projects. The caller must hand it a
//     projectId of an already-existing static-mode project.
//   - We re-read the audit log AFTER all rebuilds finish (rather than
//     subscribing to SSE for each one) — staging has the audit log
//     persisted to disk, and re-reading it once is simpler and more
//     robust than coordinating N SSE subscriptions.
//   - Pure analysis is in `lib/bench/percentiles.ts` so the math is
//     unit-tested independently of the script.

import { readFile } from "node:fs/promises";

import {
  filterByTimeRange,
  parseBuildFinishedFromAuditLog,
  summarise,
  type PercentileSummary,
} from "@/lib/bench/percentiles";

interface CliArgs {
  projectId: string;
  baseUrl: string;
  auditLogPath: string;
  iterations: number;
  concurrency: number;
  emitJson: boolean;
}

const HELP = `bench-static-build — measure p50/p95 of static-mode builds.

Required:
  --project <id>       projectId of an existing static-mode project
  --audit-log <path>   path to the audit JSONL log

Optional:
  --base-url <url>     adorable instance base URL (default http://localhost:3000)
  --iterations <n>     number of rebuild requests to fire (default 50)
  --concurrency <n>    max in-flight rebuilds (default 1 — sequential)
  --json               emit summary as JSON in addition to the table
  --help               show this message

Example:
  npx tsx scripts/bench-static-build.ts \\
    --project p-abc123 \\
    --audit-log /var/log/adorable/audit.log \\
    --iterations 100
`;

const printHelpAndExit = (code: number): never => {
  process.stdout.write(HELP);
  process.exit(code);
};

const parseArgs = (argv: string[]): CliArgs => {
  let projectId = "";
  let baseUrl = "http://localhost:3000";
  let auditLogPath = "";
  let iterations = 50;
  let concurrency = 1;
  let emitJson = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") printHelpAndExit(0);
    else if (a === "--json") emitJson = true;
    else if (a === "--project") projectId = argv[++i] ?? "";
    else if (a === "--base-url") baseUrl = argv[++i] ?? baseUrl;
    else if (a === "--audit-log") auditLogPath = argv[++i] ?? "";
    else if (a === "--iterations")
      iterations = Number.parseInt(argv[++i] ?? "0", 10);
    else if (a === "--concurrency")
      concurrency = Number.parseInt(argv[++i] ?? "0", 10);
    else {
      process.stderr.write(`bench-static-build: unknown arg ${a}\n`);
      printHelpAndExit(1);
    }
  }
  if (!projectId) {
    process.stderr.write("bench-static-build: --project is required\n");
    printHelpAndExit(2);
  }
  if (!auditLogPath) {
    process.stderr.write("bench-static-build: --audit-log is required\n");
    printHelpAndExit(2);
  }
  if (!Number.isFinite(iterations) || iterations <= 0) {
    process.stderr.write(
      "bench-static-build: --iterations must be a positive integer\n",
    );
    printHelpAndExit(2);
  }
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    process.stderr.write(
      "bench-static-build: --concurrency must be a positive integer\n",
    );
    printHelpAndExit(2);
  }
  return { projectId, baseUrl, auditLogPath, iterations, concurrency, emitJson };
};

interface RebuildRequestResult {
  jobId: string;
  status: string;
}

const fireRebuild = async (
  baseUrl: string,
  projectId: string,
): Promise<RebuildRequestResult> => {
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/rebuild`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`POST ${url} → ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as RebuildRequestResult;
  return body;
};

// Wait for a specific jobId to reach a terminal status by polling the
// SSE endpoint. We do *not* parse the SSE stream — `/api/projects/<id>
// /build-status` returns the LATEST snapshot in the first message,
// which is sufficient and avoids juggling EventSource. Polls every
// 200 ms, gives up after 5 minutes per build (well above the 2-min
// hard timeout BUILD_RUNNER_TIMEOUT_MS).
const waitForJobFinish = async (
  baseUrl: string,
  projectId: string,
  jobId: string,
  abortSignal: AbortSignal,
): Promise<void> => {
  const deadline = Date.now() + 5 * 60_000;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/build-status`;
  while (Date.now() < deadline) {
    if (abortSignal.aborted) throw new Error("aborted");
    let text: string;
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: abortSignal,
      });
      // We only need the first chunk — close immediately after read.
      const reader = res.body?.getReader();
      if (!reader) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      const { value } = await reader.read();
      reader.cancel().catch(() => undefined);
      text = new TextDecoder().decode(value ?? new Uint8Array());
    } catch {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    // Look for `"jobId":"<id>"` and a terminal status keyword in the
    // first SSE chunk. Cheap string match — full parse not needed.
    if (text.includes(`"jobId":"${jobId}"`)) {
      if (
        text.includes("\"status\":\"succeeded\"") ||
        text.includes("\"status\":\"failed\"") ||
        text.includes("\"status\":\"cancelled\"")
      ) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`waitForJobFinish: ${jobId} did not finish within 5min`);
};

const runBatch = async (args: CliArgs): Promise<{ since: Date; until: Date }> => {
  const since = new Date();
  const ac = new AbortController();
  let firedCount = 0;

  // Run with a simple concurrency limiter — pull next iteration off a
  // shared counter from each worker.
  const next = (): number =>
    firedCount < args.iterations ? ++firedCount : 0;

  const worker = async (): Promise<void> => {
    let n = next();
    while (n > 0) {
      const job = await fireRebuild(args.baseUrl, args.projectId);
      await waitForJobFinish(args.baseUrl, args.projectId, job.jobId, ac.signal);
      process.stderr.write(
        `bench: ${n}/${args.iterations} done (jobId=${job.jobId})\n`,
      );
      n = next();
    }
  };

  try {
    const workers: Promise<void>[] = [];
    for (let i = 0; i < args.concurrency; i++) workers.push(worker());
    await Promise.all(workers);
  } catch (err) {
    ac.abort();
    throw err;
  }
  const until = new Date();
  return { since, until };
};

const formatMs = (n: number): string =>
  Number.isFinite(n) ? `${Math.round(n)}ms` : "—";

const printTable = (s: PercentileSummary): void => {
  const lines = [
    `count          ${s.count}`,
    `success rate   ${(s.successRate * 100).toFixed(1)}% (${s.successCount}/${s.count})`,
    `min            ${formatMs(s.min)}`,
    `p50            ${formatMs(s.p50)}`,
    `p95            ${formatMs(s.p95)}`,
    `p99            ${formatMs(s.p99)}`,
    `max            ${formatMs(s.max)}`,
    `mean           ${formatMs(s.mean)}`,
  ];
  for (const l of lines) process.stdout.write(`${l}\n`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `bench-static-build: ${args.iterations} rebuilds against ${args.baseUrl}, project=${args.projectId}, concurrency=${args.concurrency}\n`,
  );

  const { since, until } = await runBatch(args);

  // Read the audit log AFTER the bench window closes, then narrow to
  // build_finished events that ts'd inside the bench window.
  const auditText = await readFile(args.auditLogPath, "utf8");
  const allFinished = parseBuildFinishedFromAuditLog(auditText);
  const inWindow = filterByTimeRange(allFinished, since, until);

  const summary = summarise(inWindow);
  printTable(summary);
  if (args.emitJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
};

void main().catch((err: Error) => {
  process.stderr.write(`bench-static-build: ${err.message}\n`);
  process.exit(1);
});
