// Helpers for chat/route.ts onFinish wiring (Phase 4).
// Source: docs/preview-provider/CONTRACTS.md §13, BUILD_PIPELINE.md §2.
//
// Pure decision functions; the actual enqueue happens in chat/route.ts.

import type { PreviewCapabilities } from "@/lib/adapters/preview";

/**
 * Should chat/route.ts onFinish enqueue a build after the LLM turn ends?
 *
 *   - Sandbox-mode (hotReload=true): no — the dev-server picks up changes
 *     via Vite HMR; an explicit build would be redundant work.
 *   - Static-mode (hotReload=false, manualRebuild=true): yes — the
 *     project artifacts only update via vite build, so we trigger one
 *     after each turn.
 *   - Hypothetical future capability with manualRebuild=false: no —
 *     the queue is not active for this provider.
 */
export const shouldEnqueueAfterTurn = (
  capabilities: PreviewCapabilities,
): boolean => {
  if (capabilities.hotReload) return false;
  if (!capabilities.manualRebuild) return false;
  return true;
};
