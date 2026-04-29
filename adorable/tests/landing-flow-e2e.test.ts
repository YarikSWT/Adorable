// E2E тест дефолтного флоу: генерация лендинга с домашней страницы.
//
// Покрывает цепочку, которую запускает UI, когда пользователь заходит на
// "/" и отправляет первый prompt ("сделай лендинг для оптовых цветов"):
//
//   1. POST /api/repos               — создание source-репо, wrapper-репо,
//                                      VM, первой conversation.
//   2. POST /api/chat                 — стрим LLM-ответа, persist messages.
//   3. GET  /api/repos                — в списке юзера появился wrapper.
//   4. GET  /api/repos/:id/conversations
//                                     — conversation присутствует в метаданных.
//   5. GET  /api/repos/:id/conversations/:cid
//                                     — user + assistant сообщения сохранены.
//
// Тест бьётся против mock-провайдеров (git / sandbox / proxy / llm) —
// никакой сетевой активности, Docker, Gitea. Cookie-jar замоканный через
// vi.mock("next/headers") разделяется между вызовами внутри одного теста.

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

// vi.mock поднимается наверх, поэтому cookieJar создаём через vi.hoisted.
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
}));

import { __resetGitSingleton } from "@/lib/git/provider-singleton";
import { __resetSandboxSingleton } from "@/lib/sandbox/provider-singleton";
import {
  ADORABLE_IDENTITY_COOKIE,
  __resetIdentitySessionCache,
} from "@/lib/identity-session";

import * as reposRoute from "@/app/api/repos/route";
import * as chatRoute from "@/app/api/chat/route";
import * as conversationsRoute from "@/app/api/repos/[repoId]/conversations/route";
import * as conversationByIdRoute from "@/app/api/repos/[repoId]/conversations/[conversationId]/route";

type AssistantMessage = {
  role: string;
  parts: Array<{ type: string; text?: string }>;
};

const pristineEnv = { ...process.env };

// ACL (identity → allowed repo ids) теперь персистится в файл (см.
// lib/identity-session.ts). Чтобы тесты не пачкали диск, каждому тесту
// даём свой tmp-путь и чистим в afterEach.
let aclTmpDir = "";

beforeEach(async () => {
  cookieJar.clear();
  process.env.LLM_PROVIDER = "mock";
  process.env.GIT_PROVIDER = "mock";
  process.env.SANDBOX_PROVIDER = "mock";
  process.env.PROXY_PROVIDER = "mock";
  aclTmpDir = await fs.mkdtemp(path.join(tmpdir(), "adorable-acl-e2e-"));
  process.env.ADORABLE_ACL_FILE = path.join(aclTmpDir, "acl.json");
  __resetIdentitySessionCache();
  __resetGitSingleton();
  __resetSandboxSingleton();
});

