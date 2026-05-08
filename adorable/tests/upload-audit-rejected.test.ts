// Verifies the upload route emits the upload_rejected audit event for
// each validator error code (SECURITY.md §6).
//
// Uses a per-test audit log path (SANDBOX_AUDIT_LOG env), reads the
// JSON-lines back, and asserts the right reason was recorded.

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
import { POST } from "@/app/api/projects/[id]/upload/route";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
  };

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

let tmp: string;
let logPath: string;
let projectsRoot: string;
let originals: Record<string, string | undefined>;

beforeEach(async () => {
  vi.clearAllMocks();
  __resetSharedAuditLogger();
  tmp = await mkdtemp(path.join(tmpdir(), "adorable-upload-audit-"));
  logPath = path.join(tmp, "audit.log");
  projectsRoot = path.join(tmp, "projects");
  originals = {
    SANDBOX_AUDIT_LOG: process.env["SANDBOX_AUDIT_LOG"],
    PROJECTS_ROOT: process.env["PROJECTS_ROOT"],
    UPLOAD_MAX_BYTES: process.env["UPLOAD_MAX_BYTES"],
  };
  process.env["SANDBOX_AUDIT_LOG"] = logPath;
  process.env["PROJECTS_ROOT"] = projectsRoot;
});

afterEach(async () => {
  __resetSharedAuditLogger();
  for (const k of Object.keys(originals)) {
    if (originals[k] === undefined) delete process.env[k];
    else process.env[k] = originals[k];
  }
  await rm(tmp, { recursive: true, force: true });
});

const callPost = async (id: string, file: File): Promise<Response> => {
  const form = new FormData();
  form.append("file", file);
  return POST(
    new Request(`http://localhost/api/projects/${id}/upload`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ id }) },
  );
};

const readEvents = async (): Promise<unknown[]> => {
  // Drain the shared logger's serial write chain deterministically.
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

describe("upload route — upload_rejected audit", () => {
  it("emits magic-bytes-mismatch with full context", async () => {
    mockIdentity([{ id: "p1", name: "p1" }]);
    const file = new File([PNG_BYTES], "fake.jpg", { type: "image/jpeg" });
    const res = await callPost("p1", file);
    expect(res.status).toBe(400);
    const evts = (await readEvents()) as Array<Record<string, unknown>>;
    const rej = evts.find((e) => e.event === "upload_rejected");
    expect(rej).toMatchObject({
      event: "upload_rejected",
      projectId: "p1",
      filename: "fake.jpg",
      reason: "magic-bytes-mismatch",
      size: PNG_BYTES.length,
    });
  });

  it("emits ext-not-allowed", async () => {
    mockIdentity([{ id: "p2", name: "p2" }]);
    const file = new File([PNG_BYTES], "evil.exe", { type: "application/x-msdownload" });
    const res = await callPost("p2", file);
    expect(res.status).toBe(400);
    const rej = (await readEvents()).find(
      (e) => (e as { reason: string }).reason === "ext-not-allowed",
    );
    expect(rej).toBeDefined();
  });

  it("emits size-exceeded", async () => {
    mockIdentity([{ id: "p3", name: "p3" }]);
    process.env["UPLOAD_MAX_BYTES"] = "10";
    const file = new File([PNG_BYTES], "big.png", { type: "image/png" });
    const res = await callPost("p3", file);
    expect(res.status).toBe(400);
    const rej = (await readEvents()).find(
      (e) => (e as { reason: string }).reason === "size-exceeded",
    );
    expect(rej).toBeDefined();
  });

  it("emits invalid-name for traversal", async () => {
    mockIdentity([{ id: "p4", name: "p4" }]);
    const file = new File([PNG_BYTES], "../escape.png", { type: "image/png" });
    const res = await callPost("p4", file);
    expect(res.status).toBe(400);
    const rej = (await readEvents()).find(
      (e) => (e as { reason: string }).reason === "invalid-name",
    );
    expect(rej).toBeDefined();
  });

  it("does NOT emit on success", async () => {
    mockIdentity([{ id: "p5", name: "p5" }]);
    const file = new File([PNG_BYTES], "icon.png", { type: "image/png" });
    const res = await callPost("p5", file);
    expect(res.status).toBe(200);
    const rejs = (await readEvents()).filter(
      (e) => (e as { event: string }).event === "upload_rejected",
    );
    expect(rejs).toEqual([]);
  });
});
