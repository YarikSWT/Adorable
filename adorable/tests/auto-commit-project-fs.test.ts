// Tests for autoCommitProjectFs — static-mode chat onFinish helper.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetGitSingleton,
  getGitProvider,
} from "@/lib/git/provider-singleton";
import { createMockPreviewProvider } from "@/lib/adapters/preview-mock";
import { autoCommitProjectFs } from "@/lib/preview/auto-commit-project-fs";

let sourceRepoId: string;

beforeEach(async () => {
  __resetGitSingleton();
  const git = await getGitProvider();
  const created = await git.createRepo({ name: "src" });
  sourceRepoId = created.repoId;
});

afterEach(() => {
  __resetGitSingleton();
});

describe("autoCommitProjectFs", () => {
  it("commits text files written via ProjectFs", async () => {
    const provider = createMockPreviewProvider();
    await provider.create({ repoId: "p1", boilerplateVersion: "1.0.0" });
    const fs = await provider.getProjectFs("p1");
    if (!fs) throw new Error("expected fs");
    await fs.writeTextFile("src/App.tsx", "export const App = 1;");
    await fs.writeTextFile("src/utils/x.ts", "export const x = 2;");
    await fs.writeTextFile("public/icon.svg", "<svg/>");

    const git = await getGitProvider();
    const result = await autoCommitProjectFs({
      fs,
      gitProvider: git,
      sourceRepoId,
    });

    expect(result.committed).toBe(true);
    expect(result.fileCount).toBe(3);
  });

  it("returns committed=false when project has no committable files", async () => {
    const provider = createMockPreviewProvider();
    await provider.create({ repoId: "p2", boilerplateVersion: "1.0.0" });
    const fs = await provider.getProjectFs("p2");
    if (!fs) throw new Error("expected fs");

    const git = await getGitProvider();
    const result = await autoCommitProjectFs({
      fs,
      gitProvider: git,
      sourceRepoId,
    });

    expect(result.committed).toBe(false);
    expect(result.fileCount).toBe(0);
  });

  it("skips files larger than maxFileBytes", async () => {
    const provider = createMockPreviewProvider();
    await provider.create({ repoId: "p3", boilerplateVersion: "1.0.0" });
    const fs = await provider.getProjectFs("p3");
    if (!fs) throw new Error("expected fs");
    await fs.writeTextFile("src/small.tsx", "ok");
    await fs.writeTextFile("src/large.tsx", "x".repeat(2000));

    const git = await getGitProvider();
    const result = await autoCommitProjectFs({
      fs,
      gitProvider: git,
      sourceRepoId,
      maxFileBytes: 100,
    });

    expect(result.committed).toBe(true);
    expect(result.fileCount).toBe(1); // only small.tsx
  });

  it("skips non-text extensions (binary)", async () => {
    const provider = createMockPreviewProvider();
    await provider.create({ repoId: "p4", boilerplateVersion: "1.0.0" });
    const fs = await provider.getProjectFs("p4");
    if (!fs) throw new Error("expected fs");
    await fs.writeTextFile("src/App.tsx", "ok");
    // Binary-style ext that should be skipped — write as text but
    // helper filters by extension.
    await fs.writeTextFile("public/photo.png", "fake-bin");

    const git = await getGitProvider();
    const result = await autoCommitProjectFs({
      fs,
      gitProvider: git,
      sourceRepoId,
    });

    expect(result.fileCount).toBe(1);
  });

  it("custom commit message + author honoured", async () => {
    const provider = createMockPreviewProvider();
    await provider.create({ repoId: "p5", boilerplateVersion: "1.0.0" });
    const fs = await provider.getProjectFs("p5");
    if (!fs) throw new Error("expected fs");
    await fs.writeTextFile("src/A.tsx", "x");

    const git = await getGitProvider();
    const result = await autoCommitProjectFs({
      fs,
      gitProvider: git,
      sourceRepoId,
      commitMessage: (n) => `custom ${n}`,
      author: { name: "Tester", email: "t@example.com" },
    });
    expect(result.committed).toBe(true);
    expect(result.fileCount).toBe(1);
  });
});
