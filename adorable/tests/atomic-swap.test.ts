// IC-2 от VERIFICATION.md §2: проверяет что atomic symlink swap в
// preview-static.build() не оставляет окно, в котором читатель видит
// частичный или пропавший файл.
//
// Симулируем читателя в bg loop'е и параллельно swap'аем builds/A → B
// много раз. Каждое чтение должно вернуть валидный contents — либо "A"
// либо "B", никогда EMPTY и никогда ENOENT.
//
// Использует preview-static с mock executor + mock proxy: build()
// делает реальный atomic swap через node:fs.symlink + rename.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockProxyProvider } from "@/lib/adapters/proxy-mock";
import {
  createStaticPreviewProvider,
  type BuildExecutor,
  type BuildExecutorResult,
} from "@/lib/adapters/preview-static";
import type { PreviewProvider } from "@/lib/adapters/preview";

let projectsRoot: string;
let staticRoot: string;
let proxy: ReturnType<typeof createMockProxyProvider>;
let provider: PreviewProvider;

const succeededExecutor = (
  contents: string,
): BuildExecutor => ({
  async runBuild(input): Promise<BuildExecutorResult> {
    // Write index.html to artifactDir before returning.
    const fs = await import("node:fs/promises");
    await fs.writeFile(path.join(input.artifactDir, "index.html"), contents);
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: false,
      timedOut: false,
      durationMs: 0,
    };
  },
});

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "adorable-swap-projects-"));
  staticRoot = await mkdtemp(path.join(tmpdir(), "adorable-swap-static-"));
  proxy = createMockProxyProvider();
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
  await rm(staticRoot, { recursive: true, force: true });
});

describe("IC-2 atomic swap — reader never observes partial / missing", () => {
  it("repeated swap A↔B keeps current/index.html readable as one of {A,B}", async () => {
    // Build provider that writes "A" the first time, "B" the second, alt.
    let toggle = 0;
    const altExecutor: BuildExecutor = {
      async runBuild(input): Promise<BuildExecutorResult> {
        const value = toggle++ % 2 === 0 ? "A".repeat(2048) : "B".repeat(2048);
        const fs = await import("node:fs/promises");
        await fs.writeFile(path.join(input.artifactDir, "index.html"), value);
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          cancelled: false,
          timedOut: false,
          durationMs: 0,
        };
      },
    };
    provider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: altExecutor,
      buildHistoryLimit: 5,
    });
    await provider.create({ repoId: "p", boilerplateVersion: "1.0.0" });

    const currentIndex = path.join(staticRoot, "p", "current", "index.html");

    // Reader background loop:
    let reads = 0;
    let observedBad = 0;
    let stopReader = false;
    const reader = (async () => {
      while (!stopReader) {
        try {
          const txt = await readFile(currentIndex, "utf8");
          reads++;
          // Should be entirely A's, entirely B's, or the placeholder
          // (initial current → "Initial build pending..." HTML).
          if (
            !/^A+$/.test(txt) &&
            !/^B+$/.test(txt) &&
            !txt.includes("Initial build pending")
          ) {
            observedBad++;
          }
        } catch (err) {
          // ENOENT during swap is technically a violation of atomicity,
          // but Node's rename on POSIX is atomic at the inode level —
          // recursive readlink may still race with the symlink unlink.
          // Count as "bad" so we surface it.
          observedBad++;
          void err;
        }
      }
    })();

    // Builder loop: 25 swaps.
    for (let i = 0; i < 25; i++) {
      const r = await provider.build({
        projectId: "p",
        reason: "manual",
        buildId: `build-${i}`,
      });
      expect(r.status).toBe("succeeded");
      expect(r.wasSwapped).toBe(true);
    }
    stopReader = true;
    await reader;

    expect(reads).toBeGreaterThan(0);
    // Strict: zero observed-bad reads.
    expect(observedBad).toBe(0);
  });

  it("previous symlink remains valid after each successful swap", async () => {
    provider = createStaticPreviewProvider({
      projectsRoot,
      staticRoot,
      previewDomainSuffix: "preview.test",
      previewProtocol: "http",
      previewPortSegment: "",
      proxyProviderFactory: async () => proxy,
      buildExecutor: succeededExecutor("X"),
      buildHistoryLimit: 5,
    });
    await provider.create({ repoId: "p2", boilerplateVersion: "1.0.0" });

    await provider.build({ projectId: "p2", reason: "initial", buildId: "first" });
    await provider.build({ projectId: "p2", reason: "manual", buildId: "second" });
    const previousIndex = path.join(staticRoot, "p2", "previous", "index.html");
    const txt = await readFile(previousIndex, "utf8");
    expect(txt).toBe("X");
  });
});
