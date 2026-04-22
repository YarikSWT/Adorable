// Тонкая обёртка над lib/adapters/llm.ts, сохраняющая существующий публичный
// API `streamLlmResponse` для api/chat/route.ts. Прямые импорты
// @ai-sdk/anthropic / @ai-sdk/openai в этом модуле БОЛЬШЕ НЕ ИСПОЛЬЗУЮТСЯ —
// всё идёт через createLLM().

import {
  stepCountIs,
  streamText,
  type UIMessage,
  type ToolSet,
  convertToModelMessages,
} from "ai";

import { createLLM, type LlmProviderName } from "@/lib/adapters/llm";

type StreamLlmResponseParams = {
  system: string;
  messages: UIMessage[];
  tools: ToolSet;
  apiKey?: string;
  providerOverride?: string;
};

type StreamLlmResponseResult = {
  result: ReturnType<typeof streamText>;
  provider: LlmProviderName;
};

export const streamLlmResponse = async ({
  system,
  messages,
  tools,
  apiKey,
  providerOverride,
}: StreamLlmResponseParams): Promise<StreamLlmResponseResult> => {
  const llm = createLLM({ providerOverride, apiKey });
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    system,
    model: llm.main,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(100),
  });

  return {
    result,
    provider: llm.name,
  };
};
