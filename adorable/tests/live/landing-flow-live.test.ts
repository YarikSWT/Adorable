// Live e2e для дефолтного флоу генерации лендинга.
//
// Гейтнут на RUN_LIVE_TESTS=1 (следуя конвенции git-gitea-integration.test.ts
// и proxy-caddy-integration.test.ts). В обычных прогонах suite пропускается
// через `describe.skip`, поэтому `npm test` остаётся быстрым и
// детерминированным.
//
// Предварительные условия (когда включен):
//   1. Dev-сервер Adorable поднят и слушает ADORABLE_LIVE_BASE_URL
//      (default http://localhost:3000). Запуск: `npm run dev` из adorable/.
//   2. `npm run dev:infra:up` подняло Gitea + Caddy + Docker network.
//   3. В env валидный ключ живого LLM-провайдера (Z_AI_API_KEY по умолчанию,
//      либо OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY +
//      соответствующий LLM_PROVIDER).
//   4. `LLM_PROVIDER` не равен "mock".
//
// Запуск:
//   RUN_LIVE_TESTS=1 npx vitest run tests/live/landing-flow-live.test.ts
//
// Что проверяется:
//   • полный HTTP-цикл POST /api/repos → POST /api/chat → GET conversations;
//   • агент реально дёрнул хотя бы один tool-call (writeFileTool /
//     commitTool / …) — это минимальный детерминированный сигнал того, что
//     генерация лендинга произошла, а не только пустой текстовый ответ.
//   • Дополнительно логирует число deployments (если агент закоммитил —
//     metadata.deployments пополнится).
//
// Формат assistant-message parts в AI SDK v6 зависит от toolName: tool-части
// идут с `type` вида `tool-writeFileTool` или `dynamic-tool-call`. Именно
// поэтому мы фильтруем по префиксу "tool-" вместо строгого равенства.

import { describe, it, expect, beforeAll } from "vitest";

const enabled = process.env.RUN_LIVE_TESTS === "1";
const d = enabled ? describe : describe.skip;

const BASE_URL = (
  process.env.ADORABLE_LIVE_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

// LLM-стрим может идти минутами: несколько tool-calls, мысли модели,
// npm install + запуск dev-сервера в sandbox. 20 мин с запасом — Vite
// обычно справляется за 2-5, но хвостатые runs всё равно возможны.
const STREAM_TIMEOUT_MS = Number(
  process.env.ADORABLE_LIVE_TIMEOUT_MS ?? 1_200_000,
);

type CookieJar = Map<string, string>;

const absorbCookies = (response: Response, jar: CookieJar): void => {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];
  for (const cookie of cookies) {
    const [kv] = cookie.split(";");
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const name = kv.slice(0, eq).trim();
    const value = kv.slice(eq + 1).trim();
    jar.set(name, value);
  }
};

const cookieHeader = (jar: CookieJar): string =>
  Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

type AssistantPart = {
  type: string;
  toolName?: string;
  text?: string;
};

type ConversationMessage = {
  role: string;
  parts: AssistantPart[];
};

