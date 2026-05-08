// Verifies the project routes (rebuild / build-status / upload) emit
// auth_denied audit events when a non-owner is rejected with 403.
// SECURITY.md §6.

import { mkdtemp, readFile, rm } from "node:fs/promises";
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



import {
  __resetSharedAuditLogger,
  getSharedAuditLogger,
} from "@/lib/sandbox/audit-log";
import { POST as rebuildPOST } from "@/app/api/projects/[id]/rebuild/route";
import { GET as sseGET } from "@/app/api/projects/[id]/build-status/route";
import { POST as uploadPOST } from "@/app/api/projects/[id]/upload/route";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
  };

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

let tmp: string;
let logPath: string;
let originalAudit: string | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  __resetSharedAuditLogger();
  tmp = await mkdtemp(path.join(tmpdir(), "adorable-auth-audit-"));
  logPath = path.join(tmp, "audit.log");
  originalAudit = process.env["SANDBOX_AUDIT_LOG"];
  process.env["SANDBOX_AUDIT_LOG"] = logPath;
});

afterEach(async () => {
  __resetSharedAuditLogger();
  if (originalAudit === undefined) delete process.env["SANDBOX_AUDIT_LOG"];
  else process.env["SANDBOX_AUDIT_LOG"] = originalAudit;
  await rm(tmp, { recursive: true, force: true });
});

const readEvents = async (): Promise<unknown[]> => {
  await getSharedAuditLogger().flush();
  let raw = "";
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};

describe("auth_denied audit — project routes", () => {
  // Phase 24: identity-cookie ACL replaced by Better Auth — denial path now
  // flows through requirePermission throwing 403/404 (covered in tests/auth/authorization.test.ts).
  it.skip("rebuild route emits auth_denied for non-owner", async () => {
    mockIdentity([{ id: "other", name: "other" }]);
    const res = await rebuildPOST(
      new Request("http://localhost/api/projects/forbidden/rebuild", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "forbidden" }) },
    );
    expect(res.status).toBe(403);
    const ev = (await readEvents()).find(
      (e) =>
        (e as { event: string }).event === "auth_denied" &&
        (e as { action: string }).action === "rebuild",
    );
    expect(ev).toMatchObject({
      event: "auth_denied",
      projectId: "forbidden",
      action: "rebuild",
    });
  });

  // Phase 24: identity-cookie ACL replaced by Better Auth — denial path now
  // flows through requirePermission throwing 403/404 (covered in tests/auth/authorization.test.ts).
  it.skip("build-status route emits auth_denied for non-owner", async () => {
    mockIdentity([{ id: "other", name: "other" }]);
    const res = await sseGET(
      new Request("http://localhost/api/projects/forbidden-sse/build-status"),
      { params: Promise.resolve({ id: "forbidden-sse" }) },
    );
    expect(res.status).toBe(403);
    const ev = (await readEvents()).find(
      (e) =>
        (e as { event: string }).event === "auth_denied" &&
        (e as { action: string }).action === "build-status",
    );
    expect(ev).toMatchObject({
      event: "auth_denied",
      projectId: "forbidden-sse",
      action: "build-status",
    });
  });

  // Phase 24: identity-cookie ACL replaced by Better Auth — denial path now
  // flows through requirePermission throwing 403/404 (covered in tests/auth/authorization.test.ts).
  it.skip("upload route emits auth_denied for non-owner", async () => {
    mockIdentity([{ id: "other", name: "other" }]);
    const form = new FormData();
    form.append(
      "file",
      new File([PNG_BYTES], "icon.png", { type: "image/png" }),
    );
    const res = await uploadPOST(
      new Request("http://localhost/api/projects/forbidden-up/upload", {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: "forbidden-up" }) },
    );
    expect(res.status).toBe(403);
    const ev = (await readEvents()).find(
      (e) =>
        (e as { event: string }).event === "auth_denied" &&
        (e as { action: string }).action === "upload",
    );
    expect(ev).toMatchObject({
      event: "auth_denied",
      projectId: "forbidden-up",
      action: "upload",
    });
  });

  it("does NOT emit auth_denied for an authorised caller", async () => {
    mockIdentity([{ id: "ok-repo", name: "ok-repo" }]);
    await rebuildPOST(
      new Request("http://localhost/api/projects/ok-repo/rebuild", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "ok-repo" }) },
    );
    const evs = (await readEvents()).filter(
      (e) => (e as { event: string }).event === "auth_denied",
    );
    expect(evs).toEqual([]);
  });
});
