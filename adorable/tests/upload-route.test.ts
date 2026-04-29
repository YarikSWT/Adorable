// Тесты для POST /api/projects/[id]/upload (CONTRACTS §16, ADR-007).

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity-session", () => ({
  getOrCreateIdentitySession: vi.fn(),
}));

import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { POST } from "@/app/api/projects/[id]/upload/route";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
  (
    getOrCreateIdentitySession as unknown as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    identity: {
      permissions: {
        git: {
          list: vi.fn(async () => ({ repositories: repos })),
        },
      },
    },
  });
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
  it("rejects 403 if caller does not own the repo", async () => {
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
