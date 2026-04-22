// LLMProvider — адаптер над Vercel AI SDK провайдерами.
//
// Цель: вся бизнес-логика Adorable импортирует ТОЛЬКО этот модуль, не
// @ai-sdk/anthropic / @ai-sdk/openai / @openrouter/ai-sdk-provider напрямую.
// Переключение провайдера — через env LLM_PROVIDER.
//
// Дефолтный провайдер — zai (GLM от Z.ai), потому что целевой рынок — Россия.
// Z.ai expose'ит OpenAI-совместимый endpoint на `/api/paas/v4/chat/completions`.
//
// Провайдеры:
//   - zai:        createOpenAICompatible(baseURL=Z_AI_BASE_URL, apiKey=Z_AI_API_KEY)
//   - openrouter: createOpenRouter(apiKey=OPENROUTER_API_KEY)
//   - anthropic:  createAnthropic(apiKey=ANTHROPIC_API_KEY)  — fallback
//   - openai:     createOpenAI(apiKey=OPENAI_API_KEY)        — fallback
//   - mock:       создаёт detereministic тестовый модель (тесты, CI)

import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createMockLLMProvider } from "./llm-mock";

export type LlmProviderName =
  | "zai"
  | "openrouter"
  | "anthropic"
  | "openai"
  | "mock";

export interface LLMProvider {
  name: LlmProviderName;
  main: LanguageModel;
  fast: LanguageModel;
  mainModelId: string;
  fastModelId: string;
}

export interface CreateLLMOptions {
  providerOverride?: string;
  apiKey?: string;
}

const DEFAULT_MODELS: Record<LlmProviderName, { main: string; fast: string }> =
  {
    zai: { main: "glm-5.1", fast: "glm-4.5-air" },
    openrouter: { main: "z-ai/glm-5.1", fast: "z-ai/glm-4.5-air" },
    anthropic: {
      main: "claude-sonnet-4-20250514",
      fast: "claude-haiku-4-5-20251001",
    },
    openai: { main: "gpt-5.2-codex", fast: "gpt-5-mini" },
    mock: { main: "mock-main", fast: "mock-fast" },
  };

const normalizeProviderName = (raw?: string | null): LlmProviderName => {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "zai" || v === "glm" || v === "z.ai" || v === "z-ai") return "zai";
  if (v === "openrouter" || v === "or") return "openrouter";
  if (v === "anthropic" || v === "claude") return "anthropic";
  if (v === "openai" || v === "gpt") return "openai";
  if (v === "mock" || v === "test" || v === "fake") return "mock";
  return "zai";
};

export const resolveProviderName = (
  override?: string,
): LlmProviderName => {
  if (override !== undefined) return normalizeProviderName(override);
  return normalizeProviderName(process.env["LLM_PROVIDER"]);
};

const getEnv = (key: string, fallback?: string): string | undefined => {
  const v = process.env[key];
  if (typeof v === "string" && v.length > 0) return v;
  return fallback;
};

const requireEnv = (key: string, providerName: string): string => {
  const v = getEnv(key);
  if (!v) {
    throw new Error(
      `LLM provider "${providerName}" requires env ${key}, which is missing. ` +
        `Set it in .env or switch LLM_PROVIDER.`,
    );
  }
  return v;
};

const resolveModelId = (
  envVar: string,
  provider: LlmProviderName,
  which: "main" | "fast",
): string => {
  return getEnv(envVar, DEFAULT_MODELS[provider][which])!;
};

export const createLLM = (options: CreateLLMOptions = {}): LLMProvider => {
  const name = resolveProviderName(options.providerOverride);
  const mainModelId = resolveModelId("LLM_MAIN_MODEL", name, "main");
  const fastModelId = resolveModelId("LLM_FAST_MODEL", name, "fast");

  switch (name) {
    case "zai": {
      const apiKey = options.apiKey ?? requireEnv("Z_AI_API_KEY", "zai");
      const baseURL = getEnv(
        "Z_AI_BASE_URL",
        "https://api.z.ai/api/paas/v4",
      )!;
      const zai = createOpenAICompatible({
        name: "zai",
        apiKey,
        baseURL,
      });
      return {
        name,
        mainModelId,
        fastModelId,
        main: zai.chatModel(mainModelId),
        fast: zai.chatModel(fastModelId),
      };
    }

    case "openrouter": {
      const apiKey =
        options.apiKey ?? requireEnv("OPENROUTER_API_KEY", "openrouter");
      const baseURL = getEnv("OPENROUTER_BASE_URL");
      const or = createOpenRouter({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return {
        name,
        mainModelId,
        fastModelId,
        main: or.chat(mainModelId),
        fast: or.chat(fastModelId),
      };
    }

    case "anthropic": {
      const apiKey =
        options.apiKey ?? getEnv("ANTHROPIC_API_KEY");
      const anth = apiKey ? createAnthropic({ apiKey }) : createAnthropic({});
      return {
        name,
        mainModelId,
        fastModelId,
        main: anth(mainModelId),
        fast: anth(fastModelId),
      };
    }

    case "openai": {
      const apiKey = options.apiKey ?? getEnv("OPENAI_API_KEY");
      const oai = apiKey ? createOpenAI({ apiKey }) : createOpenAI({});
      return {
        name,
        mainModelId,
        fastModelId,
        main: oai.responses(mainModelId),
        fast: oai(fastModelId),
      };
    }

    case "mock": {
      const mock = createMockLLMProvider({ mainModelId, fastModelId });
      return {
        name,
        mainModelId,
        fastModelId,
        main: mock.main,
        fast: mock.fast,
      };
    }

    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown LLM provider: ${_exhaustive as string}`);
    }
  }
};

// Удобный аксессор — возвращает главный (agentic) LLM для чата, использует env LLM_PROVIDER.
// Вызывается из api/chat/route.ts.
export const getDefaultLLM = (options: CreateLLMOptions = {}): LLMProvider => {
  return createLLM(options);
};
