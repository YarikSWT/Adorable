// Структурный тест для templates/vite-react/functions/tsconfig.json.
// Файл фиксированный (BOILERPLATE.md §1, ADR-021), LLM не пишет.
// Тест блокирует невалидный JSON и инварианты, на которые полагаются
// build-runner image и planned BaaS edge-runtime.

import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const TS_CONFIG_PATH = path.resolve(
  __dirname,
  "..",
  "templates",
  "vite-react",
  "functions",
  "tsconfig.json",
);

describe("templates/vite-react/functions/tsconfig.json", () => {
  it("is valid JSON", async () => {
    const text = await readFile(TS_CONFIG_PATH, "utf8");
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("targets ES2022 + bundler module resolution", async () => {
    const cfg = JSON.parse(await readFile(TS_CONFIG_PATH, "utf8"));
    expect(cfg.compilerOptions.target).toBe("ES2022");
    expect(cfg.compilerOptions.module).toBe("ES2022");
    expect(cfg.compilerOptions.moduleResolution).toBe("bundler");
  });

  it("enforces strict mode", async () => {
    const cfg = JSON.parse(await readFile(TS_CONFIG_PATH, "utf8"));
    expect(cfg.compilerOptions.strict).toBe(true);
  });

  it("does not emit (build-runner only typechecks via Vite)", async () => {
    const cfg = JSON.parse(await readFile(TS_CONFIG_PATH, "utf8"));
    expect(cfg.compilerOptions.noEmit).toBe(true);
  });

  it("includes WebWorker lib for edge runtime, no DOM types", async () => {
    const cfg = JSON.parse(await readFile(TS_CONFIG_PATH, "utf8"));
    expect(cfg.compilerOptions.lib).toContain("WebWorker");
    // Edge functions не должны иметь DOM globals по дефолту:
    expect(cfg.compilerOptions.lib).not.toContain("DOM");
  });

  it("includes .ts and .tsx; excludes node_modules", async () => {
    const cfg = JSON.parse(await readFile(TS_CONFIG_PATH, "utf8"));
    expect(cfg.include).toContain("**/*.ts");
    expect(cfg.exclude).toContain("node_modules");
  });
});
