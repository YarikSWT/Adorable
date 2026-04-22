// Контрактные тесты для GitProvider.
//
// Бьются только против mock-провайдера. Тот же suite мы позже сможем
// активировать и для git-gitea.ts (через env флаг), когда появится
// реальная реализация.

import { describe, it, expect, beforeEach } from "vitest";

import {
  createGitProvider,
  resolveGitProviderName,
  type GitProvider,
} from "@/lib/adapters/git";

describe("resolveGitProviderName", () => {
  it("defaults to mock in test env", () => {
    expect(resolveGitProviderName()).toBe("mock");
  });

  it("honours override", () => {
    expect(resolveGitProviderName("gitea")).toBe("gitea");
  });
});

describe("GitProvider contract (mock)", () => {
  let provider: GitProvider;

  beforeEach(async () => {
    provider = await createGitProvider({ providerOverride: "mock" });
  });

  it("createRepo returns repoId + ref + cloneUrl", async () => {
    const { repoId, repo, cloneUrl } = await provider.createRepo({
      name: "my-project",
    });
    expect(repoId).toBeTruthy();
    expect(repo.repoId).toBe(repoId);
    expect(cloneUrl).toContain(repoId);
  });

  it("getRepo throws for unknown repoId", () => {
    expect(() => provider.getRepo("nope")).toThrowError(/repo not found/);
  });

  it("createRepo with import seeds bootstrap commit and files", async () => {
    const { repo } = await provider.createRepo({
      name: "tpl",
      import: {
        url: "https://github.com/example/template.git",
        type: "git",
        commitMessage: "Initial commit",
      },
    });
    const branch = await repo.branches.getDefaultBranch();
    expect(branch.defaultBranch).toBe("main");

    const { commits } = await repo.commits.list({ limit: 10 });
    expect(commits).toHaveLength(1);
    expect(commits[0].message).toBe("Initial commit");

    const pkg = await repo.contents.get({
      path: "package.json",
      rev: "main",
    });
    expect(pkg.type).toBe("file");
    expect(pkg.content).toContain("imported");
    expect(pkg.contentBase64).toBeTruthy();
  });

  it("commits.create writes files and appends commit", async () => {
    const { repo } = await provider.createRepo({ name: "r1" });
    const { sha } = await repo.commits.create({
      message: "add readme",
      branch: "main",
      files: [{ path: "README.md", content: "# hi\n" }],
      author: { name: "Me", email: "me@example.com" },
    });
    expect(sha).toMatch(/^[0-9a-f]+$/);
    const { commits } = await repo.commits.list({ limit: 10 });
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe(sha);
    expect(commits[0].message).toBe("add readme");
    const readme = await repo.contents.get({ path: "README.md", rev: "main" });
    expect(readme.content).toBe("# hi\n");
  });

  it("commits.list respects order and limit", async () => {
    const { repo } = await provider.createRepo({
      name: "r2",
      import: { url: "x", type: "git" },
    });
    await repo.commits.create({
      message: "c2",
      branch: "main",
      files: [{ path: "a.txt", content: "a" }],
    });
    await repo.commits.create({
      message: "c3",
      branch: "main",
      files: [{ path: "b.txt", content: "b" }],
    });

    const desc = await repo.commits.list({ limit: 2, order: "desc" });
    expect(desc.commits.map((c) => c.message)).toEqual(["c3", "c2"]);

    const asc = await repo.commits.list({ limit: 2, order: "asc" });
    expect(asc.commits.map((c) => c.message)).toEqual(["Initial commit", "c2"]);
  });

  it("commits.create rejects non-default branch", async () => {
    const { repo } = await provider.createRepo({ name: "r3" });
    await expect(
      repo.commits.create({
        message: "x",
        branch: "feature",
        files: [],
      }),
    ).rejects.toThrow(/branch/);
  });

  it("contents.get throws on missing file", async () => {
    const { repo } = await provider.createRepo({ name: "r4" });
    await expect(
      repo.contents.get({ path: "ghost.md", rev: "main" }),
    ).rejects.toThrow(/file not found/);
  });

  it("contents.get base64-encoded matches utf-8", async () => {
    const { repo } = await provider.createRepo({ name: "r5" });
    await repo.commits.create({
      message: "m",
      branch: "main",
      files: [{ path: "hello.txt", content: "привет" }],
    });
    const entry = await repo.contents.get({ path: "hello.txt", rev: "main" });
    expect(entry.content).toBe("привет");
    expect(
      Buffer.from(entry.contentBase64!, "base64").toString("utf8"),
    ).toBe("привет");
  });

  it("commits.create honours base64-encoded input", async () => {
    const { repo } = await provider.createRepo({ name: "r6" });
    await repo.commits.create({
      message: "m",
      branch: "main",
      files: [
        {
          path: "bin.txt",
          content: Buffer.from("binary", "utf8").toString("base64"),
          base64: true,
        },
      ],
    });
    const entry = await repo.contents.get({ path: "bin.txt", rev: "main" });
    expect(entry.content).toBe("binary");
  });

  it("githubSync.enable is a no-op but trackable", async () => {
    const { repo, repoId } = await provider.createRepo({ name: "r7" });
    await repo.githubSync.enable({ githubRepoName: "user/my-proj" });
    const mock = provider as unknown as {
      inspect: (id: string) => { githubSyncTarget: string | null } | undefined;
    };
    expect(mock.inspect(repoId)?.githubSyncTarget).toBe("user/my-proj");
    await repo.githubSync.disable();
    expect(mock.inspect(repoId)?.githubSyncTarget).toBeNull();
  });

  it("listRepos returns created repos", async () => {
    await provider.createRepo({ name: "a" });
    await provider.createRepo({ name: "b" });
    const list = await provider.listRepos();
    const names = list.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("deleteRepo is idempotent", async () => {
    const { repoId } = await provider.createRepo({ name: "dr" });
    await provider.deleteRepo(repoId);
    await expect(provider.deleteRepo(repoId)).resolves.toBeUndefined();
    expect(() => provider.getRepo(repoId)).toThrowError(/not found/);
  });
});
