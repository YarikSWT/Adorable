#!/usr/bin/env node
// Bulk-migrate RepoMetadata for repos created before Phase 4.
//
// Source: docs/preview-provider/MIGRATION_PATH.md §5.
//
// Backfills boilerplateVersion + preview block on every wrapper repo
// in Gitea that lacks them. NEVER switches a project's provider —
// that's a separate manual operation.
//
// Run from adorable/:
//   npx tsx scripts/migrate-repo-metadata.ts                # apply
//   npx tsx scripts/migrate-repo-metadata.ts --dry-run      # preview
//   npx tsx scripts/migrate-repo-metadata.ts --limit 10     # batch

import { getGitProvider } from "@/lib/git/provider-singleton";
import { getPreviewProvider } from "@/lib/preview/provider-singleton";
import { readBoilerplateVersion } from "@/lib/preview/boilerplate-version";
import { runMetadataMigration } from "@/lib/preview/migrate-metadata-runner";
import { getSharedAuditLogger } from "@/lib/sandbox/audit-log";

interface CliArgs {
  dryRun: boolean;
  limit: number;
}

const parseArgs = (argv: string[]): CliArgs => {
  let dryRun = false;
  let limit = Number.POSITIVE_INFINITY;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if ((a === "--limit" || a === "-n") && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(n) && n > 0) limit = n;
      i++;
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      printHelpAndExit(2);
    }
  }
  return { dryRun, limit };
};

const printHelpAndExit = (code: number): never => {
  console.log(`migrate-repo-metadata — backfill boilerplateVersion + preview

usage: npx tsx scripts/migrate-repo-metadata.ts [--dry-run] [--limit N]

  --dry-run       Print intended changes without writing.
  --limit, -n     Cap on number of repos to process (default: all).
`);
  process.exit(code);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const provider = await getGitProvider();
  const previewProvider = await getPreviewProvider();
  const boilerplateVersion = await readBoilerplateVersion();

  console.log(
    `migrate-repo-metadata: provider=${previewProvider.name} boilerplate=${boilerplateVersion}${args.dryRun ? " (DRY RUN)" : ""}`,
  );

  const report = await runMetadataMigration({
    provider,
    migrate: {
      boilerplateVersion,
      provider: previewProvider.name,
      capabilities: previewProvider.capabilities,
    },
    dryRun: args.dryRun,
    limit: args.limit,
    log: (m) => console.log(m),
    auditLogger: getSharedAuditLogger(),
  });

  console.log("---");
  console.log(
    `inspected=${report.inspected} changed=${report.changed} skipped=${report.skipped} errored=${report.errored}`,
  );
  if (report.errored > 0) process.exit(1);
};

void main().catch((err: Error) => {
  console.error(`migrate-repo-metadata: ${err.message}`);
  process.exit(1);
});
