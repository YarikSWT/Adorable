// Lazy-инициализируемые singleton'ы для PreviewProvider и BuildQueue.
//
// Next.js в dev-моде перезагружает модули при HMR, поэтому держим
// инстансы в globalThis чтобы не поднимать клиента docker дважды и
// не плодить независимые очереди билдов.
//
// Паттерн повторяет lib/sandbox/provider-singleton.ts и
// lib/proxy/provider-singleton.ts.
//
// Контракт: docs/preview-provider/CONTRACTS.md §18.

import {
  createPreviewProvider,
  type BuildQueue,
  type PreviewProvider,
} from "@/lib/adapters/preview";
import { createInMemoryBuildQueue } from "@/lib/preview/build-queue";
import { getSharedAuditLogger } from "@/lib/sandbox/audit-log";

type SingletonCache = {
  providerPromise?: Promise<PreviewProvider>;
  buildQueue?: BuildQueue;
};

const GLOBAL_KEY = "__adorablePreviewSingleton" as const;
const g = globalThis as unknown as Record<string, SingletonCache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

/**
 * Production safety hatch (MIGRATION_PATH §6). Set
 * `PREVIEW_PROVIDER_FORCE_SANDBOX=1` to override `PREVIEW_PROVIDER` for
 * a running builder — every new project resolution returns the sandbox
 * provider, regardless of what the env says.
 *
 * Use case: static-mode is broken in production (build-runner image
 * regression, Caddy file_server crash) — flip this env, restart
 * builder, all NEW projects route to sandbox until the static path is
 * fixed. Existing static-pinned projects keep their pinned capabilities
 * (ADR-015) — chat/route.ts still branches on `metadata.preview.
 * capabilities` per-project, so this only affects newly-created repos.
 */
const isForceSandbox = (): boolean =>
  process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"] === "1";

export const getPreviewProvider = async (): Promise<PreviewProvider> => {
  if (!cache.providerPromise) {
    cache.providerPromise = isForceSandbox()
      ? createPreviewProvider({ providerOverride: "sandbox" })
      : createPreviewProvider();
  }
  return cache.providerPromise;
};

/**
 * BuildQueue singleton. Real impl (cancel+replace, max 1+1) lives in
 * lib/preview/build-queue.ts. runJob closure routes the build through
 * getPreviewProvider().build(), so the queue stays decoupled from the
 * provider.
 *
 * Sandbox-режим имеет capabilities.manualRebuild=true, но build() —
 * succeeded-stub. То есть очередь технически "работает" и в sandbox-
 * режиме (job моментально завершается). chat/route.ts всё равно НЕ
 * должен звать enqueue в sandbox-режиме (HMR подхватывает изменения),
 * но если случайно дернёт — никакого вреда.
 */
export const getBuildQueue = (): BuildQueue => {
  if (!cache.buildQueue) {
    cache.buildQueue = createInMemoryBuildQueue({
      runJob: async ({ job, signal }) => {
        const provider = await getPreviewProvider();
        return provider.build({
          projectId: job.projectId,
          reason: job.reason,
          signal,
        });
      },
      auditLogger: getSharedAuditLogger(),
    });
  }
  return cache.buildQueue;
};

// Test helper — reset singleton between tests.
export const __resetPreviewSingleton = (): void => {
  cache.providerPromise = undefined;
  cache.buildQueue = undefined;
};
