#!/usr/bin/env node
// audit-summary.ts — quick triage view of an adorable audit log.
//
// Used during incident response and as the data source for staging
// acceptance checks (STATIC_MODE_REMAINING #11). Reads a JSONL audit
// log file (or stdin), optionally filters by time window, prints a
// counter table + actionable alert evaluation.
//
// Usage:
//   npx tsx scripts/audit-summary.ts --file /var/log/adorable/audit.log
//   npx tsx scripts/audit-summary.ts --file audit.log --since '2026-04-30T07:00:00Z' --until '2026-04-30T08:00:00Z'
//   tail -n 1000 audit.log | npx tsx scripts/audit-summary.ts --stdin
//   npx tsx scripts/audit-summary.ts --file audit.log --json

import { readFile } from "node:fs/promises";

import {
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  summariseAudit,
} from "@/lib/bench/audit-summary";

interface CliArgs {
  file: string | null;
  fromStdin: boolean;
  since?: Date;
  until?: Date;
  emitJson: boolean;
}

const HELP = `audit-summary — counter table + alerts for an audit JSONL log.

Input (one of):
  --file <path>        read the audit log from a file
  --stdin              read the audit log from stdin

Optional:
  --since <iso>        only include events at or after this ts
  --until <iso>        only include events at or before this ts
  --json               emit summary + alerts as JSON in addition to the table
  --help               show this message
`;

const printHelpAndExit = (code: number): never => {
  process.stdout.write(HELP);
  process.exit(code);
};

const parseDate = (raw: string, name: string): Date => {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    process.stderr.write(`audit-summary: ${name} is not a valid ISO date: ${raw}\n`);
    process.exit(2);
  }
  return d;
};

const parseArgs = (argv: string[]): CliArgs => {
  let file: string | null = null;
  let fromStdin = false;
  let since: Date | undefined;
  let until: Date | undefined;
  let emitJson = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") printHelpAndExit(0);
    else if (a === "--json") emitJson = true;
    else if (a === "--stdin") fromStdin = true;
    else if (a === "--file") file = argv[++i] ?? null;
    else if (a === "--since") since = parseDate(argv[++i] ?? "", "--since");
    else if (a === "--until") until = parseDate(argv[++i] ?? "", "--until");
    else {
      process.stderr.write(`audit-summary: unknown arg ${a}\n`);
      printHelpAndExit(1);
    }
  }
  if (!file && !fromStdin) {
    process.stderr.write("audit-summary: --file or --stdin is required\n");
    printHelpAndExit(2);
  }
  if (file && fromStdin) {
    process.stderr.write("audit-summary: pass either --file or --stdin, not both\n");
    printHelpAndExit(2);
  }
  return { file, fromStdin, since, until, emitJson };
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const PAD = 30;
const fmt = (k: string, v: string | number): string =>
  `${k.padEnd(PAD)}${v}`;

const printTable = (
  summary: ReturnType<typeof summariseAudit>,
  alerts: ReturnType<typeof evaluateAlerts>,
): void => {
  process.stdout.write("=== Audit summary ===\n");
  process.stdout.write(fmt("totalLines", summary.totalLines) + "\n");
  process.stdout.write(fmt("parsedLines", summary.parsedLines) + "\n");
  process.stdout.write(fmt("malformedLines", summary.malformedLines) + "\n");
  if (summary.firstTs)
    process.stdout.write(fmt("first ts", summary.firstTs) + "\n");
  if (summary.lastTs)
    process.stdout.write(fmt("last ts", summary.lastTs) + "\n");
  process.stdout.write("\n--- builds ---\n");
  process.stdout.write(fmt("started", summary.buildsStarted) + "\n");
  process.stdout.write(fmt("finished", summary.buildsFinished) + "\n");
  process.stdout.write(fmt("succeeded", summary.buildsSucceeded) + "\n");
  process.stdout.write(fmt("failed", summary.buildsFailed) + "\n");
  process.stdout.write(fmt("cancelled", summary.buildsCancelled) + "\n");
  process.stdout.write(
    fmt("killedByTimeout", summary.buildsKilledByTimeout) + "\n",
  );
  process.stdout.write(
    fmt(
      "successRate",
      Number.isFinite(summary.buildSuccessRate)
        ? `${(summary.buildSuccessRate * 100).toFixed(1)}%`
        : "—",
    ) + "\n",
  );
  process.stdout.write("\n--- security / rejections ---\n");
  process.stdout.write(fmt("path_rejected", summary.pathRejected) + "\n");
  process.stdout.write(fmt("upload_rejected", summary.uploadRejected) + "\n");
  process.stdout.write(fmt("auth_denied", summary.authDenied) + "\n");

  process.stdout.write("\n--- event-type histogram ---\n");
  const sorted = Object.entries(summary.eventTypeCounts).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [k, v] of sorted) {
    process.stdout.write(fmt(`  ${k}`, v) + "\n");
  }

  process.stdout.write("\n--- alerts ---\n");
  if (alerts.alerts.length === 0) {
    process.stdout.write("  (no alerts)\n");
  } else {
    for (const a of alerts.alerts) {
      const tag = a.severity === "page" ? "PAGE" : "WARN";
      process.stdout.write(`  [${tag}] ${a.key}: ${a.message}\n`);
    }
  }
  process.stdout.write(
    `\nshouldPage: ${alerts.shouldPage ? "YES" : "no"}\n`,
  );
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const text = args.file ? await readFile(args.file, "utf8") : await readStdin();
  const summary = summariseAudit(text, {
    ...(args.since ? { since: args.since } : {}),
    ...(args.until ? { until: args.until } : {}),
  });
  const alerts = evaluateAlerts(summary, DEFAULT_THRESHOLDS);
  printTable(summary, alerts);
  if (args.emitJson) {
    process.stdout.write(`${JSON.stringify({ summary, alerts }, null, 2)}\n`);
  }
  // Exit code 10 so this can wire into shell-based monitoring loops.
  // process.exitCode (vs process.exit) lets buffered stdout flush
  // before the process actually quits — important for the --json
  // path where the payload can be a few KB.
  if (alerts.shouldPage) process.exitCode = 10;
};

void main().catch((err: Error) => {
  process.stderr.write(`audit-summary: ${err.message}\n`);
  process.exit(1);
});
