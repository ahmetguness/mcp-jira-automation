/**
 * Google Gemini AI provider.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AiProvider } from "./provider.js";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse } from "./provider.js";
import type { TaskContext, AiAnalysis } from "../types.js";
import type { Config } from "../config.js";
import { createLogger, withTiming } from "../logger.js";

const log = createLogger("ai:gemini");

export class GeminiProvider implements AiProvider {
    private genAI: GoogleGenerativeAI;
    private model: string;

    constructor(config: Config) {
        if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
        this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
        this.model = config.aiModel ?? "gemini-2.0-flash";
        log.info(`Gemini provider initialized (model: ${this.model})`);
    }

    async analyze(context: TaskContext): Promise<AiAnalysis> {
        log.info(`Analyzing issue ${context.issue.key}...`);

        const { result, duration_ms } = await withTiming(async () => {
            const model = this.genAI.getGenerativeModel({
                model: this.model,
                systemInstruction: buildSystemPrompt(),
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                },
            });

            const response = await model.generateContent(buildUserPrompt(context));
            return response.response.text();
        });

        log.timed("info", `AI analysis complete for ${context.issue.key}`, duration_ms);
        return parseAiResponse(result);
    }
}
