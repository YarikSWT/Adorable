// Integration tests для DockerBuildExecutor — gated на RUN_DOCKER_TESTS=1.
//
// Prerequisites:
//   - Docker daemon доступен (DOCKER_SOCKET).
//   - Образ build-runner-react:1.0.0 собран
//     (cd repo && docker build -f docker/build-runner-react/Dockerfile
//      -t build-runner-react:1.0.0 .).
//   - Named volume adorable_node_modules_react_1_0_0 заполнен init-volume.sh.
//   - Сеть adorable_build существует
//     (docker network create adorable_build).
//
// Без RUN_DOCKER_TESTS=1 — все тесты скипаются (describe.skip).
// Это означает что в Phase 2 без docker daemon выполняется только unit
// suite на buildContainerCreateOptions; полный запуск — Phase 6 acceptance.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDockerBuildExecutor } from "@/lib/preview/build-runner-docker";

const enabled = process.env["RUN_DOCKER_TESTS"] === "1";
const d = enabled ? describe : describe.skip;

let scratch: string;
let artifact: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "adorable-build-int-scratch-"));
  artifact = await mkdtemp(path.join(tmpdir(), "adorable-build-int-art-"));
  await mkdir(path.join(scratch, "src"), { recursive: true });
  await mkdir(path.join(scratch, "public"), { recursive: true });
  await mkdir(path.join(scratch, ".vite"), { recursive: true });
  // Минимальный src/main.jsx — Vite ожидает entry в index.html, который
  // в build-runner image'е (см. Dockerfile). main.jsx вызовом ReactDOM.
  await writeFile(
    path.join(scratch, "src", "main.jsx"),
    `import React from "react";
import ReactDOM from "react-dom/client";
const App = () => React.createElement("h1", null, "hello");
ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
`,
  );
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
  await rm(artifact, { recursive: true, force: true });
});

d("DockerBuildExecutor (live docker)", () => {
  it("runs vite build and produces an artifact dir", async () => {
    const executor = createDockerBuildExecutor();
    const res = await executor.runBuild({
      projectId: "int-test",
      buildId: "test-build",
      scratchDir: scratch,
      artifactDir: artifact,
      boilerplateVersion: "1.0.0",
    });
    expect(res.exitCode).toBe(0);
    expect(res.cancelled).toBe(false);
    expect(res.timedOut).toBe(false);
    expect(res.stdout.length).toBeGreaterThan(0);
  }, 60_000);

  it("respects AbortSignal (cancel mid-build)", async () => {
    const executor = createDockerBuildExecutor();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const res = await executor.runBuild({
      projectId: "int-cancel",
      buildId: "cancel-build",
      scratchDir: scratch,
      artifactDir: artifact,
      boilerplateVersion: "1.0.0",
      signal: ac.signal,
    });
    expect(res.cancelled).toBe(true);
  }, 30_000);
});
