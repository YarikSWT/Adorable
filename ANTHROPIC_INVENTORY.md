# Anthropic / LLM Integration Points

Карта всех прямых импортов LLM-провайдеров до Phase 1.5.

## Прямые импорты @ai-sdk/anthropic
| Файл:строка | Использование |
|---|---|
| `adorable/package.json:20` | `"@ai-sdk/anthropic": "^2.0.24"` |
| `adorable/lib/llm-provider.ts:1` | `import { createAnthropic } from "@ai-sdk/anthropic"` |
| `adorable/lib/llm-provider.ts:66-71` | `createAnthropic({ apiKey? })` → `.anthropic("claude-sonnet-4-20250514")` |

## Прямые импорты @ai-sdk/openai
| Файл:строка | Использование |
|---|---|
| `adorable/package.json:21` | `"@ai-sdk/openai": "^3.0.19"` |
| `adorable/lib/llm-provider.ts:2-5` | `createOpenAI, OpenAIResponsesProviderOptions` |
| `adorable/lib/llm-provider.ts:45-58` | `createOpenAI({ apiKey? }).responses("gpt-5.2-codex")` + reasoningEffort |

## Место вызова
- `adorable/app/api/chat/route.ts:82-90` — единственный реальный caller. Использует `streamLlmResponse({ system, messages, tools, apiKey, providerOverride })`.

## Что меняем в Phase 1.5

1. **`lib/llm-provider.ts` не удаляем**, а превращаем в тонкую обёртку над `lib/adapters/llm.ts`. Публичный API `streamLlmResponse` остаётся — только внутри вместо прямого `createAnthropic/createOpenAI` идёт `createLLM(provider).main` и `streamText({ model, ... })`.

2. **Новый `lib/adapters/llm.ts`:**
   ```ts
   export type LlmProviderName = "zai" | "openrouter" | "anthropic" | "openai" | "mock";
   export interface LLMProvider {
     name: LlmProviderName;
     main: LanguageModelV2;      // для агентного чата (tool use)
     fast: LanguageModelV2;      // для кратких операций (titles, summaries)
   }
   export const createLLM = (opts?: { providerOverride?: string; apiKey?: string }): LLMProvider;
   ```

3. **Новая зависимость:** `@ai-sdk/openai-compatible` (for zai через кастомный baseURL). По желанию `@openrouter/ai-sdk-provider`.

4. **env:**
   - `LLM_PROVIDER` = `zai` (default) | `openrouter` | `anthropic` | `openai` | `mock`
   - `Z_AI_API_KEY`, `Z_AI_BASE_URL` (default `https://api.z.ai/api/paas/v4`)
   - `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`
   - `LLM_MAIN_MODEL` (default `glm-5.1` для zai, `anthropic/claude-sonnet-4.5` для openrouter)
   - `LLM_FAST_MODEL` (default `glm-4.5-air` для zai)
   - `ANTHROPIC_API_KEY` — fallback

5. **Тесты `adorable/tests/llm-adapter.test.ts`:**
   - `provider=zai` → name === "zai" и baseURL выставлен корректно.
   - `provider=openrouter` → name === "openrouter".
   - `provider=mock` → возвращает pre-defined text.
   - Переключение через env меняет выбранного провайдера.

## Модели

| Name | Provider | Use case |
|---|---|---|
| `glm-5.1` | zai / openrouter (`z-ai/glm-5.1`) | main agentic loop |
| `glm-4.5-air` | zai / openrouter (`z-ai/glm-4.5-air`) | fast ops |
| `claude-sonnet-4-5` | anthropic | fallback main |
| `gpt-5.2-codex` | openai | fallback main (code-focused) |

## Итог Phase 1.5

После миграции в бизнес-коде должно быть ≤ 1 импорт `@ai-sdk/anthropic` (только в `lib/adapters/llm.ts`). Прочий код использует только `lib/adapters/llm.ts` → `createLLM()`.
