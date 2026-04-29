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

type SingletonCache = {
  providerPromise?: Promise<PreviewProvider>;
  buildQueue?: BuildQueue;
};

const GLOBAL_KEY = "__adorablePreviewSingleton" as const;
const g = globalThis as unknown as Record<string, SingletonCache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

export const getPreviewProvider = async (): Promise<PreviewProvider> => {
  if (!cache.providerPromise) {
    cache.providerPromise = createPreviewProvider();
  }
  return cache.providerPromise;
};

/**
 * BuildQueue singleton — в Phase 1 это стаб, который кидает при попытке
 * использовать. Реальная in-memory реализация (cancel + replace, max 1+1)
 * появится в Phase 3 (см. MIGRATION_PATH §3, CONTRACTS §7).
 *
 * Caller'ы которые получат провайдер с capabilities.manualRebuild=false
 * (sandbox-режим) не должны звать getBuildQueue() в Phase 4 — branching
 * в chat/route.ts должен их защитить.
 */
export const getBuildQueue = (): BuildQueue => {
  if (!cache.buildQueue) {
    cache.buildQueue = createNotImplementedBuildQueue();
  }
  return cache.buildQueue;
};

const NOT_IMPLEMENTED_MSG =
  "BuildQueue is not implemented yet (lands in Phase 3 of preview-provider migration).";

const rejectNotImplemented = (): Promise<never> =>
  Promise.reject(new Error(NOT_IMPLEMENTED_MSG));

const throwNotImplemented = (): never => {
  throw new Error(NOT_IMPLEMENTED_MSG);
};

const createNotImplementedBuildQueue = (): BuildQueue => ({
  enqueue: rejectNotImplemented,
  cancel: rejectNotImplemented,
  getActive: throwNotImplemented,
  getQueued: throwNotImplemented,
  subscribe: throwNotImplemented,
});

// Test helper — reset singleton between tests.
export const __resetPreviewSingleton = (): void => {
  cache.providerPromise = undefined;
  cache.buildQueue = undefined;
};
