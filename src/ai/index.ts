/**
 * AI provider factory — creates the correct provider based on config.
 */

import type { Config } from "../config.js";
import type { AiProvider } from "./provider.js";
import { OpenAiProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { VllmProvider } from "./vllm.js";

export function createAiProvider(config: Config): AiProvider {
    switch (config.aiProvider) {
        case "openai":
            return new OpenAiProvider(config);
        case "anthropic":
            return new AnthropicProvider(config);
        case "gemini":
            return new GeminiProvider(config);
        case "vllm":
            return new VllmProvider(config);
        default:
            throw new Error(`Unsupported AI Provider: ${String(config.aiProvider)}`);
    }
}

export type { AiProvider } from "./provider.js";
