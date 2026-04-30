#!/usr/bin/env node
// preflight-static.ts — pre-flip checks for STATIC_MODE_REMAINING #12.
//
// Runs the env + filesystem checks from `lib/preflight/checks.ts`
// against the live process environment + real fs. Intended for the
// operator who's about to flip `.env.example` PREVIEW_PROVIDER from
// "sandbox" to "static" or run batched migrate-repo-to-static.ts.
//
// Future expansion (gated on real infra access):
//   - Caddy admin API reachable
//   - Gitea API reachable
//   - Docker daemon reachable + build-runner image present
//   - adorable_node_modules_react_<version> volume populated
// These are not implemented in this commit because the loop env
// has no docker/caddy/gitea — the pure check structure makes them
// straightforward to add once staging infra is available.
//
// Usage:
//   npx tsx scripts/preflight-static.ts
//   npx tsx scripts/preflight-static.ts --json
//
// Exit codes:
//   0 — all green (or only "warn"); safe to proceed.
//   1 — one or more "fail" results; fix before flipping default.

import { runStaticPreflight, type CheckResult } from "@/lib/preflight/checks";

interface CliArgs {
  emitJson: boolean;
  includeNetworkChecks: boolean;
}

const HELP = `preflight-static — pre-flip readiness check for static-mode preview.

Optional:
  --network    also probe Caddy admin + Gitea API endpoints
               (off by default — needs the rest of the stack up)
  --json       emit the report as JSON in addition to the table
  --help       show this message

Exit codes:
  0  all green or only warnings — safe to flip PREVIEW_PROVIDER=static
  1  one or more fails — fix listed remediations first
`;

const printHelpAndExit = (code: number): never => {
  process.stdout.write(HELP);
  process.exit(code);
};

const parseArgs = (argv: string[]): CliArgs => {
  let emitJson = false;
  let includeNetworkChecks = false;
  for (const a of argv) {
    if (a === "--help" || a === "-h") printHelpAndExit(0);
    else if (a === "--json") emitJson = true;
    else if (a === "--network") includeNetworkChecks = true;
    else {
      process.stderr.write(`preflight-static: unknown arg ${a}\n`);
      printHelpAndExit(1);
    }
  }
  return { emitJson, includeNetworkChecks };
};

const TAG: Record<CheckResult["severity"], string> = {
  ok: "OK  ",
  warn: "WARN",
  fail: "FAIL",
};

const printTable = (results: readonly CheckResult[]): void => {
  process.stdout.write("=== Static-mode preflight ===\n");
  for (const r of results) {
    process.stdout.write(`[${TAG[r.severity]}] ${r.name.padEnd(28)} ${r.message}\n`);
    if (r.severity !== "ok" && r.remediation) {
      process.stdout.write(`        ${r.remediation}\n`);
    }
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const report = await runStaticPreflight({
    env: process.env,
    includeNetworkChecks: args.includeNetworkChecks,
  });
  printTable(report.results);
  process.stdout.write(
    `\nresult: passed=${report.passed} warned=${report.warned} failed=${report.failed}\n`,
  );
  if (args.emitJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  if (report.failed > 0) process.exitCode = 1;
};

void main().catch((err: Error) => {
  process.stderr.write(`preflight-static: ${err.message}\n`);
  process.exit(1);
});