afterEach(async () => {
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

describe("landing-page generation default flow (e2e)", () => {
  it("creates repo, runs chat, persists conversation, and lists everything back", async () => {
    // 1. "/"-страница отправляет первый prompt — UI вызывает POST /api/repos.
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Wholesale Flowers",
          conversationTitle: "Landing for wholesale flowers",
        }),
      }),
    );
    expect(createResp.status).toBe(200);

    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
      metadata: {
        vm: { vmId: string };
        conversations: Array<{ id: string; title: string }>;
        boilerplateVersion?: string;
        preview?: {
          provider: string;
          capabilities: {
            shellAccess: boolean;
            customDependencies: boolean;
            serverRuntime: boolean;
            hotReload: boolean;
            manualRebuild: boolean;
          };
          createdAt: string;
          migrationStatus?: string;
        };
      };
    };

    expect(created.id).toBeTruthy();
    expect(created.conversationId).toBeTruthy();
    expect(created.metadata.vm.vmId).toMatch(/^mock-sbx-/);
    expect(created.metadata.conversations[0]?.id).toBe(created.conversationId);
    expect(created.metadata.conversations[0]?.title).toBe(
      "Landing for wholesale flowers",
    );

    // Phase 4 — boilerplateVersion + preview block pinned at create time
    // (CONTRACTS §12). In test env the preview provider resolves to the
    // mock (vitest = mock), so capabilities reflect the mock's STATIC_*
    // defaults — but the *shape* is what matters: every subsequent
    // chat/route.ts read uses these pinned values.
    expect(created.metadata.boilerplateVersion).toBe("1.0.0");
    expect(created.metadata.preview).toBeDefined();
    expect(created.metadata.preview?.provider).toBe("mock");
    expect(typeof created.metadata.preview?.capabilities.shellAccess).toBe(
      "boolean",
    );
    expect(typeof created.metadata.preview?.capabilities.manualRebuild).toBe(
      "boolean",
    );
    expect(created.metadata.preview?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.metadata.preview?.migrationStatus).toBe("ok");

    // Identity cookie проставлен серверным кодом.
    expect(cookieJar.get(ADORABLE_IDENTITY_COOKIE)).toBeTruthy();

    // 2. UI отправляет первый chat-turn.
    const userPrompt =
      "Сделай лендинг для оптовой продажи цветочных композиций";
    const chatResp = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: created.id,
          conversationId: created.conversationId,
          messages: [makeUserMessage(userPrompt)],
        }),
      }),
    );
    expect(chatResp.status).toBe(200);

    // Дренируем стрим, чтобы onFinish отработал и persist'нул messages.
    const streamBody = await chatResp.text();
    expect(streamBody).toContain("MOCK_MAIN_RESPONSE");

    // 3. GET /api/repos — репо юзера в списке с правильным display name.
    const listResp = await reposRoute.GET();
    expect(listResp.status).toBe(200);
    const list = (await listResp.json()) as {
      identityId: string;
      repositories: Array<{
        id: string;
        name: string;
        metadata: { sourceRepoId: string } | null;
      }>;
    };
    expect(list.identityId).toBe(cookieJar.get(ADORABLE_IDENTITY_COOKIE));
    const listed = list.repositories.find((repo) => repo.id === created.id);
    expect(listed).toBeDefined();
    expect(listed?.name).toBe("Wholesale Flowers");
    expect(listed?.metadata?.sourceRepoId).toBeTruthy();
    expect(listed?.metadata?.sourceRepoId).not.toBe(created.id);

    // 4. GET /api/repos/:repoId/conversations.
    const convListResp = await conversationsRoute.GET(
      new Request(
        `http://localhost/api/repos/${created.id}/conversations`,
      ),
      { params: Promise.resolve({ repoId: created.id }) },
    );
    expect(convListResp.status).toBe(200);
    const convList = (await convListResp.json()) as {
      conversations: Array<{ id: string; title: string }>;
    };
    expect(convList.conversations).toHaveLength(1);
    expect(convList.conversations[0]?.id).toBe(created.conversationId);

    // 5. GET /api/repos/:repoId/conversations/:conversationId.
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
    const msgJson = (await msgResp.json()) as { messages: AssistantMessage[] };

    const roles = msgJson.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");

    const savedUser = msgJson.messages.find((m) => m.role === "user");
    const userText = savedUser?.parts.find((p) => p.type === "text")?.text;
    expect(userText).toBe(userPrompt);

    const assistantMsg = msgJson.messages.find((m) => m.role === "assistant");
    const assistantText = (assistantMsg?.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
    expect(assistantText).toContain("MOCK_MAIN_RESPONSE");
  });

  it("rejects chat for a repo the identity does not own", async () => {
    // User A создаёт репо.
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Private" }),
      }),
    );
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
    };

    // User B приходит с чистой cookie-сессией — получит новый identityId
    // и пустой ACL.
    cookieJar.clear();

    const chatResp = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: created.id,
          conversationId: created.conversationId,
          messages: [makeUserMessage("i don't own this repo")],
        }),
      }),
    );
    expect(chatResp.status).toBe(403);
  });

  it("rejects chat when repoId/conversationId are missing", async () => {
    const chatResp = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      }),
    );
    expect(chatResp.status).toBe(400);

    const noMessages = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "some-repo",
          conversationId: "some-conv",
        }),
      }),
    );
    expect(noMessages.status).toBe(400);
  });

  it("rejects chat when no LLM API key is configured and no user key is stored", async () => {
    // Переключаемся на провайдер, который требует ключ, чтобы проверить
    // реальный 401-путь при отсутствии Z_AI_API_KEY и user-api-key cookie.
    delete process.env.LLM_PROVIDER;
    delete process.env.Z_AI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    // Нужен реальный репо, к которому identity имеет доступ — иначе мы
    // упадём на 403 раньше 401.
    process.env.LLM_PROVIDER = "mock"; // временно, чтобы POST /api/repos не требовал ключа (он его не требует всё равно, но для симметрии)
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
    };
    delete process.env.LLM_PROVIDER;

    const chatResp = await chatRoute.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: created.id,
          conversationId: created.conversationId,
          messages: [makeUserMessage("hello")],
        }),
      }),
    );
    expect(chatResp.status).toBe(401);
    const payload = (await chatResp.json()) as { error?: string };
    expect(payload.error ?? "").toMatch(/api key/i);
  });

  it("creates a second conversation under the same repo", async () => {
    // 1 — создаём репо + первую conversation.
    const createResp = await reposRoute.POST(
      new Request("http://localhost/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Multi-chat" }),
      }),
    );
    const created = (await createResp.json()) as {
      id: string;
      conversationId: string;
    };

    // 2 — создаём вторую conversation через POST /:repoId/conversations.
    const convCreateResp = await conversationsRoute.POST(
      new Request(
        `http://localhost/api/repos/${created.id}/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "second thread" }),
        },
      ),
      { params: Promise.resolve({ repoId: created.id }) },
    );
    expect(convCreateResp.status).toBe(200);
    const secondConv = (await convCreateResp.json()) as {
      conversationId: string;
    };
    expect(secondConv.conversationId).toBeTruthy();
    expect(secondConv.conversationId).not.toBe(created.conversationId);

    // 3 — GET должен вернуть обе conversation'ы.
    const listResp = await conversationsRoute.GET(
      new Request(
        `http://localhost/api/repos/${created.id}/conversations`,
      ),
      { params: Promise.resolve({ repoId: created.id }) },
    );
    const list = (await listResp.json()) as {
      conversations: Array<{ id: string; title: string }>;
    };
    const ids = list.conversations.map((c) => c.id);
    expect(ids).toContain(created.conversationId);
    expect(ids).toContain(secondConv.conversationId);
  });
});
