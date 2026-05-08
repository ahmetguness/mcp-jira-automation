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
        const testFileName = `test-api-${context.issue.key.toLowerCase()}.py`;

        try {
            // ── 1. Seed workspace with source & test files ──────────
            await this.seedWorkspace(workDir, context, testFileName);

            // ── 2. Build prompt file (aider-specific, compact) ─────
            const fullPrompt = this.buildAiderPrompt(context);

            const promptFile = path.join(workDir, ".aider-prompt.md");
            await writeFile(promptFile, fullPrompt, "utf-8");

            // ── 3. Build aider CLI args ─────────────────────────────
            const args = this.buildArgs(promptFile, context, testFileName);

            // ── 4. Build env vars for aider ─────────────────────────
            const env = this.buildEnv();

            // ── 5. Run aider ────────────────────────────────────────
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

            // ── 6. Collect generated/modified files ─────────────────
            let patches = await this.collectPatches(workDir, context);

            // ── 6b. Fallback: if aider didn't write files (timeout/error),
            //        parse the code from stdout ──────────────────────
            const hasRealPyFile = patches.some(p =>
                p.path.endsWith(".py") && p.content.trim() !== "# API Test Suite"
            );
            if (!hasRealPyFile) {
                log.info("Aider didn't write usable .py files to disk — extracting code from stdout");
                const extracted = this.extractCodeFromStdout(stdout);
                if (extracted) {
                    // Remove placeholder patch if present
                    patches = patches.filter(p => p.content.trim() !== "# API Test Suite");
                    patches.push({ path: testFileName, content: extracted, action: "create" });
                }
            }

            // ── 7. Determine run commands ───────────────────────────
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
    private async seedWorkspace(workDir: string, context: TaskContext, testFileName: string): Promise<void> {
        const { sources, tests } = this.selectRelevantFiles(context);
        const allFiles = [...sources, ...tests];

        for (const file of allFiles) {
            const filePath = path.join(workDir, file.path);
            const dir = path.dirname(filePath);
            await this.ensureDir(dir);
            await writeFile(filePath, file.content, "utf-8");
        }

        // Create empty test file so aider can edit it
        const testApiPath = path.join(workDir, testFileName);
        await writeFile(testApiPath, "# API Test Suite\n", "utf-8");

        log.debug(`Seeded workspace with ${allFiles.length + 1} files (${sources.length} source + ${tests.length} test + ${testFileName})`);
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
        const testFileName = `test-api-${context.issue.key.toLowerCase()}.py`;
        let prompt = `# Task: ${context.issue.key} — ${context.issue.summary}\n\n`;

        if (context.issue.description) {
            prompt += `## Jira Description\n${context.issue.description}\n\n`;
        }

        if (context.workdirRelative) {
            prompt += `This is a monorepo. The backend is in "${context.workdirRelative}/". Read the source files to find correct route paths.\n\n`;
        }

        prompt += `## Instructions
You are an API test engineer. Generate ${testFileName} using ONLY Python stdlib (http.client, json, os, sys, urllib.parse). No external libraries.

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

TEST COVERAGE RULES — MANDATORY, NO EXCEPTIONS:
For EVERY endpoint in the Jira description, you MUST write exactly 3 test functions:
  1. test_ENDPOINT_happy_path — correct request, expect 200
  2. test_ENDPOINT_not_found — append /nonexistent-xyz-123 to path, expect 404 or 400
  3. test_ENDPOINT_invalid_auth — send header Authorization: Bearer invalid-token-12345, expect 200/401/403
If there are 4 endpoints, you MUST write exactly 12 test functions. Count them.
DO NOT skip not_found tests for any endpoint. Every endpoint gets all 3 tests.
- POST/PUT/DELETE: accept 200, 201, 400, 401, 403, 422 as PASS. Only FAIL on 404 (wrong path) or 405 (wrong method)
- Skipped tests do NOT count as failures. Only increment "failed" for actual assertion failures
- Content-Type: accept any response with valid JSON, even if header says text/plain
- Profile endpoints (GET /me, /profile): only assert status==200 and body is not None

EXIT CODE RULES:
- sys.exit(0) if failed == 0 (even if some tests skipped)
- sys.exit(1) ONLY if failed > 0

CRUD FLOW TESTING (for POST/PUT/PATCH/DELETE endpoints):
- Chain as a flow: CREATE → UPDATE → DELETE
- Extract ID from CREATE response (look for id, _id, uuid, slug)
- If CREATE returns 404/405, the path is WRONG — skip remaining CRUD steps
- If no ID obtained, SKIP update/delete (increment skipped, not failed)

QUERY PARAMETER TESTING:
- Include query params directly in the path: make_request('GET', '/api/cars?brand=Toyota&page=1')
- URL-encode special characters using urllib.parse.quote

SINGLE RESOURCE BY ID:
- First call the list endpoint to get a real ID
- Use that ID for GET /resource/{id} tests
- If no items exist, SKIP the test (increment skipped, not failed)
- Detect ID format from list response (id, _id, uuid, slug)

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
    # IMPORTANT: The paths and field names below are EXAMPLES.
    # You MUST read the source code (app.ts, routes/, auth/) to find:
    #   - The EXACT register endpoint path (e.g., /api/auth/register, /api/users/signup)
    #   - The EXACT login endpoint path (e.g., /api/auth/login, /api/users/signin)
    #   - The EXACT required fields (e.g., email/username, password, name/firstName)
    # Replace the paths and fields below with what you find in the source code.
    
    REGISTER_PATH = "/api/auth/register"  # <-- CHANGE THIS based on source code
    LOGIN_PATH = "/api/auth/login"        # <-- CHANGE THIS based on source code
    REGISTER_BODY = {                     # <-- CHANGE FIELDS based on source code
        "email": "testbot@example.com", "password": "TestPass123!", "name": "Test Bot"
    }
    LOGIN_BODY = {                        # <-- CHANGE FIELDS based on source code
        "email": "testbot@example.com", "password": "TestPass123!"
    }
    
    # Step 1: Register
    reg = make_request("POST", REGISTER_PATH, body=REGISTER_BODY)
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
    login = make_request("POST", LOGIN_PATH, body=LOGIN_BODY)
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
        prompt += `Write SEPARATE test functions for each scenario (happy path, not found, invalid auth). Do NOT use a generic test_endpoint() wrapper — write explicit test functions like test_drivers_happy_path(), test_drivers_not_found(), test_drivers_invalid_auth().\n`;
        prompt += `Write the complete ${testFileName} file now. Do not ask questions.\n`;

        return prompt;
    }

    /** Build aider CLI arguments */
    private buildArgs(promptFile: string, context: TaskContext, testFileName: string): string[] {
        const args: string[] = [
            "--message-file", promptFile,
            "--yes-always",             // auto-accept all changes
            "--no-stream",              // non-interactive
            "--no-pretty",              // plain output for parsing
            "--no-detect-urls",         // don't scrape URLs found in prompts
            "--no-git",                 // skip git — we track changes ourselves via collectPatches
            "--edit-format", "diff",    // diff format = fewer tokens than whole
            "--model", this.model,
        ];

        const { sources, tests } = this.selectRelevantFiles(context);

        for (const f of sources) {
            args.push("--read", f.path);
        }

        for (const f of tests) {
            args.push(f.path);
        }

        // Add test file as the main editable output file
        args.push(testFileName);

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

    /** Clean aider stdout for Jira/PR reporting — remove all noise, keep only meaningful text */
    private cleanStdout(stdout: string): string {
        const lines = stdout.split(/\r?\n/);
        const useful: string[] = [];
        let inCodeBlock = false;

        for (const line of lines) {
            // Track code blocks to skip entire diff/code sections
            if (line.startsWith("```")) {
                inCodeBlock = !inCodeBlock;
                continue;
            }
            if (inCodeBlock) continue;

            const trimmed = line.trim();

            // Skip empty lines
            if (trimmed === "") continue;

            // Skip aider boilerplate & session info
            if (trimmed.includes("Can't initialize prompt toolkit")) continue;
            if (trimmed.includes("skip this check with")) continue;
            if (trimmed.includes(".gitignore")) continue;
            if (trimmed.startsWith("Aider v")) continue;
            if (trimmed.startsWith("Main model:")) continue;
            if (trimmed.startsWith("Weak model:")) continue;
            if (trimmed.startsWith("Git repo:")) continue;
            if (trimmed.startsWith("Repo-map:")) continue;
            if (trimmed.startsWith("Added ")) continue;

            // Skip token/cost lines: "Tokens: 4.9k sent, 1.8k received. Cost: $0.03..."
            if (/^Tokens:\s/.test(trimmed)) continue;
            // Skip "Applied edit to ..." lines
            if (/^Applied edit to\s/.test(trimmed)) continue;
            // Skip bare command lines that look like "python test-api.py"
            if (/^python\s+[\w./-]+\.py$/.test(trimmed)) continue;
            // Skip "cmd.exe?" prompt artifacts
            if (trimmed.includes("cmd.exe?")) continue;

            // Skip diff markers
            if (trimmed.startsWith("@@")) continue;
            if (/^[+-][^+-]/.test(trimmed)) continue;
            if (trimmed.startsWith("<<<<<<") || trimmed.startsWith("======") || trimmed.startsWith(">>>>>>")) continue;
            if (trimmed === "SEARCH" || trimmed === "REPLACE") continue;

            // Skip bare file path headers from diffs
            if (/^[a-zA-Z0-9_/.-]+\.(py|js|ts|json|md|yaml|yml)$/.test(trimmed)) continue;

            // Skip filler phrases that add no value
            if (/^Here is the (?:complete )?implementation/i.test(trimmed)) continue;
            if (/^You can run the test suite/i.test(trimmed)) continue;
            if (/^Let'?s create the/i.test(trimmed)) continue;
            if (/^I will create/i.test(trimmed)) continue;
            if (/^This (?:file )?will include/i.test(trimmed)) continue;

            useful.push(line);
        }

        const cleaned = useful.join("\n").trim();
        if (!cleaned || cleaned.length < 10) {
            return "";
        }
        return cleaned.slice(0, 2000);
    }
}
