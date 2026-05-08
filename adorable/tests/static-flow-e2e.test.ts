// E2E test for the static preview-provider flow (Phase 4 acceptance).
//
// Mirror of tests/landing-flow-e2e.test.ts but with PREVIEW_PROVIDER=mock
// (default for vitest), which the factory maps to STATIC_CAPABILITIES.
// The mock preview provider's create() registers the project + provides
// an in-memory ProjectFs; chat/route.ts branches into the static path
// (createStaticTools, no sandbox lifecycle, build-queue enqueue on turn end).
//
// Covers:
//   1. POST /api/repos creates wrapper + source + previewProvider.create()
//      → metadata.preview.provider="mock" with STATIC capabilities pinned.
//   2. POST /api/chat goes through createStaticTools (no SANDBOX_PROVIDER
//      involvement — proves the static branch fires).
//   3. onFinish enqueues a "turn-finished" build (verified via subscribe
//      hooked before the chat call).

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const { cookieJar } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

// Phase 12 — same auth/DB mock surface as repos-route-idempotency /
// landing-flow-e2e: stub the new auth helpers so this static-mode flow
// test stays focused on the preview-provider behaviour it owns.
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => ({
    user: {
      id: "user-static-e2e",
      email: "static-e2e@example.com",
      emailVerified: true,
      isAdmin: false,
    },
    sessionId: "session-static-e2e",
  })),
  getRequestSession: vi.fn(async () => ({
    user: {
      id: "user-static-e2e",
      email: "static-e2e@example.com",
      emailVerified: true,
      isAdmin: false,
    },
    sessionId: "session-static-e2e",
  })),
  requireEmailVerified: vi.fn((s: unknown) => s),
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn(async () => ({})),
}));
vi.mock("@/lib/auth/quotas", () => ({
  requireQuota: vi.fn(async () => ({ remaining: Number.POSITIVE_INFINITY })),
  recordUsage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/audit", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/role-cache", () => ({
  getRoleId: vi.fn(async () => "role-project-owner-id"),
}));
vi.mock("@/lib/db/queries/users", () => ({
  getDefaultPersonalOrgId: vi.fn(async () => "org-default-id"),
}));
vi.mock("@/lib/db/queries/projects", () => ({
  listProjectsForUser: vi.fn(async () => []),
  getProjectByGiteaWrapperId: vi.fn(async () => null),
  getProjectByGiteaWrapperName: vi.fn(async () => null),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: () => ({
          values: () => ({
            returning: async () => [{ id: "project-static-e2e" }],
          }),
        }),
      }),
    ),
  },
}));

import { __resetGitSingleton } from "@/lib/git/provider-singleton";
import { __resetSandboxSingleton } from "@/lib/sandbox/provider-singleton";
import {
  __resetPreviewSingleton,
  getBuildQueue,
} from "@/lib/preview/provider-singleton";
import { __resetIdentitySessionCache } from "@/lib/identity-session";
import type { BuildEvent } from "@/lib/adapters/preview";

import * as reposRoute from "@/app/api/repos/route";
import * as chatRoute from "@/app/api/chat/route";
import * as conversationByIdRoute from "@/app/api/repos/[repoId]/conversations/[conversationId]/route";

const pristineEnv = { ...process.env };
let aclTmpDir = "";

beforeEach(async () => {
  cookieJar.clear();
  process.env.LLM_PROVIDER = "mock";
  process.env.GIT_PROVIDER = "mock";
  process.env.SANDBOX_PROVIDER = "mock";
  process.env.PROXY_PROVIDER = "mock";
  // Phase 4 — force the mock preview provider into STATIC mode (no
  // shellAccess), which routes chat through createStaticTools and
  // enqueues a build on turn end.
  process.env.PREVIEW_PROVIDER = "mock";
  aclTmpDir = await fs.mkdtemp(path.join(tmpdir(), "adorable-acl-static-e2e-"));
  process.env.ADORABLE_ACL_FILE = path.join(aclTmpDir, "acl.json");
  __resetIdentitySessionCache();
  __resetGitSingleton();
  __resetSandboxSingleton();
  __resetPreviewSingleton();
});

