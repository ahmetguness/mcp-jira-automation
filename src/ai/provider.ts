/**
 * AI provider interface and shared system prompt.
 */

import type { TaskContext, AiAnalysis } from "../types.js";
import { getBasePrompt } from "./prompts/basePrompt.js";
import { getOverlayPrompt } from "./prompts/overlays.js";
import { getMultiLangRules } from "./prompts/multiLangRules.js";

export interface AiProvider {
  /** Analyze a task and generate patches + commands */
  analyze(context: TaskContext): Promise<AiAnalysis>;
}

/** Build the system prompt for the AI model */
// export function buildSystemPrompt(): string {
//     return `You are an expert software engineer AI assistant working on Jira tasks.
// You will receive a Jira issue (title + description) along with relevant source code files from the repository.

// Your job is to:
// 1. Analyze the issue and understand what needs to be done
// 2. Examine the provided source code
// 3. Create a plan of changes
// 4. Generate the actual code changes (patches)
// 5. Suggest test commands to verify the changes

// IMPORTANT RULES:
// - Only modify files that are relevant to the task
// - Write clean, production-quality code
// - Follow the existing code style and conventions
// - Include proper error handling
// - Do NOT modify unrelated files
// - Be precise with file paths

// You MUST respond with a valid JSON object with this exact structure:
// {
//   "summary": "Brief summary of what was analyzed and found",
//   "plan": "Detailed explanation of the changes being made and why",
//   "patches": [
//     {
//       "path": "relative/path/to/file.ts",
//       "content": "complete new content of the file",
//       "action": "create" | "modify" | "delete"
//     }
//   ],
//   "commands": [
//     "npm ci",
//     "npm run test:report > test-results.txt"
//   ],
//   "environment": "node"
// }

// Notes on patches:
// - You do NOT have to provide patches if no code changes are necessary to fulfill the Jira issue (e.g. if the user only asks to run a test and report the result). The \`patches\` array can be empty.
// - If the user wants to commit a generated file (like a test report or build artifact), do NOT fake a code change. Just include the command to generate it (e.g., \`npm test > report.txt\`), and the system will automatically parse and include the generated file in the PR.

// Notes on commands:
// - Only include safe, standard test/build commands
// - Common safe commands: npm ci, npm test, npm run build, pnpm test, python -m pytest, go test, mvn test
// - You MUST scan the provided 'Source Files' and 'Test Files' for external imports (e.g. \`import pandas\`, \`from fastapi import FastAPI\`).
// - CRITICAL: You MUST explicitly install ALL application dependencies found in the imports of the provided files using pip install, IN ADDITION TO the testing framework (e.g. \`pip install pytest fastapi httpx pandas\`). If you fail to do this, the tests will fail with ModuleNotFoundError!
// - WARNING: pip installed binaries may not be in the PATH. Always prefix them (e.g. use \`python -m pytest\` instead of \`pytest\`).
// - Do NOT use shell operators like &&, ||, or ;. Instead, list sequential commands separately in the 'commands' array
// - Do NOT include destructive commands (rm -rf, sudo, curl | bash, etc.)
// - Do NOT include installation commands that modify the system externally

// Notes on writing tests:
// - When writing tests for web APIs, DO NOT make live network requests (like \`requests.get('http://localhost')\`) unless you are explicitly instructed to start the server. The server will not be running in the test environment.
// - Instead, you MUST use the web framework's native testing client (e.g., FastAPI \`TestClient\`, Flask \`test_client\`, Express \`supertest\`) and import the app object directly from the source code.
// - If testing FastAPI using \`TestClient\`, you MUST also include \`httpx\` in your \`pip install\` command!

// Notes on environment:
// - Set "environment" to the primary language/runtime of the repository: "node", "python", "go", "rust", "java", or "unknown"
// - This helps the executor select the correct Docker image for running commands
// - The system will auto-detect from marker files; this is a fallback hint`;
// }

