/**
 * Prompt loader — loads base prompt from file or falls back to built-in default.
 *
 * Priority:
 * 1. CUSTOM_PROMPT_FILE env var (absolute or relative path)
 * 2. ./prompts/custom.md in project root
 * 3. Built-in basePrompt.ts (default)
 */

import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../../logger.js";
import { getBasePrompt } from "./basePrompt.js";

const log = createLogger("ai:prompt-loader");

// Project root = two levels up from src/ai/prompts/
const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

let _cachedPrompt: string | null = null;
let _cachedSource: string | null = null;

/** Load the system prompt — file-based override or built-in default */
export function loadSystemPrompt(): string {
    if (_cachedPrompt !== null) return _cachedPrompt;

    // 1. CUSTOM_PROMPT_FILE env var
    const envPath = process.env.CUSTOM_PROMPT_FILE;
    if (envPath) {
        const abs = resolve(envPath);
        if (existsSync(abs)) {
            _cachedPrompt = readFileSync(abs, "utf-8");
            _cachedSource = abs;
            log.info(`Using custom prompt from CUSTOM_PROMPT_FILE: ${abs}`);
            return _cachedPrompt;
        }
        log.warn(`CUSTOM_PROMPT_FILE set but not found: ${abs} — falling back`);
    }

    // 2. ./prompts/custom.md in project root
    const defaultCustomPath = join(PROJECT_ROOT, "prompts", "custom.md");
    if (existsSync(defaultCustomPath)) {
        _cachedPrompt = readFileSync(defaultCustomPath, "utf-8");
        _cachedSource = defaultCustomPath;
        log.info(`Using custom prompt from: ${defaultCustomPath}`);
        return _cachedPrompt;
    }

    // 3. Built-in default
    _cachedPrompt = getBasePrompt();
    _cachedSource = "built-in";
    log.debug("Using built-in base prompt");
    return _cachedPrompt;
}

/** Returns which source the prompt was loaded from (for logging) */
export function getPromptSource(): string {
    if (_cachedSource === null) loadSystemPrompt();
    return _cachedSource!;
}

/** Clear cache — useful for testing */
export function clearPromptCache(): void {
    _cachedPrompt = null;
    _cachedSource = null;
}
