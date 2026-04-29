// Контракт-тесты для PreviewProvider — крутятся против MockPreviewProvider.
//
// Покрывает CONTRACTS.md §1–10:
//   - resolvePreviewProviderName / createPreviewProvider factory
//   - lifecycle: create → build → destroy + idempotence
//   - capabilities pinning
//   - PreviewMetadata формат (terminalUrls только при shellAccess)
//   - ProjectFs roundtrip (read/write/list/search/exists/remove/rename)
//
// Реальные адаптеры (preview-static / preview-sandbox) будут проверяться
// в отдельных integration-suite'ах (RUN_DOCKER_TESTS / sandbox-e2e).

import { beforeEach, describe, expect, it } from "vitest";

import {
  createPreviewProvider,
  resolvePreviewProviderName,
  SANDBOX_CAPABILITIES,
  STATIC_CAPABILITIES,
  type PreviewProvider,
} from "@/lib/adapters/preview";
import { createMockPreviewProvider } from "@/lib/adapters/preview-mock";

const getMock = async (): Promise<PreviewProvider> => {
  return createPreviewProvider({ providerOverride: "mock" });
};

describe("resolvePreviewProviderName", () => {
  it("defaults to mock in vitest env", () => {
    expect(resolvePreviewProviderName()).toBe("mock");
  });

  it("honours explicit override", () => {
    expect(resolvePreviewProviderName("static")).toBe("static");
    expect(resolvePreviewProviderName("sandbox")).toBe("sandbox");
    expect(resolvePreviewProviderName("docker")).toBe("sandbox");
    expect(resolvePreviewProviderName("mock")).toBe("mock");
  });

  it("normalises case + whitespace", () => {
    expect(resolvePreviewProviderName("  Static  ")).toBe("static");
    expect(resolvePreviewProviderName("SANDBOX")).toBe("sandbox");
  });
});

describe("PreviewProvider contract (mock, static caps)", () => {
  let provider: PreviewProvider;

  beforeEach(async () => {
    provider = await getMock();
  });

  it("declares static capabilities by default", () => {
    expect(provider.name).toBe("mock");
    expect(provider.capabilities).toEqual(STATIC_CAPABILITIES);
    expect(provider.capabilities.shellAccess).toBe(false);
    expect(provider.capabilities.manualRebuild).toBe(true);
  });

  it("create returns metadata with preview + published URLs", async () => {
    const meta = await provider.create({
      repoId: "proj-1",
      boilerplateVersion: "1.0.0",
    });
    expect(meta.projectId).toBe("proj-1");
    expect(meta.previewUrl).toContain("proj-1");
    expect(meta.publishedUrl).toContain("proj-1");
    expect(meta.capabilities).toEqual(STATIC_CAPABILITIES);
    expect(meta.terminalUrls).toBeUndefined();
    expect(meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("create is idempotent — same metadata on repeat", async () => {
    const a = await provider.create({
      repoId: "proj-idem",
      boilerplateVersion: "1.0.0",
    });
    const b = await provider.create({
      repoId: "proj-idem",
      boilerplateVersion: "1.0.0",
    });
    expect(b).toEqual(a);
  });

  it("build returns a succeeded BuildResult by default", async () => {
    await provider.create({
      repoId: "proj-build",
      boilerplateVersion: "1.0.0",
    });
    const res = await provider.build({
      projectId: "proj-build",
      reason: "initial",
    });
    expect(res.status).toBe("succeeded");
    expect(res.exitCode).toBe(0);
    expect(res.wasSwapped).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.artifactPath).toBeDefined();
  });

  it("build respects skipCurrentSwap", async () => {
    await provider.create({
      repoId: "proj-skip",
      boilerplateVersion: "1.0.0",
    });
    const res = await provider.build({
      projectId: "proj-skip",
      reason: "migration",
      skipCurrentSwap: true,
    });
    expect(res.status).toBe("succeeded");
    expect(res.wasSwapped).toBe(false);
  });

  it("destroy is idempotent and clears project state", async () => {
    await provider.create({
      repoId: "proj-d",
      boilerplateVersion: "1.0.0",
    });
    expect(await provider.getProjectFs("proj-d")).not.toBeNull();
    await provider.destroy("proj-d");
    expect(await provider.getProjectFs("proj-d")).toBeNull();
    // Repeat should not throw.
    await provider.destroy("proj-d");
    await provider.destroy("never-existed");
  });

  it("getProjectFs supports write/read/list/search/remove roundtrip", async () => {
    await provider.create({
      repoId: "proj-fs",
      boilerplateVersion: "1.0.0",
    });
    const fs = await provider.getProjectFs("proj-fs");
    if (!fs) throw new Error("expected fs");

    await fs.writeTextFile("src/App.tsx", "export const App = () => null;\n");
    await fs.writeTextFile("src/utils/x.ts", "export const x = 1;\n");
    await fs.writeTextFile("public/icon.svg", "<svg />\n");

    expect(await fs.readTextFile("src/App.tsx")).toContain("App");
    expect(await fs.exists("src/App.tsx")).toBe(true);
    expect(await fs.exists("src/utils")).toBe(true);
    expect(await fs.exists("does-not-exist")).toBe(false);

    const recursive = await fs.list({ recursive: true });
    const filePaths = recursive
      .filter((e) => e.type === "file")
      .map((e) => e.path)
      .sort();
    expect(filePaths).toEqual([
      "public/icon.svg",
      "src/App.tsx",
      "src/utils/x.ts",
    ]);

    const found = await fs.search({ query: "export" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((r) => r.text.includes("export"))).toBe(true);

    await fs.rename("src/utils/x.ts", "src/utils/y.ts");
    expect(await fs.exists("src/utils/x.ts")).toBe(false);
    expect(await fs.exists("src/utils/y.ts")).toBe(true);

    await fs.remove("src/utils/y.ts");
    expect(await fs.exists("src/utils/y.ts")).toBe(false);
  });

  it("ProjectFs rejects path traversal and absolute paths", async () => {
    await provider.create({
      repoId: "proj-sec",
      boilerplateVersion: "1.0.0",
    });
    const fs = await provider.getProjectFs("proj-sec");
    if (!fs) throw new Error("expected fs");
    await expect(fs.writeTextFile("../escape.txt", "x")).rejects.toThrow();
    await expect(fs.writeTextFile("/etc/passwd", "x")).rejects.toThrow();
  });
});

describe("PreviewProvider contract (mock, sandbox caps)", () => {
  it("exposes terminalUrls when shellAccess is on", async () => {
    const provider = createMockPreviewProvider({
      capabilities: SANDBOX_CAPABILITIES,
    });
    const meta = await provider.create({
      repoId: "proj-sandbox",
      boilerplateVersion: "1.0.0",
    });
    expect(meta.capabilities).toEqual(SANDBOX_CAPABILITIES);
    expect(meta.terminalUrls).toBeDefined();
    expect(meta.terminalUrls?.devCommand).toContain("proj-sandbox");
    expect(meta.terminalUrls?.additional).toContain("proj-sandbox");
  });

  it("can configure build outcome to failed", async () => {
    const provider = createMockPreviewProvider({ buildOutcome: "failed" });
    await provider.create({
      repoId: "proj-fail",
      boilerplateVersion: "1.0.0",
    });
    const res = await provider.build({
      projectId: "proj-fail",
      reason: "manual",
    });
    expect(res.status).toBe("failed");
    expect(res.exitCode).toBeGreaterThan(0);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.wasSwapped).toBe(false);
  });
});
