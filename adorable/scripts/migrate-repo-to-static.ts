#!/usr/bin/env node
// Per-project migration: switch a wrapper repo from sandbox to static.
//
// Source: docs/preview-provider/MIGRATION_PATH.md §5.
//
// Usage:
//   npx tsx scripts/migrate-repo-to-static.ts <wrapper-repo-id>
//   npx tsx scripts/migrate-repo-to-static.ts <wrapper-repo-id> --dry-run
//
// What it does:
//   1. Reads the wrapper's metadata.json from Gitea.
//   2. Destroys the existing sandbox (best-effort).
//   3. Creates the static preview environment (scratch dir, Caddy
//      file_server route).
//   4. Updates metadata.preview.provider="static" + capabilities=STATIC,
//      synthesizes new vm field, pins boilerplateVersion.
//   5. Writes the new metadata back to Gitea (unless --dry-run).
//
// Does NOT trigger an initial build — chat onFinish or a manual rebuild
// will pick that up next turn.

import { createSandboxProvider } from "@/lib/adapters/sandbox";
import { createPreviewProvider } from "@/lib/adapters/preview";
import { readBoilerplateVersion } from "@/lib/preview/boilerplate-version";
import { migrateRepoToStatic } from "@/lib/preview/migrate-to-static";
import { readRepoMetadata, writeRepoMetadata } from "@/lib/repo-storage";

interface CliArgs {
  repoId: string;
  dryRun: boolean;
}

const parseArgs = (argv: string[]): CliArgs => {
  let repoId = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--help" || a === "-h") printHelpAndExit(0);
    else if (a.startsWith("-")) {
      console.error(`unknown flag: ${a}`);
      printHelpAndExit(2);
    } else if (!repoId) {
      repoId = a;
    } else {
      console.error(`unexpected positional argument: ${a}`);
      printHelpAndExit(2);
    }
  }
  if (!repoId) {
    console.error("missing required <wrapper-repo-id> argument");
    printHelpAndExit(2);
  }
  return { repoId, dryRun };
};

const printHelpAndExit = (code: number): never => {
  console.log(`migrate-repo-to-static — switch a wrapper repo from sandbox to static

usage: npx tsx scripts/migrate-repo-to-static.ts <wrapper-repo-id> [--dry-run]
`);
  process.exit(code);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const metadata = await readRepoMetadata(args.repoId);
  if (!metadata) {
    console.error(`migrate-repo-to-static: no metadata for ${args.repoId}`);
    process.exit(1);
  }

  // Force the static provider regardless of env. In production env
  // PREVIEW_PROVIDER=sandbox until Phase 6 acceptance, so the global
  // singleton would route into sandbox.
  const staticProvider = await createPreviewProvider({
    providerOverride: "static",
  });
  const sandboxProvider = await createSandboxProvider();
  const boilerplateVersion = await readBoilerplateVersion();

  const result = await migrateRepoToStatic({
    sourceRepoId: metadata.sourceRepoId,
    metadata,
    staticProvider,
    sandboxProvider,
    boilerplateVersion,
  });

  if (!result.changed) {
    console.log(
      `migrate-repo-to-static: ${args.repoId} skipped (${result.skipReason ?? "no-op"})`,
    );
    return;
  }

  console.log(`migrate-repo-to-static: ${args.repoId}: ${result.applied.join(", ")}`);
  if (result.destroyedSandboxId && !result.destroySucceeded) {
    console.log(
      `  note: sandbox destroy reported a failure (continuing) — sandbox may have been gone already`,
    );
  }

  if (args.dryRun) {
    console.log(`migrate-repo-to-static: DRY RUN — not writing metadata`);
    return;
  }

  await writeRepoMetadata(args.repoId, result.metadata);
  console.log(`migrate-repo-to-static: ${args.repoId} migrated to static.`);
};

void main().catch((err: Error) => {
  console.error(`migrate-repo-to-static: ${err.message}`);
  process.exit(1);
});
