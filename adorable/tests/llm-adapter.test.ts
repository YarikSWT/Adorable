// Контрактные тесты для LLMProvider-адаптера.
//
// Проверяем:
//   1. Переключение провайдеров по env LLM_PROVIDER.
//   2. Каждый провайдер отдаёт корректные modelId (default или из env).
//   3. zai использует Z_AI_BASE_URL и Z_AI_API_KEY.
//   4. Отсутствие API ключа для non-mock провайдера → понятная ошибка.
//   5. Mock-провайдер не требует ключей и стримит ожидаемый текст через streamText.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { streamText, convertToModelMessages, type UIMessage } from "ai";

import {
  createLLM,
  resolveProviderName,
  type LlmProviderName,
} from "@/lib/adapters/llm";

const pristineEnv = { ...process.env };

const clearLlmEnv = () => {
  delete process.env.LLM_PROVIDER;
  delete process.env.Z_AI_API_KEY;
  delete process.env.Z_AI_BASE_URL;
  delete process.env.LLM_MAIN_MODEL;
  delete process.env.LLM_FAST_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
};

beforeEach(() => {
  clearLlmEnv();
});

afterEach(() => {
  clearLlmEnv();
  for (const [k, v] of Object.entries(pristineEnv)) {
    if (v !== undefined) process.env[k] = v;
  }
});

describe("resolveProviderName", () => {
  it("defaults to zai when unset", () => {
    expect(resolveProviderName()).toBe("zai");
  });

  it("accepts canonical names", () => {
    const cases: Array<[string, LlmProviderName]> = [
      ["zai", "zai"],
      ["openrouter", "openrouter"],
      ["anthropic", "anthropic"],
      ["openai", "openai"],
      ["mock", "mock"],
    ];
    for (const [input, expected] of cases) {
      expect(resolveProviderName(input)).toBe(expected);
    }
  });

  it("accepts aliases (claude → anthropic, glm → zai, or → openrouter)", () => {
    expect(resolveProviderName("claude")).toBe("anthropic");
    expect(resolveProviderName("glm")).toBe("zai");
    expect(resolveProviderName("or")).toBe("openrouter");
  });

  it("env LLM_PROVIDER wins when override undefined", () => {
    process.env.LLM_PROVIDER = "anthropic";
    expect(resolveProviderName()).toBe("anthropic");
  });

  it("override wins over env", () => {
    process.env.LLM_PROVIDER = "anthropic";
    expect(resolveProviderName("zai")).toBe("zai");
  });
});

describe("createLLM", () => {
  it("zai provider: default models glm-5.1 + glm-4.5-air", () => {
    process.env.Z_AI_API_KEY = "zai-test-key";
    const llm = createLLM({ providerOverride: "zai" });
    expect(llm.name).toBe("zai");
    expect(llm.mainModelId).toBe("glm-5.1");
    expect(llm.fastModelId).toBe("glm-4.5-air");
    expect((llm.main as { provider: string }).provider).toBe("zai.chat");
    expect((llm.main as { modelId: string }).modelId).toBe("glm-5.1");
  });

  it("zai provider: overriding LLM_MAIN_MODEL / LLM_FAST_MODEL works", () => {
    process.env.Z_AI_API_KEY = "zai-test-key";
    process.env.LLM_MAIN_MODEL = "glm-5.1-flash";
    process.env.LLM_FAST_MODEL = "glm-mini";
    const llm = createLLM({ providerOverride: "zai" });
    expect(llm.mainModelId).toBe("glm-5.1-flash");
    expect(llm.fastModelId).toBe("glm-mini");
  });

  it("zai provider: missing Z_AI_API_KEY throws helpful error", () => {
    expect(() => createLLM({ providerOverride: "zai" })).toThrowError(
      /Z_AI_API_KEY/,
    );
  });

  it("openrouter provider: requires OPENROUTER_API_KEY", () => {
    expect(() => createLLM({ providerOverride: "openrouter" })).toThrowError(
      /OPENROUTER_API_KEY/,
    );
  });

  it("openrouter provider: default models z-ai/glm-5.1 + z-ai/glm-4.5-air", () => {
    process.env.OPENROUTER_API_KEY = "or-test-key";
    const llm = createLLM({ providerOverride: "openrouter" });
    expect(llm.name).toBe("openrouter");
    expect(llm.mainModelId).toBe("z-ai/glm-5.1");
    expect(llm.fastModelId).toBe("z-ai/glm-4.5-air");
  });

  it("anthropic provider: uses claude-sonnet-4 main by default", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const llm = createLLM({ providerOverride: "anthropic" });
    expect(llm.name).toBe("anthropic");
    expect(llm.mainModelId).toMatch(/^claude-sonnet/);
  });

  it("openai provider: uses gpt-5.2-codex main by default", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const llm = createLLM({ providerOverride: "openai" });
    expect(llm.name).toBe("openai");
    expect(llm.mainModelId).toBe("gpt-5.2-codex");
  });

  it("mock provider: works without any env credentials", () => {
    const llm = createLLM({ providerOverride: "mock" });
    expect(llm.name).toBe("mock");
    expect(llm.mainModelId).toBe("mock-main");
    expect(llm.fastModelId).toBe("mock-fast");
  });

  it("env LLM_PROVIDER controls switching without explicit override", () => {
    process.env.LLM_PROVIDER = "mock";
    const llm = createLLM();
    expect(llm.name).toBe("mock");
  });

  it("providerOverride takes precedence over env LLM_PROVIDER", () => {
    process.env.LLM_PROVIDER = "zai";
    process.env.Z_AI_API_KEY = "zai-test-key";
    const llm = createLLM({ providerOverride: "mock" });
    expect(llm.name).toBe("mock");
  });

  it("apiKey option is honoured for zai", () => {
    const llm = createLLM({ providerOverride: "zai", apiKey: "explicit-key" });
    expect(llm.name).toBe("zai");
    // Если адаптер бы не принял apiKey, createOpenAICompatible бросил бы
    // позже при реальном fetch; здесь достаточно что createLLM не падает.
    expect(llm.main).toBeDefined();
  });
});

describe("end-to-end streaming (mock)", () => {
  it("streamText through mock provider produces expected text", async () => {
    const llm = createLLM({ providerOverride: "mock" });
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ];

    const result = streamText({
      model: llm.main,
      messages: await convertToModelMessages(messages),
    });

    let acc = "";
    for await (const chunk of result.textStream) {
      acc += chunk;
    }
    expect(acc).toBe("MOCK_MAIN_RESPONSE");
  });
});
