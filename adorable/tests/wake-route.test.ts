// Tests for POST /api/repos/[repoId]/wake — sandbox-mode revives
// dead containers; static-mode is a no-op (preview is served by
// Caddy from disk artifacts, no container to wake).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 24 — Better Auth wrapper bypass. Tests below were written against the
// old identity-cookie ACL flow; we mock the new auth/db helpers as
// pass-through so the underlying behaviour (build queue, sandbox lifecycle,
// upload validation, ...) keeps being exercised. Per-test overrides via
// `vi.mocked(...).mockImplementationOnce(...)` if a test needs to simulate
// denial.
vi.mock("@/lib/auth/api-wrap", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/api-wrap")>(
      "@/lib/auth/api-wrap",
    );
  return {
    ...actual,
    protectedRoute:
      <P>(handler: any) =>
      async (req: Request, ctx: any): Promise<Response> => {
        const params = await ctx.params;
        try {
          return await handler({
            req,
            params,
            session: {
              user: {
                id: "test-user",
                email: "test@example.com",
                emailVerified: true,
                isAdmin: false,
              },
              sessionId: "test-session",
            },
          });
        } catch (err) {
          const { errorToResponse } = await import("@/lib/auth/errors");
          return errorToResponse(err);
        }
      },
  };
});
vi.mock("@/lib/auth/session", () => ({
  getRequestSession: vi.fn(async () => ({
    user: {
      id: "test-user",
      email: "test@example.com",
      emailVerified: true,
      isAdmin: false,
    },
    sessionId: "test-session",
  })),
  requireSession: vi.fn(async () => ({
    user: {
      id: "test-user",
      email: "test@example.com",
      emailVerified: true,
      isAdmin: false,
    },
    sessionId: "test-session",
  })),
  requireEmailVerified: vi.fn((s: unknown) => s),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn(async () => ({})),
  getProjectAccessContext: vi.fn(async () => ({
    projectId: "test-project",
    organizationId: "test-org",
    effectiveRoleId: "test-role",
    permissions: new Set([
      "project.view",
      "project.edit",
      "project.delete",
      "project.publish",
      "project.tokens.manage",
      "project.members.manage",
      "project.domain.manage",
    ]),
  })),
}));
vi.mock("@/lib/db/queries/projects", () => ({
  getProjectByGiteaWrapperId: vi.fn(async (id: string) => ({
    id: "test-project",
    organizationId: "test-org",
    giteaRepoId: id,
    giteaRepoName: id,
    giteaWrapperRepoId: id,
    giteaWrapperRepoName: id,
  })),
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

import { readRepoMetadata } from "@/lib/repo-storage";
import { getSandboxProvider } from "@/lib/sandbox/provider-singleton";
import { createVmForRepo } from "@/lib/adorable-vm";
import { POST } from "@/app/api/repos/[repoId]/wake/route";

const mockIdentity = (repoIds: string[]) => {
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
  // Phase 24: identity-cookie ACL replaced by Better Auth — denial path now
  // flows through requirePermission throwing 403/404 (covered in tests/auth/authorization.test.ts).
  it.skip("returns 403 when caller has no grant", async () => {
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
