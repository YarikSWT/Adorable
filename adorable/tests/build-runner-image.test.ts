// Структурные тесты для docker/build-runner-react/.
//
// Без docker daemon мы не можем выполнить `docker build`, но можем
// зафиксировать ключевые инварианты Dockerfile и init-volume.sh:
//   - non-root user 1000:1000 (BUILD_PIPELINE §4.2)
//   - копирует фиксированные boilerplate-файлы
//   - имеет /workspace WORKDIR
//   - VERSION файл копируется в образ
//   - init-volume.sh refuses to overwrite non-empty volume
//
// Полный e2e (docker build + run) — gated отдельно через
// RUN_DOCKER_TESTS=1 в Phase 6.

import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

// adorable/ → repo root
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOCKERFILE = path.join(
  REPO_ROOT,
  "docker",
  "build-runner-react",
  "Dockerfile",
);
const INIT_VOLUME = path.join(
  REPO_ROOT,
  "docker",
  "build-runner-react",
  "init-volume.sh",
);

describe("docker/build-runner-react/Dockerfile", () => {
  it("uses node:22-slim base", async () => {
    const text = await readFile(DOCKERFILE, "utf8");
    expect(text).toMatch(/FROM\s+node:\$\{NODE_VERSION\}-slim/);
    expect(text).toMatch(/ARG\s+NODE_VERSION=22/);
  });

  it("sets WORKDIR /workspace", async () => {
    const text = await readFile(DOCKERFILE, "utf8");
    expect(text).toMatch(/WORKDIR\s+\/workspace/);
  });

  it("runs as non-root user 1000:1000 (BUILD_PIPELINE §4.2)", async () => {
    const text = await readFile(DOCKERFILE, "utf8");
    expect(text).toMatch(/USER\s+1000:1000/);
  });

  it("copies the fixed boilerplate files", async () => {
    const text = await readFile(DOCKERFILE, "utf8");
    for (const fixedFile of [
      "vite.config.js",
      "tailwind.config.js",
      "postcss.config.js",
      "jsconfig.json",
      "index.html",
      "package.json",
      "VERSION",
    ]) {
      expect(text).toContain(fixedFile);
    }
  });

  it("default CMD runs vite build", async () => {
    const text = await readFile(DOCKERFILE, "utf8");
    expect(text).toMatch(/CMD\s+\["npx",\s*"vite",\s*"build"\]/);
  });

  it("creates functions/ directory for tsconfig.json (ADR-021)", async () => {
    const text = await readFile(DOCKERFILE, "utf8");
    expect(text).toMatch(/mkdir -p functions/);
    expect(text).toMatch(/functions\/tsconfig\.json/);
  });

  it("does NOT install dev/build deps that imply network at runtime", async () => {
    const text = await readFile(DOCKERFILE, "utf8");
    // Билд-runner использует Vite — Vite не должен скачивать ничего во
    // время `vite build` (мы запускаем с NetworkMode: internal).
    expect(text).not.toMatch(/npm\s+install\s+-g/);
  });
});

describe("docker/build-runner-react/init-volume.sh", () => {
  it("uses POSIX sh + set -eu", async () => {
    const text = await readFile(INIT_VOLUME, "utf8");
    expect(text).toMatch(/^#!\/usr\/bin\/env\s+sh/);
    expect(text).toMatch(/set\s+-eu/);
  });

  it("copies from /workspace/node_modules to /mnt/dest", async () => {
    const text = await readFile(INIT_VOLUME, "utf8");
    expect(text).toMatch(/SRC=\/workspace\/node_modules/);
    expect(text).toMatch(/DEST=\/mnt\/dest/);
    expect(text).toMatch(/cp -a/);
  });

  it("refuses to overwrite non-empty destination", async () => {
    const text = await readFile(INIT_VOLUME, "utf8");
    expect(text).toMatch(/refusing to overwrite/);
    expect(text).toMatch(/exit 3/);
  });

  it("exits non-zero if SRC is missing (broken image)", async () => {
    const text = await readFile(INIT_VOLUME, "utf8");
    expect(text).toMatch(/exit 2/);
  });
});
