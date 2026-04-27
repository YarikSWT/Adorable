// Тесты для lib/template-seeder.ts и бандла дефолтного Vite + React
// шаблона в adorable/templates/vite-react/.
//
// Проверяем:
//   1. Template-директория бандлится вместе с кодом (есть обязательные
//      файлы: index.html, package.json, vite.config.js, src/main.jsx и т.д.).
//   2. package.json шаблона — валидный JSON с dev-скриптом и vite/react deps.
//   3. seedTemplateRepo коммитит ВСЕ файлы шаблона одним коммитом в
//      default-branch через GitProvider.commits.create.
//   4. Ignored-пути (node_modules/, dist/, .git/) не попадают в коммит.

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  resolveTemplateDir,
  seedTemplateRepo,
} from "@/lib/template-seeder";
import {
  createMockGitProvider,
  type MockGitProvider,
} from "@/lib/adapters/git-mock";

describe("bundled vite-react template integrity", () => {
  const dir = resolveTemplateDir();

  it("points to adorable/templates/vite-react by default", () => {
    expect(dir.endsWith(path.join("templates", "vite-react"))).toBe(true);
  });

  const required: ReadonlyArray<string> = [
    "index.html",
    "package.json",
    "vite.config.js",
    "postcss.config.js",
    "tailwind.config.js",
    "jsconfig.json",
    "src/main.jsx",
    "src/App.jsx",
    "src/index.css",
    "src/pages/Home.jsx",
    "src/components/ui/button.jsx",
    "src/lib/utils.js",
  ];

  for (const rel of required) {
    it(`bundles required file: ${rel}`, async () => {
      const full = path.join(dir, rel);
      await expect(fs.access(full)).resolves.toBeUndefined();
      const content = await fs.readFile(full, "utf8");
      expect(content.length).toBeGreaterThan(0);
    });
  }

  it("package.json is valid JSON with vite + react deps and a dev script", async () => {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.scripts?.dev).toBeTruthy();
    expect(pkg.scripts?.build).toBeTruthy();
    expect(pkg.dependencies?.react).toBeTruthy();
    expect(pkg.dependencies?.["react-dom"]).toBeTruthy();
    expect(pkg.devDependencies?.vite).toBeTruthy();
    expect(pkg.devDependencies?.tailwindcss).toBeTruthy();
  });
});

describe("seedTemplateRepo", () => {
  let provider: MockGitProvider;

  beforeEach(() => {
    provider = createMockGitProvider();
  });

  it("заливает все файлы шаблона одним коммитом в default-branch", async () => {
    const created = await provider.createRepo({ name: "seeded" });
    const { sha, fileCount } = await seedTemplateRepo({
      provider,
      repo: created.repo,
    });

    expect(sha).toBeTruthy();
    expect(fileCount).toBeGreaterThanOrEqual(10);

    // Mock provider хранит latest state в repo.files.
    const state = provider.inspect(created.repoId);
    expect(state).toBeDefined();
    expect(state!.files.has("index.html")).toBe(true);
    expect(state!.files.has("src/main.jsx")).toBe(true);
    expect(state!.files.has("src/pages/Home.jsx")).toBe(true);
    expect(state!.files.has("package.json")).toBe(true);

    const packageJson = state!.files.get("package.json")!;
    const parsed = JSON.parse(packageJson);
    expect(parsed.dependencies.react).toBeTruthy();

    // Commit history содержит seed-коммит.
    expect(state!.commits.length).toBe(1);
    expect(state!.commits[0]!.message).toMatch(/template|initial/i);
  });

  it("игнорирует node_modules/, dist/, .git/ при seeding'е", async () => {
    // Готовим временную копию шаблона с «грязью», которую надо отфильтровать.
    const dirtyRoot = await fs.mkdtemp(path.join(tmpdir(), "adorable-tpl-"));
    try {
      await fs.mkdir(path.join(dirtyRoot, "node_modules"), { recursive: true });
      await fs.writeFile(
        path.join(dirtyRoot, "node_modules", "should-not-commit.js"),
        "export default 'leak'",
      );
      await fs.mkdir(path.join(dirtyRoot, "dist"), { recursive: true });
      await fs.writeFile(
        path.join(dirtyRoot, "dist", "bundle.js"),
        "console.log('nope')",
      );
      await fs.mkdir(path.join(dirtyRoot, ".git"), { recursive: true });
      await fs.writeFile(
        path.join(dirtyRoot, ".git", "config"),
        "[core]\n\trepositoryformatversion = 0\n",
      );
      await fs.writeFile(
        path.join(dirtyRoot, "package.json"),
        JSON.stringify({ name: "dirty", private: true }, null, 2),
      );
      await fs.writeFile(
        path.join(dirtyRoot, "index.html"),
        "<!doctype html><html></html>",
      );

      const created = await provider.createRepo({ name: "dirty-tpl" });
      const { fileCount } = await seedTemplateRepo({
        provider,
        repo: created.repo,
        templateDir: dirtyRoot,
      });

      const state = provider.inspect(created.repoId)!;
      expect(fileCount).toBe(2);
      expect(state.files.has("package.json")).toBe(true);
      expect(state.files.has("index.html")).toBe(true);
      expect(state.files.has("node_modules/should-not-commit.js")).toBe(false);
      expect(state.files.has("dist/bundle.js")).toBe(false);
      expect(state.files.has(".git/config")).toBe(false);
    } finally {
      await fs.rm(dirtyRoot, { recursive: true, force: true });
    }
  });

  it("падает с внятной ошибкой, когда template-dir пустой или отсутствует", async () => {
    const created = await provider.createRepo({ name: "empty" });
    const emptyDir = await fs.mkdtemp(path.join(tmpdir(), "adorable-empty-"));
    try {
      await expect(
        seedTemplateRepo({
          provider,
          repo: created.repo,
          templateDir: emptyDir,
        }),
      ).rejects.toThrow(/no files found/i);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }

    await expect(
      seedTemplateRepo({
        provider,
        repo: created.repo,
        templateDir: "/nonexistent/adorable-seeder-test-xyz",
      }),
    ).rejects.toThrow(/cannot read directory/i);
  });
});