d("landing generation (live e2e)", () => {
  const jar: CookieJar = new Map();

  beforeAll(async () => {
    let probe: Response;
    try {
      probe = await fetch(`${BASE_URL}/api/repos`, {
        headers: { Cookie: cookieHeader(jar) },
      });
    } catch (err) {
      throw new Error(
        `Adorable dev-сервер недоступен по ${BASE_URL}. ` +
          `Подними 'npm run dev' в adorable/ и 'npm run dev:infra:up'. ` +
          `Исходная ошибка: ${(err as Error).message}`,
      );
    }
    if (probe.status !== 200) {
      throw new Error(
        `GET ${BASE_URL}/api/repos вернул HTTP ${probe.status}. ` +
          `Проверь, что сервер поднят в dev-режиме и cookies/сессии работают.`,
      );
    }
    absorbCookies(probe, jar);
  });

  it(
    "агент создаёт лендинг и оставляет следы tool-call'ов в conversation",
    async () => {
      // 1. Создаём репо + первую conversation через реальный API.
      const createResp = await fetch(`${BASE_URL}/api/repos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader(jar),
        },
        body: JSON.stringify({
          name: `live-smoke-${Date.now().toString(36)}`,
          conversationTitle: "Live smoke: wholesale flowers landing",
        }),
      });
      absorbCookies(createResp, jar);
      expect(createResp.status).toBe(200);
      const created = (await createResp.json()) as {
        id: string;
        conversationId: string;
      };
      expect(created.id).toBeTruthy();
      expect(created.conversationId).toBeTruthy();

      // 2. Отправляем короткий prompt на живую LLM через /api/chat.
      // Специально держим scope узким: один файл, одна правка — чтобы
      // live-run укладывался в бюджет, а не превращался в многоходовую
      // сессию. Для проверки "агент вообще что-то делает" этого хватает.
      const userPrompt =
        "Открой src/pages/Home.jsx, замени заголовок на " +
        "'Оптовые цветочные композиции'. Больше ничего не трогай, " +
        "коммитить не нужно.";

      const chatResp = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader(jar),
        },
        body: JSON.stringify({
          repoId: created.id,
          conversationId: created.conversationId,
          messages: [
            {
              id: `user-${Date.now().toString(36)}`,
              role: "user",
              parts: [{ type: "text", text: userPrompt }],
            },
          ],
        }),
      });
      absorbCookies(chatResp, jar);
      expect(chatResp.status).toBe(200);

      // Дренируем SSE-стрим целиком: onFinish в chat/route.ts запишет
      // финальные messages в conversation-файл репо.
      const streamBody = await chatResp.text();
      expect(streamBody.length).toBeGreaterThan(0);

      // 3. Читаем persisted messages и проверяем следы работы агента.
      // ВАЖНО: repoId у Gitea — "owner/repo" со slash'ем. Без
      // encodeURIComponent Next.js dynamic route [repoId] не матчится
      // и отдаёт 404.
      const encRepo = encodeURIComponent(created.id);
      const encConv = encodeURIComponent(created.conversationId);
      const msgResp = await fetch(
        `${BASE_URL}/api/repos/${encRepo}/conversations/${encConv}`,
        { headers: { Cookie: cookieHeader(jar) } },
      );
      expect(msgResp.status).toBe(200);
      const { messages } = (await msgResp.json()) as {
        messages: ConversationMessage[];
      };

      const assistantMessages = messages.filter((m) => m.role === "assistant");
      expect(
        assistantMessages.length,
        "assistant должен оставить хотя бы одно сообщение",
      ).toBeGreaterThan(0);

      const toolCallParts = assistantMessages.flatMap((m) =>
        m.parts.filter(
          (p) =>
            p.type === "tool-call" ||
            p.type === "dynamic-tool-call" ||
            p.type.startsWith("tool-"),
        ),
      );
      const allPartTypes = assistantMessages.flatMap((m) =>
        m.parts.map((p) => p.type),
      );
      expect(
        toolCallParts.length,
        `агент должен был вызвать хотя бы один инструмент; ` +
          `типы parts: ${JSON.stringify(allPartTypes)}`,
      ).toBeGreaterThan(0);

      // 4. Информационный сигнал: если агент закоммитил, metadata.deployments
      // пополнится. Не делаем это assertion'ом, т.к. commit — решение модели.
      const metaResp = await fetch(`${BASE_URL}/api/repos`, {
        headers: { Cookie: cookieHeader(jar) },
      });
      if (metaResp.status === 200) {
        const { repositories } = (await metaResp.json()) as {
          repositories: Array<{
            id: string;
            metadata: { deployments: unknown[] } | null;
          }>;
        };
        const mine = repositories.find((r) => r.id === created.id);
        const deployCount = mine?.metadata?.deployments.length ?? 0;
        // eslint-disable-next-line no-console
        console.log(
          `[live] assistant parts: ${JSON.stringify(allPartTypes)} | ` +
            `deployments: ${deployCount}`,
        );
      }
    },
    STREAM_TIMEOUT_MS,
  );
});