export function buildSystemPrompt(options: { primaryLanguage?: string; isMulti?: boolean } = {}): string {
  const { primaryLanguage, isMulti } = options;
  let prompt = getBasePrompt();

  if (isMulti) {
    prompt += "\n\n" + getMultiLangRules();
  }

  if (primaryLanguage && primaryLanguage !== "unknown") {
    prompt += "\n\n" + getOverlayPrompt(primaryLanguage);
  } else {
    prompt += "\n\n" + getOverlayPrompt("unknown");
  }

  return prompt;
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

  if (context.runtimeSelection) {
    const rs = context.runtimeSelection;
    prompt += `## Runtime Detection\n`;
    prompt += `primary_language: ${rs.primary}\n`;

    // Group exactly by language to compute sums, instead of array of disparate detections
    const langScores: Record<string, number> = {};
    for (const d of rs.detected) {
      langScores[d.lang] = (langScores[d.lang] || 0) + (d.confidence || 0);
    }
    const detectedLangs = Object.entries(langScores)
      .filter(([_, score]) => score > 0)
      .map(([lang, score]) => `${lang}(${score.toFixed(2)})`)
      .join(", ");

    if (detectedLangs) {
      prompt += `detected_languages: ${detectedLangs}\n`;
    }

    if (rs.markers && rs.markers.length > 0) {
      prompt += `marker_files: ${rs.markers.map((m: string) => m.split('/').pop()).join(", ")}\n`;
    }

    prompt += `multi_language_repo: ${rs.isMulti}\n\n`;
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

/**
 * Post-process AI analysis to fix common router detection issues.
 * If AI generated test code that calls app.listen() but source exports a router,
 * automatically fix it to use http.createServer(router).
 */
export function fixRouterDetection(analysis: AiAnalysis, context: TaskContext): AiAnalysis {
  // Check if any source file exports a router
  const hasRouterExport = context.sourceFiles.some(f => {
    const content = f.content.toLowerCase();
    return (
      (content.includes('express.router()') || content.includes('router()')) &&
      (content.includes('module.exports') || content.includes('export default') || content.includes('export {'))
    );
  });

  if (!hasRouterExport) {
    return analysis; // No router detected, return as-is
  }

  // Fix test patches that incorrectly use app.listen()
  const fixedPatches = analysis.patches.map(patch => {
    // Only process test files
    if (!patch.path.match(/test.*\.js$/i) && !patch.action) {
      return patch;
    }

    const content = patch.content;
    
    // Check if test uses app.listen() or router.listen() pattern (the bug)
    const hasListenBug = (content.includes('.listen(') && !content.includes('http.createServer('));
    
    if (hasListenBug) {
      let fixedContent = content;
      
      // Pattern 1: const server = app.listen(port); or const server = router.listen(port);
      fixedContent = fixedContent.replace(
        /const\s+server\s*=\s*(\w+)\.listen\((\d+)\);/g,
        (match, varName, port) => {
          return `const server = http.createServer(${varName});\nserver.listen(${port});`;
        }
      );
      
      // Pattern 2: app.listen(port) or router.listen(port) without assignment
      fixedContent = fixedContent.replace(
        /(\w+)\.listen\((\d+)\);/g,
        (match, varName, port) => {
          return `const server = http.createServer(${varName});\nserver.listen(${port});`;
        }
      );
      
      // Ensure http module is imported if not already
      if (!fixedContent.includes("require('http')") && !fixedContent.includes('require("http")')) {
        // Find the first require statement
        const requireMatch = fixedContent.match(/const\s+\w+\s*=\s*require\([^)]+\);/);
        if (requireMatch) {
          const insertPos = fixedContent.indexOf(requireMatch[0]) + requireMatch[0].length;
          fixedContent = fixedContent.slice(0, insertPos) + 
                       "\nconst http = require('http');" + 
                       fixedContent.slice(insertPos);
        } else {
          // No require found, add at the top
          fixedContent = "const http = require('http');\n" + fixedContent;
        }
      }
      
      return { ...patch, content: fixedContent };
    }
    
    return patch;
  });

  return { ...analysis, patches: fixedPatches };
}
