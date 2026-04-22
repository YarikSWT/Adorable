// Mock LLMProvider для тестов и CI.
//
// Использует MockLanguageModelV3 из ai/test, возвращает детерминированный
// текст. В тестах можно переопределить response через опцию.
//
// Примечание: типы LanguageModelV3GenerateResult / StreamPart живут только
// в @ai-sdk/provider v3+, а в workspace из-за @ai-sdk/anthropic@^2 депка
// @ai-sdk/provider резолвится в v2. Чтобы не тянуть конкретный путь к
// provider-v6 и не ломать строгий tsc, используем структурный literal +
// узкий cast в `unknown` — MockLanguageModelV3 валидирует shape в рантайме.

import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

export interface MockLLMOptions {
  mainModelId?: string;
  fastModelId?: string;
  mainResponse?: string;
  fastResponse?: string;
}

const buildGenerateResult = (text: string): unknown => ({
  content: [{ type: "text", text }],
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  warnings: [],
});

type StreamChunk = {
  type: string;
  [k: string]: unknown;
};

const buildStreamResult = (text: string) => ({
  stream: new ReadableStream<StreamChunk>({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "text-start", id: "mock-text" });
      controller.enqueue({
        type: "text-delta",
        id: "mock-text",
        delta: text,
      });
      controller.enqueue({ type: "text-end", id: "mock-text" });
      controller.enqueue({
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      controller.close();
    },
  }),
});

export const createMockLLMProvider = (
  options: MockLLMOptions = {},
): { main: LanguageModel; fast: LanguageModel } => {
  const mainText = options.mainResponse ?? "MOCK_MAIN_RESPONSE";
  const fastText = options.fastResponse ?? "MOCK_FAST_RESPONSE";

  const mkDoGenerate =
    (text: string) =>
    async (): Promise<unknown> =>
      buildGenerateResult(text);
  const mkDoStream =
    (text: string) =>
    async (): Promise<unknown> =>
      buildStreamResult(text);

  const main = new MockLanguageModelV3({
    modelId: options.mainModelId ?? "mock-main",
    provider: "mock",
    // ai/test's MockLanguageModelV3 strict type is tied to provider-v6;
    // cast via `unknown` so we don't need to import that exact path.
    doGenerate: mkDoGenerate(mainText) as never,
    doStream: mkDoStream(mainText) as never,
  });
  const fast = new MockLanguageModelV3({
    modelId: options.fastModelId ?? "mock-fast",
    provider: "mock",
    doGenerate: mkDoGenerate(fastText) as never,
    doStream: mkDoStream(fastText) as never,
  });

  return { main, fast };
};
