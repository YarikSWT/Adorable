// Runner for migrate-repo-metadata: walks Gitea wrapper repos, applies
// migrateRepoMetadata, writes back changed ones. Pure runner (no
// process.exit / console — those live in the CLI script). Returns a
// structured report.
//
// Source: docs/preview-provider/MIGRATION_PATH.md §5.

import {
  isWrapperRepoName,
  readRepoMetadata,
  writeRepoMetadata,
} from "@/lib/repo-storage";
import type { GitProvider } from "@/lib/adapters/git";
import type { AuditLogger } from "@/lib/sandbox/audit-log";

import {
  migrateRepoMetadata,
  type MigrateMetadataOptions,
} from "./migrate-metadata";

export interface MigrationRunOptions {
  /** GitProvider to enumerate + read/write through. */
  provider: GitProvider;
  /** Pass-through migration parameters. */
  migrate: Partial<MigrateMetadataOptions>;
  /** When true, don't write — just report what would change. */
  dryRun?: boolean;
  /** Cap on number of repos to process (useful for staged rollouts). */
  limit?: number;
  /**
   * Logger hook — receives one entry per processed repo. Default no-op.
   * The CLI script wraps with console.log.
   */
  log?: (msg: string) => void;
  /**
   * Optional audit logger. When set, emits a single
   * `boilerplate_migration` event with the run summary
   * (SECURITY.md §6).
   */
  auditLogger?: AuditLogger;
}

export interface MigrationRunReport {
  inspected: number;
  changed: number;
  skipped: number;
  errored: number;
  /** Per-repo summary in walk order. */
  details: Array<{
    repoId: string;
    name: string;
    outcome: "changed" | "no-op" | "no-metadata" | "error";
    applied?: string[];
    error?: string;
  }>;
}

export const runMetadataMigration = async (
  opts: MigrationRunOptions,
): Promise<MigrationRunReport> => {
  const log = opts.log ?? (() => {});
  const limit = Math.max(opts.limit ?? Number.POSITIVE_INFINITY, 1);
  const dryRun = opts.dryRun === true;

  // listRepos returns {id, name} for the configured GitProvider scope
  // (typically the adorable user). 200 is the soft cap that
  // app/api/repos/route.ts uses for its grid; we enumerate the same
  // way.
  const all = await opts.provider.listRepos({ limit: 1000 });
  const wrappers = all.filter((r) => isWrapperRepoName(r.name));

  const report: MigrationRunReport = {
    inspected: 0,
    changed: 0,
    skipped: 0,
    errored: 0,
    details: [],
  };

  for (const repo of wrappers) {
    if (report.inspected >= limit) break;
    report.inspected++;

    let metadata;
    try {
      metadata = await readRepoMetadata(repo.id);
    } catch (err) {
      report.errored++;
      report.details.push({
        repoId: repo.id,
        name: repo.name,
        outcome: "error",
        error: `read failed: ${(err as Error).message}`,
      });
      log(`[error] ${repo.id} (${repo.name}): read failed`);
      continue;
    }

    if (!metadata) {
      report.skipped++;
      report.details.push({
        repoId: repo.id,
        name: repo.name,
        outcome: "no-metadata",
      });
      log(`[skip]  ${repo.id} (${repo.name}): no metadata.json`);
      continue;
    }

    const result = migrateRepoMetadata(metadata, opts.migrate);
    if (!result.changed) {
      report.skipped++;
      report.details.push({
        repoId: repo.id,
        name: repo.name,
        outcome: "no-op",
      });
      log(`[ok]    ${repo.id} (${repo.name}): no-op`);
      continue;
    }

    if (dryRun) {
      report.changed++;
      report.details.push({
        repoId: repo.id,
        name: repo.name,
        outcome: "changed",
        applied: result.applied,
      });
      log(
        `[dry]   ${repo.id} (${repo.name}): would apply ${result.applied.join(", ")}`,
      );
      continue;
    }

    try {
      await writeRepoMetadata(repo.id, result.metadata);
      report.changed++;
      report.details.push({
        repoId: repo.id,
        name: repo.name,
        outcome: "changed",
        applied: result.applied,
      });
      log(`[apply] ${repo.id} (${repo.name}): ${result.applied.join(", ")}`);
    } catch (err) {
      report.errored++;
      report.details.push({
        repoId: repo.id,
        name: repo.name,
        outcome: "error",
        applied: result.applied,
        error: `write failed: ${(err as Error).message}`,
      });
      log(`[error] ${repo.id} (${repo.name}): write failed`);
    }
  }

  if (opts.auditLogger) {
    await opts.auditLogger
      .log({
        event: "boilerplate_migration",
        script: "migrate-repo-metadata",
        toVersion: opts.migrate.boilerplateVersion,
        inspected: report.inspected,
        changed: report.changed,
        skipped: report.skipped,
        errored: report.errored,
        ...(opts.dryRun ? { dryRun: true } : {}),
      })
      .catch(() => undefined);
  }
  return report;
};
