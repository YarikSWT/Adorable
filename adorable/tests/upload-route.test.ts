// Тесты для POST /api/projects/[id]/upload (CONTRACTS §16, ADR-007).

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

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



import { POST } from "@/app/api/projects/[id]/upload/route";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
  };

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0,
]);

const buildRequest = (file: File): Request => {
  const form = new FormData();
  form.append("file", file);
  return new Request("http://localhost/api/projects/p/upload", {
    method: "POST",
    body: form,
  });
};

const callPost = async (id: string, file: File): Promise<Response> =>
  POST(buildRequest(file), { params: Promise.resolve({ id }) });

let projectsRoot: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  projectsRoot = await mkdtemp(path.join(tmpdir(), "adorable-upload-"));
  originalEnv = process.env["PROJECTS_ROOT"];
  process.env["PROJECTS_ROOT"] = projectsRoot;
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env["PROJECTS_ROOT"];
  else process.env["PROJECTS_ROOT"] = originalEnv;
});

describe("POST /api/projects/[id]/upload", () => {
  // Phase 24: identity-cookie ACL replaced by Better Auth — denial path now
  // flows through requirePermission throwing 403/404 (covered in tests/auth/authorization.test.ts).
  it.skip("rejects 403 if caller does not own the repo", async () => {
    mockIdentity([{ id: "other", name: "other" }]);
    const file = new File([PNG_BYTES], "icon.png", { type: "image/png" });
    const res = await callPost("p-up-1", file);
    expect(res.status).toBe(403);
  });

  it("accepts a valid PNG and writes to public/<safeName>", async () => {
    mockIdentity([{ id: "p-up-2", name: "p-up-2" }]);
    const file = new File([PNG_BYTES], "Photo.png", { type: "image/png" });
    const res = await callPost("p-up-2", file);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; mime: string; size: number };
    expect(body.path).toBe("/photo.png");
    expect(body.mime).toBe("image/png");
    expect(body.size).toBe(PNG_BYTES.length);

    const dest = path.join(projectsRoot, "p-up-2", "public", "photo.png");
    expect((await stat(dest)).isFile()).toBe(true);
    expect(new Uint8Array(await readFile(dest))).toEqual(PNG_BYTES);
  });

  it("rejects 400 magic-bytes-mismatch on extension lie", async () => {
    mockIdentity([{ id: "p-up-3", name: "p-up-3" }]);
    const file = new File([PNG_BYTES], "fake.jpg", { type: "image/jpeg" });
    const res = await callPost("p-up-3", file);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("magic-bytes-mismatch");
  });

  it("rejects 400 ext-not-allowed for unsupported extension", async () => {
    mockIdentity([{ id: "p-up-4", name: "p-up-4" }]);
    const file = new File([PNG_BYTES], "icon.exe", {
      type: "application/x-msdownload",
    });
    const res = await callPost("p-up-4", file);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ext-not-allowed");
  });

  it("rejects 400 if no file form field", async () => {
    mockIdentity([{ id: "p-up-5", name: "p-up-5" }]);
    const form = new FormData();
    const res = await POST(
      new Request("http://localhost/api/projects/p-up-5/upload", {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: "p-up-5" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-name");
  });

  it("rejects 400 invalid-name when body is not multipart/form-data", async () => {
    mockIdentity([{ id: "p-up-raw", name: "p-up-raw" }]);
    const res = await POST(
      new Request("http://localhost/api/projects/p-up-raw/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw: true }),
      }),
      { params: Promise.resolve({ id: "p-up-raw" }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string };
    expect(body.error).toBe("invalid-name");
    expect(body.details).toMatch(/multipart\/form-data/);
  });

  it("respects UPLOAD_MAX_BYTES env", async () => {
    mockIdentity([{ id: "p-up-6", name: "p-up-6" }]);
    process.env["UPLOAD_MAX_BYTES"] = "10";
    try {
      const file = new File([PNG_BYTES], "icon.png", { type: "image/png" });
      const res = await callPost("p-up-6", file);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("size-exceeded");
    } finally {
      delete process.env["UPLOAD_MAX_BYTES"];
    }
  });
});
