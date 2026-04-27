// Идентификация пользователя в self-hosted Adorable.
//
// Заменяет Freestyle identities. Временная реализация до полного
// перехода на Better Auth (ADR-015): identityId = opaque UUID в cookie,
// per-identity ACL — Map<identityId, Set<repoId>> с persistence в JSON
// на диск, чтобы сессии и владение проектами переживали restart
// next-server.
//
// Контракт совместим с предыдущим `{ identityId, identity }`:
//   - `identity.permissions.git.list({ limit })` → { repositories: [{id,name}] }
//   - `identity.permissions.git.grant({ permission, repoId })`
//
// Persistence:
//   - file: $ADORABLE_ACL_FILE (default: ${cwd}/.adorable/acl.json)
//   - формат: { "<identityId>": ["repoId1", "repoId2", ...] }
//   - грант → atomic-write (tmpfile + rename), чтобы не потерять данные
//     при crash/race.
//   - load выполняется лениво при первом обращении и кешируется в
//     globalThis (HMR-safe).
//
// Методы `vms.grant` из Freestyle убраны (sandbox-side ACL управляется
// процессом-билдером).

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { getGitProvider } from "@/lib/git/provider-singleton";
import { isWrapperRepoName } from "@/lib/repo-storage";

export const ADORABLE_IDENTITY_COOKIE = "adorable_identity_id";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type Store = Map<string, Set<string>>;
type Cache = { acl: Store; loaded: boolean; pendingWrite: Promise<void> | null };

const GLOBAL_KEY = "__adorableIdentityAclCache" as const;
const g = globalThis as unknown as Record<string, Cache | undefined>;
g[GLOBAL_KEY] ??= { acl: new Map(), loaded: false, pendingWrite: null };
const cache: Cache = g[GLOBAL_KEY]!;

const aclFilePath = (): string => {
  const override = process.env["ADORABLE_ACL_FILE"];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.resolve(process.cwd(), ".adorable", "acl.json");
};

const ensureLoaded = async (): Promise<Store> => {
  if (cache.loaded) return cache.acl;
  const file = aclFilePath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    for (const [identityId, repos] of Object.entries(parsed)) {
      if (!Array.isArray(repos)) continue;
      cache.acl.set(identityId, new Set(repos));
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Битый JSON или I/O — не падаем, лог в stderr и стартуем с пустого.
      // Это лучше, чем 500 на каждый /api/repos для всех пользователей.
      process.stderr.write(
        `identity-session: failed to read ACL file ${file} (${
          (err as Error).message
        }); starting with empty ACL\n`,
      );
    }
  }
  cache.loaded = true;
  return cache.acl;
};

const persistAcl = async (): Promise<void> => {
  const file = aclFilePath();
  const dir = path.dirname(file);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const snapshot: Record<string, string[]> = {};
  for (const [identityId, repos] of cache.acl.entries()) {
    snapshot[identityId] = Array.from(repos);
  }
  const data = JSON.stringify(snapshot, null, 2);

  await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
  await fs.writeFile(tmp, data, "utf8");
  // Atomic rename — гарантирует, что reader никогда не видит частичный JSON.
  await fs.rename(tmp, file);
};

// Сериализуем записи: одна заявка на запись за раз.
// Если новый grant приходит, пока предыдущий ещё пишет, дожидаемся.
const scheduleWrite = (): Promise<void> => {
  const pending = cache.pendingWrite ?? Promise.resolve();
  const next = pending.then(persistAcl).catch((err: unknown) => {
    process.stderr.write(
      `identity-session: failed to persist ACL (${
        (err as Error).message
      })\n`,
    );
  });
  cache.pendingWrite = next.finally(() => {
    if (cache.pendingWrite === next) cache.pendingWrite = null;
  });
  return next;
};

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
        const acl = await ensureLoaded();
        const allowed = acl.get(identityId) ?? new Set<string>();
        if (allowed.size === 0) {
          return { repositories: [] };
        }
        const provider = await getGitProvider();
        const all = await provider.listRepos({
          limit: Math.max(limit, allowed.size),
        });
        const repositories = all
          .filter((r) => allowed.has(r.id))
          .slice(0, limit);
        return { repositories };
      },
      grant: async ({ repoId }) => {
        const acl = await ensureLoaded();
        const set = acl.get(identityId) ?? new Set<string>();
        if (set.has(repoId)) return; // idempotent — нет смысла писать
        set.add(repoId);
        acl.set(identityId, set);
        await scheduleWrite();
      },
    },
  },
});

