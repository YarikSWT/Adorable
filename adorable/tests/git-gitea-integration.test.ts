// Интеграционные тесты git-gitea.ts против реального Gitea demon.
// Гейтнуты на RUN_GITEA_TESTS=1, требуют живой Gitea по GITEA_BASE_URL
// с валидным GITEA_TOKEN.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createGiteaGitProvider } from "@/lib/adapters/git-gitea";
import type { GitProvider } from "@/lib/adapters/git";

const enabled = process.env.RUN_GITEA_TESTS === "1";
const d = enabled ? describe : describe.skip;

const createdRepos: string[] = [];

d("git-gitea integration", () => {
  let provider: GitProvider;

  beforeAll(() => {
    provider = createGiteaGitProvider();
  });

  afterAll(async () => {
    for (const id of createdRepos) {
      await provider.deleteRepo(id).catch(() => undefined);
    }
  });

  it("createRepo + getDefaultBranch", async () => {
    const { repoId, repo, cloneUrl } = await provider.createRepo({
      name: `adorable-it-${Date.now().toString(36)}`,
    });
    createdRepos.push(repoId);

    expect(repoId).toContain("/");
    expect(cloneUrl).toMatch(/^https?:\/\//);

    const { defaultBranch } = await repo.branches.getDefaultBranch();
    expect(defaultBranch).toBe("main");
  }, 60_000);

  it("commits.create (batch) + contents.get + commits.list", async () => {
    const { repoId, repo } = await provider.createRepo({
      name: `adorable-it-${Date.now().toString(36)}`,
    });
    createdRepos.push(repoId);

    const { sha } = await repo.commits.create({
      message: "add two files",
      branch: "main",
      files: [
        { path: "README.md", content: "# Adorable\n" },
        { path: "src/app.ts", content: "console.log('hi');\n" },
      ],
      author: { name: "Tester", email: "t@example.com" },
    });
    expect(sha).toBeTruthy();

    const readme = await repo.contents.get({ path: "README.md", rev: "main" });
    expect(readme.type).toBe("file");
    expect(readme.content).toContain("Adorable");

    const appTs = await repo.contents.get({
      path: "src/app.ts",
      rev: "main",
    });
    expect(appTs.content).toContain("console.log");

    const { commits } = await repo.commits.list({ limit: 10, order: "desc" });
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0].message).toContain("add two files");
  }, 120_000);

  it("commits.create updates existing file", async () => {
    const { repoId, repo } = await provider.createRepo({
      name: `adorable-it-${Date.now().toString(36)}`,
    });
    createdRepos.push(repoId);

    await repo.commits.create({
      message: "initial data",
      branch: "main",
      files: [{ path: "data.json", content: '{"v":1}' }],
    });
    await repo.commits.create({
      message: "bump",
      branch: "main",
      files: [{ path: "data.json", content: '{"v":2}' }],
    });

    const latest = await repo.contents.get({
      path: "data.json",
      rev: "main",
    });
    expect(latest.content).toBe('{"v":2}');
  }, 120_000);

  it("deleteRepo is idempotent", async () => {
    const { repoId } = await provider.createRepo({
      name: `adorable-delete-${Date.now().toString(36)}`,
    });
    await provider.deleteRepo(repoId);
    await expect(provider.deleteRepo(repoId)).resolves.toBeUndefined();
  }, 60_000);
});