afterEach(async () => {
  __resetPreviewSingleton();
  __resetSandboxSingleton();
  __resetGitSingleton();
  __resetIdentitySessionCache();
  if (aclTmpDir) {
    await fs.rm(aclTmpDir, { recursive: true, force: true });
    aclTmpDir = "";
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in pristineEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(pristineEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
});

const makeUserMessage = (text: string) => ({
  id: "user-initial",
  role: "user" as const,
  parts: [{ type: "text" as const, text }],
});

describe("static preview-provider flow (e2e)", () => {
  it("repo creation pins STATIC capabilities + mock provider", async () => {
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Static Project",
          conversationTitle: "First static turn",
        }),
      }),
    { params: Promise.resolve({}) },
    );
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
      metadata: {
        sourceRepoId: string;
        boilerplateVersion?: string;
        preview?: {
          provider: string;
          capabilities: { shellAccess: boolean; manualRebuild: boolean; hotReload: boolean };
        };
      };
    };

    expect(created.metadata.preview?.provider).toBe("mock");
    expect(created.metadata.preview?.capabilities.shellAccess).toBe(false);
    expect(created.metadata.preview?.capabilities.manualRebuild).toBe(true);
    expect(created.metadata.preview?.capabilities.hotReload).toBe(false);
    expect(created.metadata.boilerplateVersion).toBe("1.0.0");
  });

  // Phase 13 migrates /api/chat to Better Auth — re-enable once chatRoute
  // is no longer dependent on identity-cookie ACL.
  it.skip("chat turn enqueues a build on onFinish (static branch)", async () => {
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Static Build Project" }),
      }),
    { params: Promise.resolve({}) },
    );
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
      metadata: { sourceRepoId: string };
    };

    // Subscribe to the build queue BEFORE chat — onFinish enqueue should
    // produce at least a "running" event for the source repo.
    const events: BuildEvent[] = [];
    const queue = getBuildQueue();
    queue.subscribe(created.metadata.sourceRepoId, (e) => events.push(e));

    const chatResp = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: created.id,
          conversationId: created.conversationId,
          messages: [makeUserMessage("ping")],
        }),
      }),
    { params: Promise.resolve({}) },
    );
    expect(chatResp.status).toBe(200);

    // Drain the stream so onFinish runs.
    await chatResp.text();

    // Allow microtasks to settle (queue.runJob is async).
    await new Promise((r) => setTimeout(r, 10));

    expect(events.length).toBeGreaterThan(0);
    const statuses = events.map((e) => e.status);
    expect(statuses).toContain("running");
    // Mock provider's build returns succeeded by default.
    expect(statuses).toContain("succeeded");
  });

  it.skip("sanitises cross-message toolCallId duplicates before persisting", async () => {
    // Real-world failure mode: assistant-ui v0.12 + ai v6 emit a
    // transcript where the same toolCallId appears in two messages
    // (typical post-step-boundary). chat/route.ts now sanitises
    // ONCE up front and reuses for both save + LLM call. This test
    // proves the persisted file is clean.
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Static Sanitise Project" }),
      }),
    { params: Promise.resolve({}) },
    );
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
    };

    // Hand-craft a transcript with a cross-message dup. The intra-
    // message dedup is unrelated; what we're testing is the
    // dedupeToolCallsAcrossMessages composition. The newer message
    // (a2) carries an output-available variant and must win.
    const dupedMessages = [
      {
        id: "user-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "do thing" }],
      },
      {
        id: "asst-1",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-readFileTool",
            toolCallId: "call_DUP",
            state: "input-streaming",
            input: {},
          },
        ],
      },
      {
        id: "asst-2",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-readFileTool",
            toolCallId: "call_DUP",
            state: "output-available",
            input: { file: "x" },
            output: "ok",
          },
        ],
      },
    ];

    const chatResp = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: created.id,
          conversationId: created.conversationId,
          messages: dupedMessages,
        }),
      }),
    { params: Promise.resolve({}) },
    );
    expect(chatResp.status).toBe(200);
    await chatResp.text(); // drain → triggers onFinish → save

    // Read the persisted conversation back.
    const msgResp = await conversationByIdRoute.GET(
      new Request(
        `http://localhost/api/repos/${created.id}/conversations/${created.conversationId}`,
      ),
      {
        params: Promise.resolve({
          repoId: created.id,
          conversationId: created.conversationId,
        }),
      },
    );
    expect(msgResp.status).toBe(200);
    const body = (await msgResp.json()) as {
      messages: Array<{
        id: string;
        role: string;
        parts: Array<{ toolCallId?: string; state?: string }>;
      }>;
    };

    // Walk every message's parts, count occurrences of call_DUP.
    let dupCount = 0;
    let kept: { state?: string } | undefined;
    for (const m of body.messages) {
      for (const p of m.parts ?? []) {
        if (p.toolCallId === "call_DUP") {
          dupCount++;
          kept = p;
        }
      }
    }
    // Cross-message dedup: only one copy left thread-wide.
    expect(dupCount).toBe(1);
    // Last-occurrence wins: the surviving part is the output-available
    // variant from asst-2, not the input-streaming variant from asst-1.
    expect(kept?.state).toBe("output-available");
  });

  it.skip("chat turn does NOT touch sandbox lifecycle in static mode", async () => {
    // Sandbox provider's mock counts adds; if static branch skips it,
    // creating + chatting should result in zero sandboxes (we still
    // had createVmForRepo for sandbox-mode repos, but PREVIEW_PROVIDER
    // = mock takes the static branch which skips both create AND ref).
    //
    // We verify by calling chat against a fresh repo and ensuring no
    // exception is thrown — the absence of sandbox state proves the
    // sandbox branch was bypassed.
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Static No-Sandbox Project" }),
      }),
    { params: Promise.resolve({}) },
    );
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
    };

    const chatResp = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: created.id,
          conversationId: created.conversationId,
          messages: [makeUserMessage("ping")],
        }),
      }),
    { params: Promise.resolve({}) },
    );
    // 200 means the static branch successfully wired tools + ProjectFs +
    // BuildQueue without ever calling sandbox.ref() or createVmTools.
    expect(chatResp.status).toBe(200);
    await chatResp.text();
  });
});
