// POST /api/repos idempotency: when the client sends the same
// `clientRequestId` twice (React StrictMode double-mount, double-click,
// network retry), only one wrapper repo gets created and both responses
// are identical.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity-session", () => ({
  getOrCreateIdentitySession: vi.fn(),
  migrateRepoIdInAcl: vi.fn(),
}));

vi.mock("@/lib/git/provider-singleton", () => ({
  getGitProvider: vi.fn(),
}));

vi.mock("@/lib/adorable-vm", () => ({
  createVmForRepo: vi.fn(),
}));

vi.mock("@/lib/template-seeder", () => ({
  seedTemplateRepo: vi.fn(async () => undefined),
}));

vi.mock("@/lib/preview/boilerplate-version", () => ({
  readBoilerplateVersion: vi.fn(async () => "1.0.0"),
}));

vi.mock("@/lib/preview/provider-singleton", () => ({
  getPreviewProvider: vi.fn(),
}));

vi.mock("@/lib/repo-storage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/repo-storage")>(
      "@/lib/repo-storage",
    );
  return {
    ...actual,
    writeRepoMetadata: vi.fn(async () => undefined),
    createConversationInRepo: vi.fn(async (_repoId, metadata) => metadata),
    readRepoMetadata: vi.fn(async () => null),
  };
});

import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { getGitProvider } from "@/lib/git/provider-singleton";
import { getPreviewProvider } from "@/lib/preview/provider-singleton";
import {
  POST,
  __resetCreateRepoIdempotencyForTests,
} from "@/app/api/repos/route";

type MockedFn = ReturnType<typeof vi.fn>;

const mockIdentity = () => {
  (getOrCreateIdentitySession as unknown as MockedFn).mockResolvedValue({
    identity: {
      permissions: {
        git: {
          list: vi.fn(async () => ({ repositories: [] })),
          grant: vi.fn(async () => undefined),
        },
      },
    },
  });
};

const mockGitProvider = (createCounter: { count: number }) => {
  (getGitProvider as unknown as MockedFn).mockResolvedValue({
    createRepo: vi.fn(async ({ name }: { name: string }) => {
      createCounter.count += 1;
      return {
        repoId: name,
        repo: {
          githubSync: { enable: vi.fn(async () => undefined) },
        },
      };
    }),
  });
};

const mockStaticPreviewProvider = (createCounter: { count: number }) => {
  (getPreviewProvider as unknown as MockedFn).mockResolvedValue({
    name: "static",
    capabilities: {
      kind: "static",
      previewMode: "static",
      supportsLiveReload: false,
    },
    create: vi.fn(async ({ repoId }: { repoId: string }) => {
      createCounter.count += 1;
      return {
        projectId: `proj-${repoId}`,
        previewUrl: `http://${repoId}.preview.localhost`,
        terminalUrls: { devCommand: "", additional: "" },
      };
    }),
  });
};

const callPost = (body: Record<string, unknown>): Promise<Response> =>
  POST(
    new Request("http://localhost/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  __resetCreateRepoIdempotencyForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  __resetCreateRepoIdempotencyForTests();
});

describe("POST /api/repos idempotency", () => {
  it("creates one wrapper repo when same clientRequestId arrives twice sequentially", async () => {
    mockIdentity();
    const repoCreateCounter = { count: 0 };
    const previewCreateCounter = { count: 0 };
    mockGitProvider(repoCreateCounter);
    mockStaticPreviewProvider(previewCreateCounter);

    const crid = "test-crid-sequential";
    const res1 = await callPost({ clientRequestId: crid, name: "Doppio" });
    const res2 = await callPost({ clientRequestId: crid, name: "Doppio" });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.id).toBe(body2.id);
    expect(body1.conversationId).toBe(body2.conversationId);

    // Each createRepo call (gitProvider) creates source + wrapper = 2 calls
    // per real execution. Idempotency must collapse to one execution.
    expect(repoCreateCounter.count).toBe(2);
    expect(previewCreateCounter.count).toBe(1);
  });

  it("creates one wrapper repo when same clientRequestId arrives concurrently", async () => {
    mockIdentity();
    const repoCreateCounter = { count: 0 };
    const previewCreateCounter = { count: 0 };
    mockGitProvider(repoCreateCounter);
    mockStaticPreviewProvider(previewCreateCounter);

    const crid = "test-crid-concurrent";
    const [res1, res2] = await Promise.all([
      callPost({ clientRequestId: crid, name: "Doppio" }),
      callPost({ clientRequestId: crid, name: "Doppio" }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.id).toBe(body2.id);
    expect(body1.conversationId).toBe(body2.conversationId);
    expect(repoCreateCounter.count).toBe(2);
    expect(previewCreateCounter.count).toBe(1);
  });

  it("creates two wrapper repos for different clientRequestIds", async () => {
    mockIdentity();
    const repoCreateCounter = { count: 0 };
    const previewCreateCounter = { count: 0 };
    mockGitProvider(repoCreateCounter);
    mockStaticPreviewProvider(previewCreateCounter);

    const res1 = await callPost({ clientRequestId: "crid-A", name: "A" });
    const res2 = await callPost({ clientRequestId: "crid-B", name: "B" });

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.id).not.toBe(body2.id);
    expect(repoCreateCounter.count).toBe(4);
    expect(previewCreateCounter.count).toBe(2);
  });

  it("creates a fresh wrapper when clientRequestId is omitted (opt-out)", async () => {
    mockIdentity();
    const repoCreateCounter = { count: 0 };
    const previewCreateCounter = { count: 0 };
    mockGitProvider(repoCreateCounter);
    mockStaticPreviewProvider(previewCreateCounter);

    const res1 = await callPost({ name: "A" });
    const res2 = await callPost({ name: "A" });

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.id).not.toBe(body2.id);
    expect(repoCreateCounter.count).toBe(4);
  });
});
