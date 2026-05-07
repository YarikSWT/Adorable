// Synchronous lookup table for system role IDs.
//
// System roles are seeded once and effectively immutable, so we cache them in
// a Map keyed by `<scope>:<slug>`. The cache is loaded lazily on first call
// (HMR-safe via globalThis, same pattern as lib/git/provider-singleton.ts).
//
// If/when admin tooling lets ops mutate roles at runtime, callers will need
// to call `__resetRoleCache` after mutation — there is no automatic
// invalidation.

import { db } from "@/lib/db/client";
import { roles } from "@/lib/db/schema/roles";

export type RoleScope = "organization" | "project" | "admin";

type Cache = {
  loadingPromise?: Promise<Map<string, string>>;
  byKey?: Map<string, string>;
};

const GLOBAL_KEY = "__adorableRoleCache" as const;
const g = globalThis as unknown as Record<string, Cache | undefined>;
g[GLOBAL_KEY] ??= {};
const cache = g[GLOBAL_KEY]!;

const cacheKey = (scope: RoleScope, slug: string) => `${scope}:${slug}`;

const loadAll = async (): Promise<Map<string, string>> => {
  const rows = await db
    .select({ id: roles.id, scope: roles.scope, slug: roles.slug })
    .from(roles);
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(cacheKey(r.scope as RoleScope, r.slug), r.id);
  }
  cache.byKey = map;
  return map;
};

const ensure = async (): Promise<Map<string, string>> => {
  if (cache.byKey) return cache.byKey;
  if (!cache.loadingPromise) {
    cache.loadingPromise = loadAll().finally(() => {
      cache.loadingPromise = undefined;
    });
  }
  return cache.loadingPromise;
};

export const getRoleId = async (
  scope: RoleScope,
  slug: string,
): Promise<string> => {
  const map = await ensure();
  const id = map.get(cacheKey(scope, slug));
  if (!id) {
    throw new Error(
      `[role-cache] role not seeded: ${scope}:${slug} — run db:seed`,
    );
  }
  return id;
};

export const tryGetRoleId = async (
  scope: RoleScope,
  slug: string,
): Promise<string | null> => {
  const map = await ensure();
  return map.get(cacheKey(scope, slug)) ?? null;
};

export const __resetRoleCache = (): void => {
  cache.byKey = undefined;
  cache.loadingPromise = undefined;
};
