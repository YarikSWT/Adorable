// Per-project migration: sandbox → static. Manual, requires
// platform-engineer approval per project.
// Source: docs/preview-provider/MIGRATION_PATH.md §5.
//
// Steps (idempotent):
//   1. If metadata.preview.provider is already "static" — no-op.
//   2. Destroy the existing sandbox (best-effort; missing sandbox is OK).
//   3. Call staticProvider.create({repoId: sourceRepoId, boilerplateVersion})
//      to allocate scratch dir + Caddy file_server route.
//   4. Synthesize new RepoMetadata: vm field from PreviewMetadata,
//      preview.provider="static" + STATIC capabilities, migrationStatus="ok".
//
// The helper does NOT touch the build-runner image / volume — those are
// platform infra, set up separately. It also does NOT trigger an initial
// build — caller can enqueue via getBuildQueue() after writing the new
// metadata.

import type { PreviewProvider } from "@/lib/adapters/preview";
import type { SandboxProvider } from "@/lib/adapters/sandbox";
import type { RepoMetadata } from "@/lib/repo-storage";

export interface MigrateToStaticInput {
  /** Source repo id (= projectId for the preview provider). */
  sourceRepoId: string;
  /** Current metadata snapshot read from the wrapper repo. */
  metadata: RepoMetadata;
  /**
   * Static-mode preview provider. Caller constructs it explicitly so
   * that env state (PREVIEW_PROVIDER=sandbox in production until Phase 6
   * acceptance) doesn't accidentally route this through the sandbox
   * adapter.
   */
  staticProvider: PreviewProvider;
  /** Sandbox provider for the destroy step (idempotent). */
  sandboxProvider: SandboxProvider;
  /** boilerplateVersion to pin into the new metadata. */
  boilerplateVersion: string;
  /** Override now() for tests. */
  now?: () => string;
}

export interface MigrateToStaticResult {
  /** New metadata to persist via writeRepoMetadata. */
  metadata: RepoMetadata;
  /** True iff at least one mutation occurred. */
  changed: boolean;
  /** Sandbox id we attempted to destroy (null when no sandbox known). */
  destroyedSandboxId: string | null;
  /** True iff destroy succeeded; false on error or no sandbox. */
  destroySucceeded: boolean;
  /** Human-readable trail. */
  applied: string[];
  /** When changed=false: explains why this was a no-op. */
  skipReason?: string;
}

export const migrateRepoToStatic = async (
  input: MigrateToStaticInput,
): Promise<MigrateToStaticResult> => {
  if (input.staticProvider.name !== "static" && input.staticProvider.name !== "mock") {
    throw new Error(
      `migrateRepoToStatic: staticProvider.name must be "static" (or "mock" for tests), got "${input.staticProvider.name}"`,
    );
  }

  if (input.metadata.preview?.provider === "static") {
    return {
      metadata: input.metadata,
      changed: false,
      destroyedSandboxId: null,
      destroySucceeded: false,
      applied: [],
      skipReason: "already on static provider",
    };
  }

  // 1. Destroy existing sandbox if known.
  let destroyedSandboxId: string | null = null;
  let destroySucceeded = false;
  const sandboxId = input.metadata.vm?.vmId;
  if (sandboxId) {
    destroyedSandboxId = sandboxId;
    try {
      await input.sandboxProvider.destroy(sandboxId);
      destroySucceeded = true;
    } catch (err) {
      // Idempotent — sandbox already gone (cleanup-worker, manual rm)
      // is OK. We log + continue.
      process.stderr.write(
        `migrateRepoToStatic: destroy(${sandboxId}) failed (continuing): ${(err as Error).message}\n`,
      );
    }
  }

  // 2. Create static preview environment.
  const previewMeta = await input.staticProvider.create({
    repoId: input.sourceRepoId,
    boilerplateVersion: input.boilerplateVersion,
  });

  // 3. Synthesize the new metadata snapshot.
  const now = input.now ?? (() => new Date().toISOString());
  const next: RepoMetadata = {
    ...input.metadata,
    boilerplateVersion: input.boilerplateVersion,
    vm: {
      vmId: previewMeta.projectId,
      previewUrl: previewMeta.previewUrl,
      devCommandTerminalUrl: previewMeta.terminalUrls?.devCommand ?? "",
      additionalTerminalsUrl: previewMeta.terminalUrls?.additional ?? "",
    },
    preview: {
      provider: "static",
      capabilities: { ...input.staticProvider.capabilities },
      createdAt: now(),
      migrationStatus: "ok",
    },
  };

  const applied: string[] = [];
  if (destroyedSandboxId)
    applied.push(`sandbox-destroyed=${destroyedSandboxId}`);
  applied.push("preview.provider=static");
  applied.push("vm-resynthesized");
  applied.push(`boilerplateVersion=${input.boilerplateVersion}`);

  return {
    metadata: next,
    changed: true,
    destroyedSandboxId,
    destroySucceeded,
    applied,
  };
};
