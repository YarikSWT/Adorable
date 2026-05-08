// E2E test for VERIFICATION scenario 5 "Manual rebuild" — rapid
// double-click of Rebuild causes cancel + replace in the queue and the
// SSE stream observes both jobs' transitions.
//
// Drives the full route stack:
//   POST /api/projects/[id]/rebuild  → buildQueue.enqueue
//   GET  /api/projects/[id]/build-status (SSE) → subscribes to events
//
// Mocks identity-session and uses a slow mock executor so the first
// build is still running when the second enqueue arrives.

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



import { __resetPreviewSingleton, getBuildQueue, getPreviewProvider } from "@/lib/preview/provider-singleton";
import { POST as rebuildPOST } from "@/app/api/projects/[id]/rebuild/route";
import { GET as sseGET } from "@/app/api/projects/[id]/build-status/route";

const mockIdentity = (repos: Array<{ id: string; name: string }>): void => {
  };

const callRebuild = async (id: string): Promise<Response> =>
  rebuildPOST(
    new Request(`http://localhost/api/projects/${id}/rebuild`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );

const openSse = async (id: string, signal: AbortSignal): Promise<Response> =>
  sseGET(
    new Request(`http://localhost/api/projects/${id}/build-status`, { signal }),
    { params: Promise.resolve({ id }) },
  );

const drainEvents = async (
  res: Response,
  expectedCount: number,
  timeoutMs = 1000,
): Promise<Array<{ name: string; data: unknown }>> => {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Array<{ name: string; data: unknown }> = [];
  const deadline = Date.now() + timeoutMs;
  while (events.length < expectedCount && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (block.startsWith(":")) continue;
      let name = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        if (line.startsWith("data: ")) data += line.slice(6);
      }
      try {
        events.push({ name, data: JSON.parse(data) });
      } catch {
        events.push({ name, data });
      }
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

describe("Manual rebuild — rapid double-click cancel+replace (e2e)", () => {
  it("second rebuild cancels the first; SSE observes both transitions", async () => {
    mockIdentity([{ id: "p-rb-cr", name: "p-rb-cr" }]);

    // Make build slow: provider.build awaits an externally-resolvable
    // promise. We capture the resolver so we can trigger completion
    // when we want.
    const provider = await getPreviewProvider();
    await provider.create({
      repoId: "p-rb-cr",
      boilerplateVersion: "1.0.0",
    });
    let resolveSlow: (() => void) | null = null;
    const originalBuild = provider.build.bind(provider);
    provider.build = (async (opts: Parameters<typeof originalBuild>[0]) => {
      // First call: hangs. Second call: returns immediately succeeded.
      if (!resolveSlow) {
        return new Promise((resolve) => {
          resolveSlow = () =>
            resolve({
              status: opts.signal?.aborted ? "cancelled" : "succeeded",
              exitCode: opts.signal?.aborted ? 143 : 0,
              durationMs: 0,
              wasSwapped: !opts.signal?.aborted,
              errors: [],
              warnings: [],
              stdout: "",
              stderr: "",
            });
          // Auto-resolve when signal aborts so the queue doesn't hang
          // forever on the first job.
          opts.signal?.addEventListener("abort", () => resolveSlow?.(), {
            once: true,
          });
        });
      }
      return originalBuild(opts);
    }) as typeof provider.build;

    // Open SSE.
    const ac = new AbortController();
    const sse = await openSse("p-rb-cr", ac.signal);
    expect(sse.status).toBe(200);

    // First click.
    const a = await callRebuild("p-rb-cr");
    expect(a.status).toBe(200);
    const aBody = (await a.json()) as { jobId: string; status: string };
    expect(aBody.status).toBe("running");

    // Second click — cancels first, queues second.
    const b = await callRebuild("p-rb-cr");
    expect(b.status).toBe(200);
    const bBody = (await b.json()) as { jobId: string; status: string };
    expect(bBody.status).toBe("queued");
    expect(bBody.jobId).not.toBe(aBody.jobId);

    // Drain SSE — expect at minimum:
    //   running(a), queued(b), cancelled(a), running(b), succeeded(b)
    const events = await drainEvents(sse, 5, 1000);
    ac.abort();

    const statuses = events.map(
      (e) => (e.data as { status: string; jobId: string }),
    );
    const aStatuses = statuses.filter((s) => s.jobId === aBody.jobId).map((s) => s.status);
    const bStatuses = statuses.filter((s) => s.jobId === bBody.jobId).map((s) => s.status);
    expect(aStatuses).toContain("running");
    expect(aStatuses).toContain("cancelled");
    expect(bStatuses).toContain("queued");
    expect(bStatuses).toContain("running");
    expect(bStatuses).toContain("succeeded");
  });
});
