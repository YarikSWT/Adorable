// Тесты для POST /api/projects/[id]/rebuild (CONTRACTS §17).
//
// Используем vi.mock для identity-session — единственная неподдельная
// внешняя зависимость в этом роуте. Preview provider + build queue —
// уже mock'и в vitest env.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identity-session", () => ({
  getOrCreateIdentitySession: vi.fn(),
}));

import { getOrCreateIdentitySession } from "@/lib/identity-session";
import {
  __resetPreviewSingleton,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";
import { POST } from "@/app/api/projects/[id]/rebuild/route";
import type { PreviewProvider } from "@/lib/adapters/preview";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
  (getOrCreateIdentitySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    identity: {
      permissions: {
        git: {
          list: vi.fn(async () => ({ repositories: repos })),
        },
      },
    },
  });
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

  it("returns 403 if caller does not own the repo", async () => {
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
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/manualRebuild not supported/);
    } finally {
      spy.mockRestore();
    }
  });
});
