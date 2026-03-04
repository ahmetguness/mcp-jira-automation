/**
 * AI provider interface and shared system prompt.
 */

import type { TaskContext, AiAnalysis } from "../types.js";

export interface AiProvider {
    /** Analyze a task and generate patches + commands */
    analyze(context: TaskContext): Promise<AiAnalysis>;
}

/** Build the system prompt for the AI model */
export function buildSystemPrompt(): string {
    return `You are an expert software engineer AI assistant working on Jira tasks.
You will receive a Jira issue (title + description) along with relevant source code files from the repository.

Your job is to:
1. Analyze the issue and understand what needs to be done
2. Examine the provided source code
3. Create a plan of changes
4. Generate the actual code changes (patches)
5. Suggest test commands to verify the changes

IMPORTANT RULES:
- Only modify files that are relevant to the task
- Write clean, production-quality code
- Follow the existing code style and conventions
- Include proper error handling
- Do NOT modify unrelated files
- Be precise with file paths

You MUST respond with a valid JSON object with this exact structure:
{
  "summary": "Brief summary of what was analyzed and found",
  "plan": "Detailed explanation of the changes being made and why",
  "patches": [
    {
      "path": "relative/path/to/file.ts",
      "content": "complete new content of the file",
      "action": "create" | "modify" | "delete"
    }
  ],
  "commands": [
    "npm ci",
    "npm run test:report > test-results.txt"
  ],
  "environment": "node"
}

Notes on patches:
- You do NOT have to provide patches if no code changes are necessary to fulfill the Jira issue (e.g. if the user only asks to run a test and report the result). The \`patches\` array can be empty.
- If the user wants to commit a generated file (like a test report or build artifact), do NOT fake a code change. Just include the command to generate it (e.g., \`npm test > report.txt\`), and the system will automatically parse and include the generated file in the PR.

Notes on commands:
- Only include safe, standard test/build commands
- Common safe commands: npm ci, npm test, npm run build, pnpm test, pytest, go test, mvn test
- Do NOT include destructive commands (rm -rf, sudo, curl | bash, etc.)
- Do NOT include installation commands that modify the system

Notes on environment:
- Set "environment" to the primary language/runtime of the repository: "node", "python", "go", "rust", "java", or "unknown"
- This helps the executor select the correct Docker image for running commands
- The system will auto-detect from marker files; this is a fallback hint`;
}

/** Build the user prompt from TaskContext */
export function buildUserPrompt(context: TaskContext): string {
    let prompt = `## Jira Issue: ${context.issue.key}\n`;
    prompt += `**Title:** ${context.issue.summary}\n`;
    prompt += `**Type:** ${context.issue.issueType}\n`;
    prompt += `**Status:** ${context.issue.status}\n\n`;

    if (context.issue.description) {
        prompt += `**Description:**\n${context.issue.description}\n\n`;
    }

    prompt += `## Repository: ${context.repo.name}\n`;
    prompt += `**Default Branch:** ${context.repo.defaultBranch}\n\n`;

    if (context.sourceFiles.length > 0) {
        prompt += `## Source Files\n\n`;
        for (const f of context.sourceFiles) {
            prompt += `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\`\n\n`;
        }
    }

    if (context.testFiles.length > 0) {
        prompt += `## Test Files\n\n`;
        for (const f of context.testFiles) {
            prompt += `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\`\n\n`;
        }
    }

    return prompt;
}

/** Parse AI response into AiAnalysis */
export function parseAiResponse(text: string): AiAnalysis {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1]! : text;

    try {
        const parsed = JSON.parse(jsonStr.trim());
        return {
            summary: parsed.summary ?? "",
            plan: parsed.plan ?? "",
            patches: Array.isArray(parsed.patches) ? parsed.patches : [],
            commands: Array.isArray(parsed.commands) ? parsed.commands : [],
            environment: typeof parsed.environment === "string" ? parsed.environment : undefined,
        };
    } catch {
        // If JSON parsing fails, return the raw text as summary
        return {
            summary: text,
            plan: "",
            patches: [],
            commands: [],
        };
    }
}
