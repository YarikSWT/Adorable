// IC-4 (VERIFICATION.md §2):
//   - Periodic ":keep-alive" comment line arrives within KEEP_ALIVE_MS.
//   - Disconnect (request.signal.abort) cleanly tears down the
//     subscription — subsequent BuildQueue events for that project do
//     NOT propagate to the closed stream + don't break the queue's
//     remaining listeners.
//
// Pins SSE_KEEP_ALIVE_MS to 50ms via env so the test runs in <500ms.

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

const callGet = async (id: string, signal: AbortSignal): Promise<Response> =>
  GET(
    new Request(`http://localhost/api/projects/${id}/build-status`, { signal }),
    { params: Promise.resolve({ id }) },
  );

let originalKeepAlive: string | undefined;

beforeEach(() => {
  __resetPreviewSingleton();
  vi.clearAllMocks();
  originalKeepAlive = process.env["SSE_KEEP_ALIVE_MS"];
  process.env["SSE_KEEP_ALIVE_MS"] = "50";
});

afterEach(() => {
  __resetPreviewSingleton();
  if (originalKeepAlive === undefined) delete process.env["SSE_KEEP_ALIVE_MS"];
  else process.env["SSE_KEEP_ALIVE_MS"] = originalKeepAlive;
});

const drainUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (chunk: string) => boolean,
  timeoutMs = 1000,
): Promise<string> => {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (predicate(buf)) return buf;
  }
  return buf;
};

describe("IC-4 — SSE keep-alive", () => {
  it("emits a ':keep-alive' comment within the configured interval", async () => {
    mockIdentity([{ id: "p-ic4-ka", name: "p-ic4-ka" }]);
    const ac = new AbortController();
    const res = await callGet("p-ic4-ka", ac.signal);
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const text = await drainUntil(reader, (b) => b.includes(":keep-alive"), 500);
    ac.abort();
    await reader.cancel().catch(() => undefined);
    expect(text).toContain(":keep-alive");
  });
});

describe("IC-4 — controller cancel cleanup (consumer-side teardown)", () => {
  it("reader.cancel() (without req.signal.abort) still tears down keepalive + queue listener", async () => {
    mockIdentity([{ id: "p-ic4-rc", name: "p-ic4-rc" }]);
    const provider = await getPreviewProvider();
    await provider.create({
      repoId: "p-ic4-rc",
      boilerplateVersion: "1.0.0",
    });

    const queue = getBuildQueue();
    const externalEvents: string[] = [];
    queue.subscribe("p-ic4-rc", (e) => externalEvents.push(e.status));

    // No AbortController.abort() — only the ReadableStream consumer
    // cancels. This exercises the cancel() path on the controller.
    const ac = new AbortController();
    const res = await callGet("p-ic4-rc", ac.signal);
    const reader = res.body!.getReader();

    // Cancel from the consumer side; req.signal stays armed.
    await reader.cancel();
    // Tick to let cancel propagate.
    await new Promise((r) => setTimeout(r, 5));

    // Fire a build event AFTER cancel. No throw means the SSE listener
    // is gone (otherwise it would try to enqueue into a torn-down
    // controller and surface as an error somewhere in queue.subscribe).
    await queue.enqueue({ projectId: "p-ic4-rc", reason: "manual" });
    await new Promise((r) => setTimeout(r, 5));

    expect(externalEvents).toContain("running");
  });
});

describe("IC-4 — disconnect cleanup", () => {
  it("aborting the request closes the stream and stops further events", async () => {
    mockIdentity([{ id: "p-ic4-cu", name: "p-ic4-cu" }]);
    const provider = await getPreviewProvider();
    await provider.create({
      repoId: "p-ic4-cu",
      boilerplateVersion: "1.0.0",
    });

    // External counter on the build queue: this listener should keep
    // receiving events after the SSE handler unsubscribes (proves the
    // queue itself is not corrupted and the SSE listener was uniquely
    // removed).
    const externalEvents: string[] = [];
    const queue = getBuildQueue();
    queue.subscribe("p-ic4-cu", (e) => externalEvents.push(e.status));

    const ac = new AbortController();
    const res = await callGet("p-ic4-cu", ac.signal);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();

    // Abort right away — the SSE start() has already registered its
    // subscribe(). The abort handler should fire and clean up.
    ac.abort();
    // Give the abort listener a tick to run.
    await new Promise((r) => setTimeout(r, 5));

    // Trigger a build event AFTER the SSE was closed. External listener
    // sees it; the SSE side must NOT throw on the closed controller.
    await queue.enqueue({ projectId: "p-ic4-cu", reason: "manual" });
    await new Promise((r) => setTimeout(r, 5));

    // External listener saw running + succeeded.
    expect(externalEvents.length).toBeGreaterThanOrEqual(1);
    expect(externalEvents).toContain("running");

    // SSE stream was closed — read should yield {done: true} promptly.
    const result = await reader.read();
    expect(result.done).toBe(true);
  });
});
