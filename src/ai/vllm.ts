/**
 * vLLM AI provider — uses OpenAI-compatible API.
 *
 * ⚠️ IMPORTANT: The vLLM model MUST support tool/function calling.
 * Recommended models: Qwen2.5-72B-Instruct, Llama-3.1-70B-Instruct, Mistral-Large, etc.
 */

import OpenAI from "openai";
import type { AiProvider } from "./provider.js";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse, fixRouterDetection } from "./provider.js";
import type { TaskContext, AiAnalysis } from "../types.js";
import type { Config } from "../config.js";
import { createLogger, withTiming } from "../logger.js";

const log = createLogger("ai:vllm");

export class VllmProvider implements AiProvider {
    private client: OpenAI;
    private model: string;

    constructor(config: Config) {
        if (!config.vllmBaseUrl) throw new Error("VLLM_BASE_URL is required when AI_PROVIDER=vllm");
        if (!config.vllmModel) throw new Error("VLLM_MODEL is required when AI_PROVIDER=vllm");

        this.client = new OpenAI({
            baseURL: config.vllmBaseUrl,
            apiKey: "not-needed", // vLLM doesn't require an API key
        });
        this.model = config.vllmModel;
        log.info(`vLLM provider initialized (model: ${this.model}, base: ${config.vllmBaseUrl})`);
    }

    async analyze(context: TaskContext): Promise<AiAnalysis> {
        log.info(`Analyzing issue ${context.issue.key}...`);

        const { result, duration_ms } = await withTiming(async () => {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: "system", content: buildSystemPrompt({ primaryLanguage: context.runtime, isMulti: context.hasMultipleLanguages }) },
                    { role: "user", content: buildUserPrompt(context) },
                ],
                temperature: 0.1,
            });

            return response.choices[0]?.message?.content ?? "";
        });

        log.timed("info", `AI analysis complete for ${context.issue.key}`, duration_ms);
        const analysis = parseAiResponse(result);
        
        // Post-process: Fix router detection issues in test files
        return fixRouterDetection(analysis, context);
    }
}
