/**
 * Anthropic AI provider.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider } from "./provider.js";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse } from "./provider.js";
import type { TaskContext, AiAnalysis } from "../types.js";
import type { Config } from "../config.js";
import { createLogger, withTiming } from "../logger.js";

const log = createLogger("ai:anthropic");

export class AnthropicProvider implements AiProvider {
    private client: Anthropic;
    private model: string;

    constructor(config: Config) {
        if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic");
        this.client = new Anthropic({ apiKey: config.anthropicApiKey });
        this.model = config.aiModel ?? "claude-sonnet-4-20250514";
        log.info(`Anthropic provider initialized (model: ${this.model})`);
    }

    async analyze(context: TaskContext): Promise<AiAnalysis> {
        log.info(`Analyzing issue ${context.issue.key}...`);

        const { result, duration_ms } = await withTiming(async () => {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 8192,
                system: buildSystemPrompt({ primaryLanguage: context.runtime, isMulti: context.hasMultipleLanguages }),
                messages: [
                    { role: "user", content: buildUserPrompt(context) },
                ],
                temperature: 0.1,
            });

            const textBlock = response.content.find((b) => b.type === "text");
            return textBlock?.type === "text" ? textBlock.text : "";
        });

        log.timed("info", `AI analysis complete for ${context.issue.key}`, duration_ms);
        return parseAiResponse(result);
    }
}
