// Pure migration helpers for RepoMetadata — Phase 5 (MIGRATION_PATH §5).
//
// Existing repos created before Phase 4 don't have boilerplateVersion or
// the preview block. The migration is **idempotent** and **non-destructive**:
//   - If boilerplateVersion is missing → backfill with the configured
//     default (typically the current bundled VERSION value).
//   - If preview is missing → backfill with a snapshot of the **active**
//     preview provider at migration time. Until Phase 6 acceptance the
//     active provider is "sandbox", so existing repos pin sandbox
//     capabilities — they keep working exactly as before.
//   - Migration NEVER switches a project's provider — that's a separate
//     manual operation (migrate-repo-to-static.ts, future iter).
//   - If both fields are already present → no-op (idempotent).
//
// Pure: no fs/network. CLI wrappers (scripts/migrate-repo-metadata.ts)
// pass in the live RepoMetadata + provider + version, get back the
// migrated record (or the same record reference if nothing changed).

import {
  SANDBOX_CAPABILITIES,
  type PreviewCapabilities,
  type PreviewProviderName,
} from "@/lib/adapters/preview";
import type { RepoMetadata, RepoPreviewMetadata } from "@/lib/repo-storage";

export interface MigrateMetadataOptions {
  /** Default boilerplate version when the metadata has none. */
  boilerplateVersion: string;
  /** Provider name to pin into the preview block when missing. */
  provider: PreviewProviderName;
  /** Capabilities snapshot to pin. */
  capabilities: PreviewCapabilities;
  /** Override `now()` for deterministic tests. */
  now?: () => string;
}

export interface MigrateResult {
  /** Migrated metadata; same object reference when no changes were needed. */
  metadata: RepoMetadata;
  /** True iff at least one field was added/changed. */
  changed: boolean;
  /**
   * Human-readable diff of what was filled in. Empty array when
   * `changed` is false.
   */
  applied: string[];
}

const SANDBOX_DEFAULTS: MigrateMetadataOptions = {
  boilerplateVersion: "1.0.0",
  provider: "sandbox",
  capabilities: SANDBOX_CAPABILITIES,
};

export const migrateRepoMetadata = (
  metadata: RepoMetadata,
  opts: Partial<MigrateMetadataOptions> = {},
): MigrateResult => {
  const cfg: MigrateMetadataOptions = {
    boilerplateVersion: opts.boilerplateVersion ?? SANDBOX_DEFAULTS.boilerplateVersion,
    provider: opts.provider ?? SANDBOX_DEFAULTS.provider,
    capabilities: opts.capabilities ?? SANDBOX_DEFAULTS.capabilities,
    ...(opts.now ? { now: opts.now } : {}),
  };
  const now = cfg.now ?? (() => new Date().toISOString());

  const applied: string[] = [];
  let next = metadata;

  if (next.boilerplateVersion === undefined) {
    next = { ...next, boilerplateVersion: cfg.boilerplateVersion };
    applied.push(`boilerplateVersion=${cfg.boilerplateVersion}`);
  }

  if (next.preview === undefined) {
    const preview: RepoPreviewMetadata = {
      provider: cfg.provider,
      capabilities: { ...cfg.capabilities },
      createdAt: now(),
      migrationStatus: "ok",
    };
    next = { ...next, preview };
    applied.push(`preview.provider=${cfg.provider}`);
  }

  if (applied.length === 0) {
    return { metadata, changed: false, applied: [] };
  }
  return { metadata: next, changed: true, applied };
};
