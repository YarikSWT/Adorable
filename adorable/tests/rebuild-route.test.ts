// Тесты для POST /api/projects/[id]/rebuild (CONTRACTS §17).
//
// Используем vi.mock для identity-session — единственная неподдельная
// внешняя зависимость в этом роуте. Preview provider + build queue —
// уже mock'и в vitest env.

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



import {
  __resetPreviewSingleton,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";
import { POST } from "@/app/api/projects/[id]/rebuild/route";
import type { PreviewProvider } from "@/lib/adapters/preview";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
};

const callPost = async (id: string): Promise<Response> => {
  return POST(new Request("http://localhost/api/projects/" + id + "/rebuild", {
    method: "POST",
  }), {
    params: Promise.resolve({ id }),
  });
};

beforeEach(async () => {
  __resetPreviewSingleton();
  vi.clearAllMocks();
});

afterEach(() => {
  __resetPreviewSingleton();
});

describe("POST /api/projects/[id]/rebuild", () => {
  it("returns 200 + {jobId, status:'running'} for the owner of the repo", async () => {
    mockIdentity([{ id: "p-rb-1", name: "p-rb-1" }]);
    // Mock provider needs the project to exist before build() can run cleanly.
    // The route doesn't require it — enqueue triggers runJob which calls
    // provider.build({projectId}). Mock provider returns succeeded even
    // for unknown projectId (it just maps capabilities).
    const res = await callPost("p-rb-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobId: string; status: string };
    expect(body.status).toMatch(/^(running|queued)$/);
    expect(typeof body.jobId).toBe("string");
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  // Phase 24: identity-cookie ACL replaced by Better Auth — denial path now
  // flows through requirePermission throwing 403/404 (covered in tests/auth/authorization.test.ts).
  it.skip("returns 403 if caller does not own the repo", async () => {
    mockIdentity([{ id: "other-repo", name: "other-repo" }]);
    const res = await callPost("p-forbidden");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Forbidden");
  });

  it("URL-decodes the repo id from the path", async () => {
    mockIdentity([{ id: "scope/inner", name: "scope/inner" }]);
    const res = await POST(
      new Request("http://localhost/api/projects/scope%2Finner/rebuild", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "scope%2Finner" }) },
    );
    expect(res.status).toBe(200);
  });

  it("returns 403 when provider.capabilities.manualRebuild=false", async () => {
    mockIdentity([{ id: "p-no-rebuild", name: "p-no-rebuild" }]);
    // Patch the singleton-resolved provider so its capabilities deny
    // manual rebuild. Reset between tests restores the env-driven default.
    const real = await getPreviewProvider();
    const patched: PreviewProvider = {
      ...real,
      capabilities: { ...real.capabilities, manualRebuild: false },
    };
    const spy = vi
      .spyOn(
        await import("@/lib/preview/provider-singleton"),
        "getPreviewProvider",
      )
      .mockResolvedValue(patched);
    try {
      const res = await callPost("p-no-rebuild");
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/manualRebuild not supported/);
    } finally {
      spy.mockRestore();
    }
  });
});
