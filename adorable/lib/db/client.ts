// Drizzle ORM client — HMR-safe singleton.
//
// Wraps the postgres-js + drizzle pair in globalThis so Next.js dev hot-reloads
// don't open a new pool on every reload. Same pattern as
// lib/git/provider-singleton.ts.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type SingletonCache = {
  queryClient?: ReturnType<typeof postgres>;
  db?: ReturnType<typeof drizzle<typeof schema>>;
};

const GLOBAL_KEY = "__adorableDbSingleton" as const;
const g = globalThis as unknown as Record<string, SingletonCache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

const getCachedDb = () => {
  if (!cache.db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — cannot initialise drizzle client",
      );
    }
    cache.queryClient = postgres(url, { max: 10, idle_timeout: 30 });
    cache.db = drizzle(cache.queryClient, { schema });
  }
  return cache.db;
};

export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_t, prop) {
      const real = getCachedDb() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === "function" ? value.bind(real) : value;
    },
  },
);

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export const __resetDbSingleton = async (): Promise<void> => {
  if (cache.queryClient) {
    await cache.queryClient.end({ timeout: 5 });
  }
  cache.queryClient = undefined;
  cache.db = undefined;
};
