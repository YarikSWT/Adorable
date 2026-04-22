// Lazy-инициализируемый singleton для GitProvider.
//
// HMR-safe: кешируем в globalThis, чтобы Next.js dev-перезагрузки не
// спавнили миллион fetch-клиентов.

import {
  createGitProvider,
  type GitProvider,
} from "@/lib/adapters/git";

type SingletonCache = {
  providerPromise?: Promise<GitProvider>;
};

const GLOBAL_KEY = "__adorableGitSingleton" as const;
const g = globalThis as unknown as Record<string, SingletonCache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

export const getGitProvider = async (): Promise<GitProvider> => {
  if (!cache.providerPromise) {
    cache.providerPromise = createGitProvider();
  }
  return cache.providerPromise;
};

export const __resetGitSingleton = (): void => {
  cache.providerPromise = undefined;
};
