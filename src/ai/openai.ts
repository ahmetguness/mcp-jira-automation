/**
 * OpenAI AI provider.
 */

import OpenAI from "openai";
import type { AiProvider } from "./provider.js";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse, fixRouterDetection } from "./provider.js";
import type { TaskContext, AiAnalysis } from "../types.js";
import type { Config } from "../config.js";
import { createLogger, withTiming } from "../logger.js";

const log = createLogger("ai:openai");

export class OpenAiProvider implements AiProvider {
    private client: OpenAI;
    private model: string;

    constructor(config: Config) {
        if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");
        this.client = new OpenAI({ apiKey: config.openaiApiKey });
        this.model = config.aiModel ?? "gpt-4o";
        log.info(`OpenAI provider initialized (model: ${this.model})`);
    }

    async analyze(context: TaskContext): Promise<AiAnalysis> {
        log.info(`Analyzing issue ${context.issue.key}...`);

        const { result, duration_ms } = await withTiming(async () => {
            // gpt-5-mini only supports temperature=1 (default)
            const temperature = this.model.includes('gpt-5') ? 1 : 0.1;
            
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: "system", content: buildSystemPrompt({ primaryLanguage: context.runtime, isMulti: context.hasMultipleLanguages }) },
                    { role: "user", content: buildUserPrompt(context) },
                ],
                temperature,
                response_format: { type: "json_object" },
            });

            return response.choices[0]?.message?.content ?? "";
        });

        log.timed("info", `AI analysis complete for ${context.issue.key}`, duration_ms);
        const analysis = parseAiResponse(result);
        
        // Post-process: Fix router detection issues in test files
        return fixRouterDetection(analysis, context);
    }
}
