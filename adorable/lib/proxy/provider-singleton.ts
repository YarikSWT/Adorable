// Lazy-инициализируемый singleton для ProxyProvider.
// HMR-safe: кешируем в globalThis.

import {
  createProxyProvider,
  type ProxyProvider,
} from "@/lib/adapters/proxy";

type SingletonCache = {
  providerPromise?: Promise<ProxyProvider>;
};

const GLOBAL_KEY = "__adorableProxySingleton" as const;
const g = globalThis as unknown as Record<string, SingletonCache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

export const getProxyProvider = async (): Promise<ProxyProvider> => {
  if (!cache.providerPromise) {
    cache.providerPromise = createProxyProvider();
  }
  return cache.providerPromise;
};

export const __resetProxySingleton = (): void => {
  cache.providerPromise = undefined;
};
