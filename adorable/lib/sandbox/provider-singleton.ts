// Lazy-инициализируемый singleton для SandboxProvider.
//
// Next.js в dev-моде перезагружает модули при HMR, поэтому держим
// провайдера в globalThis чтобы не создавать миллион клиентов Docker
// и не дублировать cleanup-воркер.

import {
  createSandboxProvider,
  type SandboxProvider,
} from "@/lib/adapters/sandbox";
import {
  createCleanupWorker,
  type CleanupWorker,
} from "@/lib/sandbox/cleanup-worker";

type SingletonCache = {
  providerPromise?: Promise<SandboxProvider>;
  cleanupWorker?: CleanupWorker;
};

const GLOBAL_KEY = "__adorableSandboxSingleton" as const;
const g = globalThis as unknown as Record<string, SingletonCache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

export const getSandboxProvider = async (): Promise<SandboxProvider> => {
  if (!cache.providerPromise) {
    cache.providerPromise = createSandboxProvider();
  }
  return cache.providerPromise;
};

/**
 * Ensure the sandbox cleanup worker is running. Called once per server
 * boot. HMR-safe: idempotent.
 */
export const ensureCleanupWorkerRunning = async (): Promise<void> => {
  if (cache.cleanupWorker?.running) return;
  const provider = await getSandboxProvider();
  if (!cache.cleanupWorker) {
    cache.cleanupWorker = createCleanupWorker({ provider });
  }
  cache.cleanupWorker.start();
};

/**
 * Register activity on a sandbox, resetting the idle timer. Callers
 * should invoke this on exec / fs / chat traffic.
 */
export const touchSandbox = (sandboxId: string): void => {
  cache.cleanupWorker?.touch(sandboxId);
};

// Test helper — reset singleton between tests.
export const __resetSandboxSingleton = (): void => {
  cache.cleanupWorker?.stop();
  cache.providerPromise = undefined;
  cache.cleanupWorker = undefined;
};
