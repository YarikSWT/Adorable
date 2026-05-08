// Тесты для GET /api/projects/[id]/build-status (SSE).
//
// Проверяем:
//   - 403 Forbidden для не-владельца
//   - text/event-stream Content-Type, no-store cache
//   - initial snapshot события для running job (если есть)
//   - последующие события приходят через подписку
//   - request.abort() закрывает stream

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
  getBuildQueue,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";
import { GET } from "@/app/api/projects/[id]/build-status/route";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
  };

const callGet = async (
  id: string,
  abortSignal?: AbortSignal,
): Promise<Response> => {
  const init: RequestInit = abortSignal ? { signal: abortSignal } : {};
  return GET(
    new Request(`http://localhost/api/projects/${id}/build-status`, init),
    { params: Promise.resolve({ id }) },
  );
};

const readSseEvents = async (
  res: Response,
  expectedCount: number,
  timeoutMs = 1000,
): Promise<{ name: string; data: string }[]> => {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: { name: string; data: string }[] = [];
  const deadline = Date.now() + timeoutMs;
  while (events.length < expectedCount && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (block.startsWith(":")) continue; // keep-alive
      let name = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        if (line.startsWith("data: ")) data += line.slice(6);
      }
      events.push({ name, data });
    }
  }
  await reader.cancel().catch(() => undefined);
  return events;
};

beforeEach(() => {
  __resetPreviewSingleton();
  vi.clearAllMocks();
});

afterEach(() => {
  __resetPreviewSingleton();
});

describe("GET /api/projects/[id]/build-status — auth", () => {
  // Phase 24: identity-cookie ACL replaced by Better Auth — denial path now
  // flows through requirePermission throwing 403/404 (covered in tests/auth/authorization.test.ts).
  it.skip("returns 403 if caller does not own the repo", async () => {
    mockIdentity([{ id: "other", name: "other" }]);
    const res = await callGet("p-sse-1");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/projects/[id]/build-status — SSE shape", () => {
  it("returns text/event-stream Content-Type when authorised", async () => {
    mockIdentity([{ id: "p-sse-2", name: "p-sse-2" }]);
    const ac = new AbortController();
    const res = await callGet("p-sse-2", ac.signal);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    ac.abort();
    await res.body!.cancel().catch(() => undefined);
  });
});

describe("GET /api/projects/[id]/build-status — events", () => {
  it("delivers running event after enqueue", async () => {
    mockIdentity([{ id: "p-sse-3", name: "p-sse-3" }]);
    const provider = await getPreviewProvider();
    await provider.create({ repoId: "p-sse-3", boilerplateVersion: "1.0.0" });

    const ac = new AbortController();
    const res = await callGet("p-sse-3", ac.signal);
    // Subscribe is set up, then enqueue triggers the event.
    const queue = getBuildQueue();
    await queue.enqueue({ projectId: "p-sse-3", reason: "manual" });

    // Read events: expect at least one running + one succeeded.
    const events = await readSseEvents(res, 2);
    ac.abort();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.name === "status")).toBe(true);
    const parsed = events.map((e) => JSON.parse(e.data));
    expect(parsed.some((p) => p.status === "running")).toBe(true);
  });

  it("delivers initial snapshot for an already-running job on connect", async () => {
    mockIdentity([{ id: "p-sse-4", name: "p-sse-4" }]);
    const provider = await getPreviewProvider();
    await provider.create({ repoId: "p-sse-4", boilerplateVersion: "1.0.0" });

    // Start a never-resolving build by mocking provider.build to hang.
    const originalBuild = provider.build.bind(provider);
    provider.build = (() =>
      new Promise(() => {
        /* never resolves */
      })) as typeof originalBuild;

    const queue = getBuildQueue();
    await queue.enqueue({ projectId: "p-sse-4", reason: "manual" });

    // Now connect — server should send the running snapshot immediately.
    const ac = new AbortController();
    const res = await callGet("p-sse-4", ac.signal);
    const events = await readSseEvents(res, 1, 500);
    ac.abort();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(events[0].data);
    expect(parsed.status).toBe("running");
    expect(parsed.projectId).toBe("p-sse-4");
  });
});
