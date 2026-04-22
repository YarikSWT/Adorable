// Идентификация пользователя в self-hosted Adorable.
//
// Заменяет Freestyle identities. Временная реализация до полного
// перехода на Better Auth (ADR-015): identityId = opaque UUID в cookie,
// per-identity ACL пока хранится в памяти процесса (Map). Перезагрузка
// сервера сбрасывает ACL — но в single-host single-user dev setup это
// нормально. Prod: заменим на Better Auth + Postgres.
//
// Контракт совместим с предыдущим `{ identityId, identity }`:
//   - `identity.permissions.git.list({ limit })` → { repositories: [{id,name}] }
//   - `identity.permissions.git.grant({ permission, repoId })`
//
// Методы `vms.grant` из Freestyle убраны (sandbox-side ACL управляется
// процессом-билдером).

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

import { getGitProvider } from "@/lib/git/provider-singleton";

export const ADORABLE_IDENTITY_COOKIE = "adorable_identity_id";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// In-memory ACL store. identityId → Set<repoId>.
// HMR-safe через globalThis.
type Store = Map<string, Set<string>>;
const GLOBAL_KEY = "__adorableIdentityAcl" as const;
const g = globalThis as unknown as Record<string, Store | undefined>;
g[GLOBAL_KEY] ??= new Map();
const acl: Store = g[GLOBAL_KEY]!;

type GitListResult = {
  repositories: Array<{ id: string; name: string }>;
};

export interface AdorableIdentity {
  permissions: {
    git: {
      list: (opts?: { limit?: number }) => Promise<GitListResult>;
      grant: (opts: { permission: string; repoId: string }) => Promise<void>;
    };
  };
}

const buildIdentity = (identityId: string): AdorableIdentity => ({
  permissions: {
    git: {
      list: async ({ limit = 200 } = {}) => {
        const allowed = acl.get(identityId) ?? new Set<string>();
        if (allowed.size === 0) {
          return { repositories: [] };
        }
        const provider = await getGitProvider();
        // listRepos returns all repos owned by the configured Gitea user/org.
        // We filter to the set this identity has been granted.
        const all = await provider.listRepos({ limit: Math.max(limit, allowed.size) });
        const repositories = all
          .filter((r) => allowed.has(r.id))
          .slice(0, limit);
        return { repositories };
      },
      grant: async ({ repoId }) => {
        const set = acl.get(identityId) ?? new Set<string>();
        set.add(repoId);
        acl.set(identityId, set);
      },
    },
  },
});

export const getOrCreateIdentitySession = async () => {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ADORABLE_IDENTITY_COOKIE)?.value;

  if (existing && acl.has(existing)) {
    return { identityId: existing, identity: buildIdentity(existing) };
  }

  const identityId = existing ?? randomUUID();
  if (!acl.has(identityId)) acl.set(identityId, new Set());

  if (!existing) {
    cookieStore.set(ADORABLE_IDENTITY_COOKIE, identityId, {
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
    });
  }

  return { identityId, identity: buildIdentity(identityId) };
};
