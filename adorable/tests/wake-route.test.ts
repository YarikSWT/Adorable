// Tests for POST /api/repos/[repoId]/wake — sandbox-mode revives
// dead containers; static-mode is a no-op (preview is served by
// Caddy from disk artifacts, no container to wake).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity-session", () => ({
  getOrCreateIdentitySession: vi.fn(),
}));

vi.mock("@/lib/repo-storage", () => ({
  readRepoMetadata: vi.fn(),
  writeRepoMetadata: vi.fn(),
}));

vi.mock("@/lib/sandbox/provider-singleton", () => ({
  getSandboxProvider: vi.fn(),
}));

vi.mock("@/lib/adorable-vm", () => ({
  createVmForRepo: vi.fn(),
}));

import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { readRepoMetadata } from "@/lib/repo-storage";
import { getSandboxProvider } from "@/lib/sandbox/provider-singleton";
import { createVmForRepo } from "@/lib/adorable-vm";
import { POST } from "@/app/api/repos/[repoId]/wake/route";

const mockIdentity = (repoIds: string[]) => {
  (getOrCreateIdentitySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    identity: {
      permissions: {
        git: {
          list: vi.fn(async () => ({
            repositories: repoIds.map((id) => ({ id, name: id })),
          })),
        },
      },
    },
  });
};

const callPost = async (id: string): Promise<Response> => {
  return POST(
    new Request(`http://localhost/api/repos/${encodeURIComponent(id)}/wake`, {
      method: "POST",
    }),
    { params: Promise.resolve({ repoId: encodeURIComponent(id) }) },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/repos/[repoId]/wake", () => {
  it("returns 403 when caller has no grant", async () => {
    mockIdentity(["other-repo"]);
    const res = await callPost("static-repo");
    expect(res.status).toBe(403);
  });

  it("static-mode project: no-op, returns existing vm verbatim (no sandbox lifecycle)", async () => {
    const wrapperId = "adorable/adorable-meta-static-1";
    mockIdentity([wrapperId]);
    const fakeVm = {
      vmId: "adorable/adorable-src-static-1",
      previewUrl: "http://abcd1234.preview.test:8080",
      devCommandTerminalUrl: "",
      additionalTerminalsUrl: "",
    };
    (readRepoMetadata as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceRepoId: "adorable/adorable-src-static-1",
      vm: fakeVm,
      preview: {
        provider: "static",
        capabilities: {
          shellAccess: false,
          customDependencies: false,
          serverRuntime: false,
          hotReload: false,
          manualRebuild: true,
        },
      },
    });

    const res = await callPost(wrapperId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recreated: boolean; vm: typeof fakeVm };
    expect(body.recreated).toBe(false);
    expect(body.vm).toEqual(fakeVm);

    // Critical: sandbox provider must NOT have been touched.
    expect(getSandboxProvider).not.toHaveBeenCalled();
    expect(createVmForRepo).not.toHaveBeenCalled();
  });

  it("sandbox-mode + alive: returns existing vm (no recreate)", async () => {
    const wrapperId = "adorable/adorable-meta-sandbox-1";
    mockIdentity([wrapperId]);
    const fakeVm = {
      vmId: "sbx-existing",
      previewUrl: "http://existing.preview.test",
      devCommandTerminalUrl: "",
      additionalTerminalsUrl: "",
    };
    (readRepoMetadata as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceRepoId: "adorable/adorable-src-sandbox-1",
      vm: fakeVm,
      preview: {
        provider: "sandbox",
        capabilities: {
          shellAccess: true,
          customDependencies: true,
          serverRuntime: true,
          hotReload: true,
          manualRebuild: true,
        },
      },
    });
    (getSandboxProvider as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ref: vi.fn(async () => ({ status: "running" })),
    });

    const res = await callPost(wrapperId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recreated: boolean; vm: typeof fakeVm };
    expect(body.recreated).toBe(false);
    expect(body.vm).toEqual(fakeVm);
    expect(createVmForRepo).not.toHaveBeenCalled();
  });
});
