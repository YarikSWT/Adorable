// Проверяет, что ACL переживает "рестарт" процесса (мы эмулируем рестарт
// через сброс кэша + перечитывание файла) и atomic-write не теряет данные
// под параллельными grants.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

import {
  getOrCreateIdentitySession,
  __resetIdentitySessionCache,
  ADORABLE_IDENTITY_COOKIE,
} from "@/lib/identity-session";
import { __resetGitSingleton } from "@/lib/git/provider-singleton";

const pristineEnv = { ...process.env };
let aclFile = "";

beforeEach(async () => {
  cookieJar.clear();
  __resetIdentitySessionCache();
  __resetGitSingleton();
  process.env.GIT_PROVIDER = "mock";
  const dir = await fs.mkdtemp(path.join(tmpdir(), "adorable-acl-"));
  aclFile = path.join(dir, "acl.json");
  process.env.ADORABLE_ACL_FILE = aclFile;
});

afterEach(async () => {
  if (aclFile) {
    await fs.rm(path.dirname(aclFile), { recursive: true, force: true });
  }
  __resetIdentitySessionCache();
  for (const k of Object.keys(process.env)) {
    if (!(k in pristineEnv)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(pristineEnv)) {
    if (v !== undefined) process.env[k] = v;
  }
});

describe("identity-session persistence", () => {
  it("creates ACL file on first identity issue", async () => {
    const { identityId } = await getOrCreateIdentitySession();
    expect(identityId).toBeTruthy();
    // Подождём пока scheduleWrite сольётся.
    await new Promise((r) => setTimeout(r, 30));
    const raw = await fs.readFile(aclFile, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed[identityId]).toEqual([]);
  });

  it("persists grants and survives 'process restart' (cache reset)", async () => {
    const { identityId, identity } = await getOrCreateIdentitySession();
    await identity.permissions.git.grant({
      permission: "write",
      repoId: "repo-A",
    });
    await identity.permissions.git.grant({
      permission: "write",
      repoId: "repo-B",
    });
    await new Promise((r) => setTimeout(r, 30));

    // Симулируем рестарт next-server: чистим cache, оставляем cookie.
    __resetIdentitySessionCache();

    const { identityId: rehydratedId, identity: rehydratedIdentity } =
      await getOrCreateIdentitySession();
    expect(rehydratedId).toBe(identityId);

    // Заметаем repos в mock git provider, чтобы list мог их найти.
    const { getGitProvider } = await import("@/lib/git/provider-singleton");
    const provider = await getGitProvider();
    await provider.createRepo({ name: "repo-A" }).catch(() => undefined);
    await provider.createRepo({ name: "repo-B" }).catch(() => undefined);
    // Mock createRepo генерирует свой repoId, поэтому list через провайдера
    // не вернёт "repo-A" — обходим: вызываем list напрямую через ACL,
    // который ничего не знает про реальные repoId'ы. Достаточно проверить
    // что наши granted repoId'ы хранятся.
    const aclRaw = await fs.readFile(aclFile, "utf8");
    const aclParsed = JSON.parse(aclRaw) as Record<string, string[]>;
    expect(new Set(aclParsed[rehydratedId])).toEqual(
      new Set(["repo-A", "repo-B"]),
    );
  });

  it("identity returned from rehydrated cache sees its repos via list()", async () => {
    // Готовим mock git provider c заранее созданными репо, ID которых
    // мы и кладём в ACL.
    const { getGitProvider } = await import("@/lib/git/provider-singleton");
    const provider = await getGitProvider();
    const repoA = await provider.createRepo({ name: "alpha" });
    const repoB = await provider.createRepo({ name: "beta" });

    const { identity } = await getOrCreateIdentitySession();
    await identity.permissions.git.grant({
      permission: "write",
      repoId: repoA.repoId,
    });
    await new Promise((r) => setTimeout(r, 30));

    // Симулируем рестарт.
    __resetIdentitySessionCache();
    const { identity: rehydrated } = await getOrCreateIdentitySession();

    const list = await rehydrated.permissions.git.list({ limit: 50 });
    expect(list.repositories.map((r) => r.id)).toContain(repoA.repoId);
    expect(list.repositories.map((r) => r.id)).not.toContain(repoB.repoId);
  });

  it("grant is idempotent — повтор не плодит дубли", async () => {
    const { identityId, identity } = await getOrCreateIdentitySession();
    for (let i = 0; i < 5; i++) {
      await identity.permissions.git.grant({
        permission: "write",
        repoId: "repo-X",
      });
    }
    await new Promise((r) => setTimeout(r, 30));
    const raw = await fs.readFile(aclFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    expect(parsed[identityId]).toEqual(["repo-X"]);
  });

  it("starts with empty ACL when file is corrupt JSON (does not crash)", async () => {
    await fs.mkdir(path.dirname(aclFile), { recursive: true });
    await fs.writeFile(aclFile, "{ not valid json", "utf8");

    const { identityId } = await getOrCreateIdentitySession();
    expect(identityId).toBeTruthy();
    expect(cookieJar.get(ADORABLE_IDENTITY_COOKIE)).toBe(identityId);
  });

  it("two parallel grants don't lose either grant", async () => {
    const { identity } = await getOrCreateIdentitySession();
    await Promise.all([
      identity.permissions.git.grant({
        permission: "write",
        repoId: "parallel-A",
      }),
      identity.permissions.git.grant({
        permission: "write",
        repoId: "parallel-B",
      }),
      identity.permissions.git.grant({
        permission: "write",
        repoId: "parallel-C",
      }),
    ]);
    await new Promise((r) => setTimeout(r, 50));

    __resetIdentitySessionCache();
    await getOrCreateIdentitySession();
    const raw = await fs.readFile(aclFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const allowed = new Set(parsed[Object.keys(parsed)[0]!]);
    expect(allowed).toEqual(new Set(["parallel-A", "parallel-B", "parallel-C"]));
  });
});
