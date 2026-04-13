/**
 * Aider AI provider — delegates code analysis and test generation to aider CLI.
 *
 * Aider runs in non-interactive scripting mode (--message / --message-file)
 * and writes test files directly to disk. We then read those files back
 * and return them as AiAnalysis patches.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, readdir, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiProvider } from "./provider.js";
import type { TaskContext, AiAnalysis, AiPatch } from "../types.js";
import type { ScmFile } from "../types.js";
import type { Config } from "../config.js";
import { createLogger, withTiming } from "../logger.js";

const log = createLogger("ai:aider");
const execFileAsync = promisify(execFile);

export class AiderProvider implements AiProvider {
    private aiderPath: string;
    private model: string;
    private timeoutMs: number;
    private openaiApiKey?: string;
    private anthropicApiKey?: string;
    private geminiApiKey?: string;
    private vllmBaseUrl?: string;

    constructor(config: Config) {
        this.aiderPath = config.aiderPath ?? "aider";
        this.model = config.aiderModel ?? config.aiModel ?? "gpt-4o";
        // Aider needs more time than direct API calls (repo map + AI call + file writes)
        // Use at least 5 minutes, regardless of EXEC_TIMEOUT_MS
        this.timeoutMs = Math.max(config.execTimeoutMs, 300_000);

        // Pass through API keys so aider can reach the LLM backend
        this.openaiApiKey = config.openaiApiKey;
        this.anthropicApiKey = config.anthropicApiKey;
        this.geminiApiKey = config.geminiApiKey;
        this.vllmBaseUrl = config.vllmBaseUrl;

        log.debug(`Aider provider initialized (model: ${this.model}, binary: ${this.aiderPath})`);
    }

    async analyze(context: TaskContext): Promise<AiAnalysis> {
        log.info(`Analyzing issue ${context.issue.key} via aider...`);

        const { result, duration_ms } = await withTiming(() => this.runAider(context));

        log.timed("info", `Aider analysis complete for ${context.issue.key}`, duration_ms);
        return result;
    }

    /**
     * Run aider in a temporary workspace and collect generated files.
     *
     * Strategy:
     * 1. Create a temp dir with source files so aider has repo context
     * 2. Write the prompt (system + user) to a message file
     * 3. Invoke aider CLI in non-interactive mode
     * 4. Collect any new/modified .py test files as patches
     */
    private async runAider(context: TaskContext): Promise<AiAnalysis> {
        const workDir = await mkdtemp(path.join(tmpdir(), "aider-"));

        try {
            // ── 1. Seed workspace with source & test files ──────────
            await this.seedWorkspace(workDir, context);

            // ── 2. Initialize git repo (aider needs it for repo-map) ─
            await execFileAsync("git", ["init"], { cwd: workDir });
            await execFileAsync("git", ["add", "."], { cwd: workDir });
            await execFileAsync("git", [
                "-c", "user.name=aider-bot",
                "-c", "user.email=bot@aider.local",
                "commit", "-m", "initial",
            ], { cwd: workDir });

            // ── 3. Build prompt file (aider-specific, compact) ─────
            const fullPrompt = this.buildAiderPrompt(context);

            const promptFile = path.join(workDir, ".aider-prompt.md");
            await writeFile(promptFile, fullPrompt, "utf-8");

            // ── 4. Build aider CLI args ─────────────────────────────
            const args = this.buildArgs(promptFile, context);

            // ── 5. Build env vars for aider ─────────────────────────
            const env = this.buildEnv();

            // ── 6. Run aider ────────────────────────────────────────
            log.info(`Running aider (model: ${this.model})...`);
            log.debug(`aider args: ${args.join(" ")}`);

            let stdout = "";
            let stderr = "";

            try {
                const result = await execFileAsync(this.aiderPath, args, {
                    cwd: workDir,
                    env,
                    timeout: this.timeoutMs,
                    maxBuffer: 10 * 1024 * 1024, // 10 MB
                });
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (err: unknown) {
                const execErr = err as { stdout?: string; stderr?: string; code?: number };
                stdout = execErr.stdout ?? "";
                stderr = execErr.stderr ?? "";
                // Aider may exit non-zero but still produce valid output
                log.warn(`Aider exited with error: ${stderr.slice(0, 500)}`);
            }

            log.debug(`Aider stdout (${stdout.length} chars), stderr (${stderr.length} chars)`);

            // ── 7. Collect generated/modified files ─────────────────
            let patches = await this.collectPatches(workDir, context);

            // ── 7b. Fallback: if aider didn't write files (timeout/error),
            //        parse the code from stdout ──────────────────────
            if (patches.length === 0 || (patches.length === 1 && patches[0]!.content.trim() === "# API Test Suite")) {
                log.info("Aider didn't write files to disk — extracting code from stdout");
                const extracted = this.extractCodeFromStdout(stdout);
                if (extracted) {
                    patches = [{ path: "test-api.py", content: extracted, action: "create" }];
                }
            }

            // ── 8. Determine run commands ───────────────────────────
            const commands = this.inferCommands(patches);

            return {
                summary: `Aider generated ${patches.length} file(s) for ${context.issue.key}`,
                plan: this.cleanStdout(stdout),
                patches,
                commands,
                environment: "python",
            };
        } finally {
            // Cleanup temp dir
            await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    /** Write only the files aider will actually use into the temp workspace */
    private async seedWorkspace(workDir: string, context: TaskContext): Promise<void> {
        const { sources, tests } = this.selectRelevantFiles(context);
        const allFiles = [...sources, ...tests];

        for (const file of allFiles) {
            const filePath = path.join(workDir, file.path);
            const dir = path.dirname(filePath);
            await this.ensureDir(dir);
            await writeFile(filePath, file.content, "utf-8");
        }

        // Create empty test-api.py so aider can edit it (diff format needs existing file)
        const testApiPath = path.join(workDir, "test-api.py");
        await writeFile(testApiPath, "# API Test Suite\n", "utf-8");

        log.debug(`Seeded workspace with ${allFiles.length + 1} files (${sources.length} source + ${tests.length} test + test-api.py)`);
    }

    /** Select only workdir-relevant files, with limits */
    private selectRelevantFiles(context: TaskContext): { sources: ScmFile[]; tests: ScmFile[] } {
        const workdir = context.workdirRelative;
        const isRelevant = (filePath: string) =>
            !workdir || filePath.startsWith(workdir + "/") || !filePath.includes("/");

        // Prioritize app entry points and route files over seeds/scripts
        const sourceRank = (f: ScmFile): number => {
            const p = f.path.toLowerCase();
            if (p.includes("/src/app") || p.includes("/src/server") || p.includes("/src/index")) return 0;
            if (p.includes("/routes/") || p.includes("/controllers/") || p.includes("/middleware/") || p.includes("/auth")) return 1;
            if (p.includes("/config/") || p.includes("/lib/") || p.includes("/utils/")) return 2;
            if (p.endsWith("package.json") || p.endsWith("tsconfig.json")) return 3;
            if (p.includes("/prisma/") || p.includes("/scripts/") || p.includes("/seed")) return 5;
            return 4;
        };

        const sources = context.sourceFiles
            .filter(f => isRelevant(f.path))
            .sort((a, b) => sourceRank(a) - sourceRank(b))
            .slice(0, 12);

        const tests = context.testFiles
            .filter(f => isRelevant(f.path))
            .slice(0, 3);

        return { sources, tests };
    }

    /** Recursively ensure directory exists */
    private async ensureDir(dir: string): Promise<void> {
        await mkdir(dir, { recursive: true });
    }

    /**
     * Build a compact prompt for aider.
     * Unlike other providers, we do NOT include file contents here —
     * aider already sees them via --read and positional args.
     */
    private buildAiderPrompt(context: TaskContext): string {
        let prompt = `# Task: ${context.issue.key} — ${context.issue.summary}\n\n`;

        if (context.issue.description) {
            prompt += `## Jira Description\n${context.issue.description}\n\n`;
        }

        if (context.workdirRelative) {
            prompt += `This is a monorepo. The backend is in "${context.workdirRelative}/". Read the source files to find correct route paths.\n\n`;
        }

        prompt += `## Instructions
You are an API test engineer. Generate test-api.py using ONLY Python stdlib (http.client, json, os, sys, urllib.parse). No external libraries.

CRITICAL — READ SOURCE CODE FIRST:
- Read app.ts/server.ts to find route prefixes (app.use('/api', router))
- TRACE THE FULL PATH: if app.use('/api', mainRouter) and mainRouter.use('/auth', authRouter), the full path is /api/auth
- Read route handlers to find required fields (email, password, name, etc.)
- The Jira description may say "POST /auth/register" but the actual path might be "/api/auth/register" — USE THE CODE

AUTHENTICATION FLOW (CRITICAL — database starts EMPTY):
1. DETECT auth routes from source code (look for /auth/register, /auth/login, etc.)
2. REGISTER a test user: email "testbot@example.com", password "TestPass123!", include ALL required fields from the schema
3. LOGIN to get token: extract from response (look for token, accessToken, access_token, data.token, data.accessToken)
4. If register returns token directly, use it. If not, call login.
5. If register fails with 409 (user exists), try login directly.
6. Store token globally, use Authorization: Bearer <token> for protected endpoints
7. Implement setup_auth() that runs ONCE before all tests

TEST TOLERANCE RULES:
- POST/PUT/DELETE: accept 200, 201, 400, 401, 403, 422 as PASS. Only FAIL on 404 (wrong path) or 405 (wrong method)
- Skipped tests do NOT count as failures. Only increment "failed" for actual assertion failures
- Content-Type: accept any response with valid JSON, even if header says text/plain
- Profile endpoints (GET /me, /profile): only assert status==200 and body is not None

EXIT CODE RULES:
- sys.exit(0) if failed == 0 (even if some tests skipped)
- sys.exit(1) ONLY if failed > 0

`;

        prompt += `You MUST use this exact make_request helper at the top:\n`;
        prompt += `\`\`\`python
import http.client
import json
import os
import sys
from urllib.parse import urlparse

SERVER_PORT = os.environ.get("SERVER_PORT", "3001")
BASE_URL = os.environ.get("API_BASE_URL", f"http://localhost:{SERVER_PORT}")
TIMEOUT = 10
passed = 0
failed = 0
skipped = 0
auth_token = None

def make_request(method, path, body=None, headers=None):
    if headers is None:
        headers = {}
    if body is not None and "Content-Type" not in headers:
        headers["Content-Type"] = "application/json"
    url = urlparse(BASE_URL + path)
    try:
        if url.scheme == "https":
            import ssl
            conn = http.client.HTTPSConnection(url.hostname, url.port or 443, timeout=TIMEOUT)
        else:
            conn = http.client.HTTPConnection(url.hostname, url.port or 80, timeout=TIMEOUT)
        body_data = json.dumps(body) if body is not None else None
        full_path = url.path + ("?" + url.query if url.query else "")
        conn.request(method, full_path, body=body_data, headers=headers)
        response = conn.getresponse()
        data = response.read().decode("utf-8")
        try:
            response_body = json.loads(data) if data else None
        except json.JSONDecodeError:
            response_body = data
        conn.close()
        return {"status": response.status, "body": response_body, "headers": dict(response.getheaders())}
    except Exception as e:
        return {"status": 0, "body": None, "headers": {}, "error": str(e)}

def get_auth_headers():
    if auth_token:
        return {"Authorization": f"Bearer {auth_token}"}
    return {}

def print_req_res(method, path, response):
    print(f"    Request: {method} {BASE_URL}{path}")
    print(f"    Status: {response.get('status', '?')}")
    body = response.get("body")
    if body is not None:
        s = json.dumps(body, ensure_ascii=False, default=str)
        print(f"    Body: {s[:500]}")
    if response.get("error"):
        print(f"    Error: {response['error']}")

def setup_auth():
    global auth_token
    # Step 1: Register (read exact fields from source code)
    reg = make_request("POST", "/api/auth/register", body={
        "email": "testbot@example.com", "password": "TestPass123!", "name": "Test Bot"
    })
    # Try to extract token from register response
    if reg.get("status") in (200, 201) and reg.get("body"):
        b = reg["body"]
        if isinstance(b, dict):
            for k in ("token", "accessToken", "access_token"):
                if k in b:
                    auth_token = b[k]
                    return
                if "data" in b and isinstance(b["data"], dict) and k in b["data"]:
                    auth_token = b["data"][k]
                    return
    # Step 2: Login
    login = make_request("POST", "/api/auth/login", body={
        "email": "testbot@example.com", "password": "TestPass123!"
    })
    if login.get("status") in (200, 201) and login.get("body"):
        b = login["body"]
        if isinstance(b, dict):
            for k in ("token", "accessToken", "access_token"):
                if k in b:
                    auth_token = b[k]
                    return
                if "data" in b and isinstance(b["data"], dict) and k in b["data"]:
                    auth_token = b["data"][k]
                    return
\`\`\`\n\n`;

        prompt += `Use setup_auth(), get_auth_headers(), and print_req_res() in your tests. Call print_req_res() right after every make_request(). Adapt the register/login field names and paths based on what you see in the source code.\n`;
        prompt += `Write the complete test-api.py file now. Do not ask questions.\n`;

        return prompt;
    }

    /** Build aider CLI arguments */
    private buildArgs(promptFile: string, context: TaskContext): string[] {
        const args: string[] = [
            "--message-file", promptFile,
            "--yes-always",             // auto-accept all changes
            "--no-auto-commits",        // we handle commits ourselves
            "--no-stream",              // non-interactive
            "--no-pretty",              // plain output for parsing
            "--no-detect-urls",         // don't scrape URLs found in prompts
            "--edit-format", "whole",   // write complete files (not diffs)
            "--model", this.model,
        ];

        const { sources, tests } = this.selectRelevantFiles(context);

        for (const f of sources) {
            args.push("--read", f.path);
        }

        for (const f of tests) {
            args.push(f.path);
        }

        // Add test-api.py as the main editable output file
        args.push("test-api.py");

        log.debug(`Aider context: ${sources.length} source (read-only) + ${tests.length + 1} test (editable) files`);

        return args;
    }

    /** Build environment variables for the aider subprocess */
    private buildEnv(): Record<string, string> {
        const env: Record<string, string> = { ...process.env as Record<string, string> };

        // Fix Windows encoding issues (cp1252 can't handle unicode chars like ✔)
        env.PYTHONIOENCODING = "utf-8";
        env.PYTHONUTF8 = "1";

        if (this.openaiApiKey) env.OPENAI_API_KEY = this.openaiApiKey;
        if (this.anthropicApiKey) env.ANTHROPIC_API_KEY = this.anthropicApiKey;
        if (this.geminiApiKey) env.GEMINI_API_KEY = this.geminiApiKey;

        // vLLM uses OpenAI-compatible API
        if (this.vllmBaseUrl) {
            env.OPENAI_API_BASE = this.vllmBaseUrl;
            if (!env.OPENAI_API_KEY) env.OPENAI_API_KEY = "dummy";
        }

        return env;
    }

    /**
     * Walk the workspace and collect new/modified files as patches.
     * We compare against the original seeded files to detect changes.
     */
    private async collectPatches(workDir: string, context: TaskContext): Promise<AiPatch[]> {
        const originalFiles = new Map<string, string>();
        for (const f of [...context.sourceFiles, ...context.testFiles]) {
            originalFiles.set(f.path, f.content);
        }

        const patches: AiPatch[] = [];
        const files = await this.walkDir(workDir);

        for (const absPath of files) {
            const relPath = path.relative(workDir, absPath).replace(/\\/g, "/");

            // Skip hidden files and the prompt file
            if (relPath.startsWith(".") || relPath === ".aider-prompt.md") continue;

            const content = await readFile(absPath, "utf-8");
            const original = originalFiles.get(relPath);

            if (original === undefined) {
                // New file created by aider
                patches.push({ path: relPath, content, action: "create" });
            } else if (original !== content) {
                // Modified file
                patches.push({ path: relPath, content, action: "modify" });
            }
        }

        return patches;
    }

    /** Recursively list all files in a directory */
    private async walkDir(dir: string): Promise<string[]> {
        const results: string[] = [];
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.name === ".git") continue; // skip .git
            if (entry.isDirectory()) {
                results.push(...await this.walkDir(fullPath));
            } else {
                results.push(fullPath);
            }
        }

        return results;
    }

    /** Infer test run commands from generated patches */
    private inferCommands(patches: AiPatch[]): string[] {
        const hasPython = patches.some(p => p.path.endsWith(".py"));
        if (hasPython) {
            // Find the main test file
            const testFile = patches.find(p =>
                p.path.endsWith(".py") && (p.path.includes("test") || p.action === "create")
            );
            if (testFile) {
                return [`python ${testFile.path}`];
            }
            return ["python test-api.py"];
        }
        return [];
    }

    /**
     * Extract Python code from aider's stdout when it fails to write to disk.
     * Aider may output multiple diff blocks (retries). We find the longest one.
     */
    private extractCodeFromStdout(stdout: string): string | null {
        // Strategy 1: Find ALL diff blocks, pick the longest
        const diffBlocks = [...stdout.matchAll(/```diff\r?\n([\s\S]*?)```/g)];
        if (diffBlocks.length > 0) {
            let bestCode = "";
            for (const match of diffBlocks) {
                const diffContent = match[1]!;
                const lines = diffContent.split(/\r?\n/);
                const codeLines: string[] = [];

                for (const line of lines) {
                    if (line.startsWith("@@")) continue;
                    if (line.startsWith("-")) continue;
                    if (line.startsWith("+")) {
                        codeLines.push(line.slice(1));
                    } else if (!line.startsWith("\\")) {
                        codeLines.push(line);
                    }
                }

                const code = codeLines.join("\n").trim();
                if (code.length > bestCode.length) {
                    bestCode = code;
                }
            }

            if (bestCode.length > 50 && bestCode.includes("import")) {
                log.info(`Extracted ${bestCode.split("\n").length} lines from best diff block (${diffBlocks.length} blocks found)`);
                return bestCode + "\n";
            }
        }

        // Strategy 2: Look for whole file content (```python ... ```)
        const pythonBlocks = [...stdout.matchAll(/```python\r?\n([\s\S]*?)```/g)];
        if (pythonBlocks.length > 0) {
            let bestCode = "";
            for (const match of pythonBlocks) {
                const code = match[1]!.trim();
                if (code.length > bestCode.length) bestCode = code;
            }
            if (bestCode.length > 50 && bestCode.includes("import")) {
                log.info(`Extracted Python code block from stdout (${bestCode.split("\n").length} lines)`);
                return bestCode + "\n";
            }
        }

        // Strategy 3: Find the longest contiguous block of +lines (no closing ```)
        const allLines = stdout.split(/\r?\n/);
        let currentBlock: string[] = [];
        let bestBlock: string[] = [];

        for (const line of allLines) {
            if (line.startsWith("+") && !line.startsWith("+++")) {
                currentBlock.push(line.slice(1));
            } else {
                if (currentBlock.length > bestBlock.length) {
                    bestBlock = [...currentBlock];
                }
                currentBlock = [];
            }
        }
        if (currentBlock.length > bestBlock.length) {
            bestBlock = currentBlock;
        }

        if (bestBlock.length > 10) {
            const code = bestBlock.join("\n").trim();
            if (code.includes("import")) {
                log.info(`Extracted ${bestBlock.length} lines from raw +lines in stdout`);
                return code + "\n";
            }
        }

        log.warn("Could not extract code from aider stdout");
        return null;
    }

    /** Clean aider stdout for Jira reporting — remove noise, keep useful info */
    private cleanStdout(stdout: string): string {
        const lines = stdout.split(/\r?\n/);
        const useful: string[] = [];

        for (const line of lines) {
            // Skip aider boilerplate
            if (line.includes("Can't initialize prompt toolkit")) continue;
            if (line.includes("skip this check with")) continue;
            if (line.includes(".gitignore")) continue;
            if (line.startsWith("Aider v")) continue;
            if (line.startsWith("Main model:")) continue;
            if (line.startsWith("Weak model:")) continue;
            if (line.startsWith("Git repo:")) continue;
            if (line.startsWith("Repo-map:")) continue;
            if (line.startsWith("Added ")) continue;
            if (line.startsWith("```")) continue;
            if (line.startsWith("@@")) continue;
            if (line.startsWith("+") || line.startsWith("-")) continue;
            if (line.trim() === "") continue;

            useful.push(line);
        }

        return useful.join("\n").slice(0, 2000) || "Aider completed analysis";
    }
}