/**
 * Dev-only хелпер: при `ADORABLE_DEV_AUTO_GRANT=1` выдать новой
 * identity grant'ы на ВСЕ существующие wrapper-репо в Gitea. Полезно в
 * single-user dev setup'е, когда после рестарта next-server/перевыдачи
 * cookie старые проекты "теряются" — пользователь видит пустой grid в
 * HomeWelcome. В prod опция должна оставаться выключенной.
 *
 * Гранты записываются в тот же ACL-файл, что и обычные grants.
 */
const autoGrantWrappersIfEnabled = async (
  identityId: string,
): Promise<void> => {
  if (process.env["ADORABLE_DEV_AUTO_GRANT"] !== "1") return;
  try {
    const provider = await getGitProvider();
    const all = await provider.listRepos({ limit: 500 });
    const wrappers = all.filter((r) => isWrapperRepoName(r.name));
    if (wrappers.length === 0) return;
    const acl = await ensureLoaded();
    const set = acl.get(identityId) ?? new Set<string>();
    let added = 0;
    for (const w of wrappers) {
      if (!set.has(w.id)) {
        set.add(w.id);
        added++;
      }
    }
    if (added > 0) {
      acl.set(identityId, set);
      await scheduleWrite();
      process.stderr.write(
        `identity-session: auto-granted ${added} wrapper repo(s) to ${identityId} (ADORABLE_DEV_AUTO_GRANT=1)\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `identity-session: auto-grant failed (${(err as Error).message})\n`,
    );
  }
};

export const getOrCreateIdentitySession = async () => {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ADORABLE_IDENTITY_COOKIE)?.value;
  const acl = await ensureLoaded();

  const identityId = existing ?? randomUUID();
  const isFreshIdentity = !acl.has(identityId);
  if (isFreshIdentity) {
    acl.set(identityId, new Set());
    await scheduleWrite();
  }

  // Auto-grant работает не только при создании identity, но и для
  // identity с пустым ACL (например, после wipe файла или когда identity
  // была создана до включения auto-grant'а). Проверяем при каждом GET,
  // но только если grants пусты — обычные identity с реальными grant'ами
  // не трогаются.
  const allowed = acl.get(identityId) ?? new Set<string>();
  if (allowed.size === 0) {
    await autoGrantWrappersIfEnabled(identityId);
  }

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

// Test helper — сбрасывает кэш, чтобы следующий вызов перечитал файл.
export const __resetIdentitySessionCache = (): void => {
  cache.acl.clear();
  cache.loaded = false;
  cache.pendingWrite = null;
};

/**
 * Заменяет repoId в ACL для всех identity, у которых он встречается.
 * Используется при миграции wrapper-репо (rename в Gitea меняет
 * `<owner>/<name>` идентификатор) — без этой функции старые grants
 * указывали бы на несуществующий repoId.
 */
export const migrateRepoIdInAcl = async (
  oldRepoId: string,
  newRepoId: string,
): Promise<void> => {
  if (oldRepoId === newRepoId) return;
  const acl = await ensureLoaded();
  let touched = false;
  for (const [identityId, repos] of acl.entries()) {
    if (repos.has(oldRepoId)) {
      repos.delete(oldRepoId);
      repos.add(newRepoId);
      acl.set(identityId, repos);
      touched = true;
    }
  }
  if (touched) {
    await scheduleWrite();
  }
};
