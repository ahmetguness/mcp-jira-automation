/**
 * Pipeline handler — the main orchestrator for processing a single issue.
 *
 * Flow:
 * 1. Read repository from issue custom field
 * 2. Build TaskContext (fetch relevant files from SCM)
 * 3. Send to AI for analysis
 * 4. Execute commands in Docker
 * 5. Create branch + commit patches + open PR
 * 6. Report results to Jira
 */

import type { Config } from "../config.js";
import type { JiraClient } from "../jira/client.js";
import type { ScmProvider } from "../scm/index.js";
import type { AiProvider } from "../ai/index.js";
import type { JiraIssue, PipelineResult, AiAnalysis, ScmFile } from "../types.js";
import { Executor } from "../executor/index.js";
import { StateStore } from "../state/store.js";
import { buildTaskContext } from "./context.js";
import { formatJiraReport } from "./reporter.js";
import { createLogger, withTiming } from "../logger.js";

const log = createLogger("pipeline");

export class PipelineHandler {
    private executor: Executor;

    constructor(
        private config: Config,
        private jira: JiraClient,
        private scm: ScmProvider,
        private ai: AiProvider,
        private state: StateStore,
    ) {
        this.executor = new Executor(config);
    }

    /** Check if executor Docker is available */
    async isReady(): Promise<boolean> {
        return this.executor.isReady();
    }

    /** Process a single issue through the full pipeline */
    async handle(issue: JiraIssue): Promise<PipelineResult> {
        const startTime = performance.now();
        const state = this.state.get(issue.key);
        const attempt = (state?.attemptCount ?? 0) + 1;
        const maxAttempts = this.config.maxAttempts;

        // Check state for idempotency
        if (!this.state.shouldProcess(issue.key)) {
            log.info(`${issue.key} skipping (already processed or locked)`);
            return {
                issueKey: issue.key,
                success: true,
                analysis: null,
                execution: null,
                prUrl: null,
                error: "Skipped (already processed)",
                duration_ms: 0,
            };
        }

        // Acquire lock
        if (!this.state.lock(issue.key)) {
            log.warn(`${issue.key} could not acquire lock`);
            return {
                issueKey: issue.key,
                success: false,
                analysis: null,
                execution: null,
                prUrl: null,
                error: "Could not acquire lock",
                duration_ms: 0,
            };
        }

        log.info(`📋 Processing ${issue.key}: "${issue.summary}" (attempt ${attempt}/${maxAttempts})`, { issueKey: issue.key, step: "start" });

        try {
            // ── Step 1: Repository ──────────────────────────────────
            const repo = await this.jira.getRepositoryField(issue.key);
            if (!repo) {
                throw new Error("No repository found on issue. Set the Repository custom field.");
            }
            issue.repository = repo;
            log.info(`📦 Repository: ${repo}`, { issueKey: issue.key, step: "repo" });

            // If approval required, write plan to Jira and wait
            if (this.config.requireApproval) {
                await this.jira.addComment(
                    issue.key,
                    `🤖 *AI Cyber Bot* has picked up this issue.\n\nRepository: \`${repo}\`\n\nAnalysis will begin shortly. I'll post my plan for review before making changes.`,
                );
            }

            // ── Step 2: Context ──────────────────────────────────
            log.info(`🔍 Fetching source code...`, { issueKey: issue.key, step: "context" });
            const { result: context, duration_ms: contextMs } = await withTiming(() =>
                buildTaskContext(issue, this.scm, repo),
            );
            log.timed("info", `✅ Context: ${context.sourceFiles.length} source + ${context.testFiles.length} test files (${(contextMs / 1000).toFixed(1)}s)`, contextMs, {
                issueKey: issue.key,
                step: "context",
                source: context.sourceFiles.length,
                tests: context.testFiles.length,
            });

            // ── Step 3: AI Analysis ─────────────────────────────────
            log.info(`🤖 AI analyzing code...`, { issueKey: issue.key, step: "ai" });
            const { result: analysis, duration_ms: aiMs } = await withTiming(() =>
                this.ai.analyze(context),
            );
            log.timed("info", `✅ AI: ${analysis.patches.length} file(s), ${analysis.commands.length} command(s) (${(aiMs / 1000).toFixed(1)}s)`, aiMs, {
                issueKey: issue.key,
                step: "ai",
                patches: analysis.patches.length,
                commands: analysis.commands.length,
            });

            // If approval required, post plan and pause
            if (this.config.requireApproval) {
                await this.jira.addComment(
                    issue.key,
                    `🤖 *AI Analysis Plan*\n\n*Summary:* ${analysis.summary}\n\n*Plan:*\n${analysis.plan}\n\n*Patches:* ${analysis.patches.length} file(s)\n*Commands:* ${analysis.commands.join(", ")}\n\n⏳ Waiting for approval. Transition this issue to continue.`,
                );
                this.state.markApprovalPending(issue.key);
                return {
                    issueKey: issue.key,
                    success: true,
                    analysis,
                    execution: null,
                    prUrl: null,
                    error: null,
                    duration_ms: Math.round(performance.now() - startTime),
                };
            }

            // ── Step 4: Docker Execution ────────────────────────────
            // Check for per-task overrides
            const issueExecMode = extractExecutionModeFromDescription(issue.description);

            // Base URL priority: Jira custom field > description > .env > README
            const issueBaseUrl = await this.jira.getBaseUrlField(issue.key, issue.description);

            // Priority: description override > base_url implies remote > global config
            let effectiveMode: "remote" | "sandbox";
            if (issueExecMode) {
                effectiveMode = issueExecMode;
            } else if (issueBaseUrl) {
                effectiveMode = "remote";
            } else {
                effectiveMode = this.config.executionMode;
            }

            // Base URL priority: Jira (custom field or description) > .env > README fallback
            let effectiveBaseUrl = issueBaseUrl ?? this.config.apiBaseUrl ?? undefined;
            let baseUrlSource = issueBaseUrl ? "jira" : this.config.apiBaseUrl ? "env" : undefined;

            if (!effectiveBaseUrl && effectiveMode === "remote") {
                const readmeUrl = extractBaseUrlFromReadme(context.sourceFiles);
                if (readmeUrl) {
                    effectiveBaseUrl = readmeUrl;
                    baseUrlSource = "readme";
                    log.info(`🔍 API_BASE_URL detected from README: ${readmeUrl}`, { issueKey: issue.key, step: "exec" });
                }
            }

            if (effectiveMode === "remote" && effectiveBaseUrl) {
                log.info(`🌐 Remote mode: testing against ${effectiveBaseUrl} (source: ${baseUrlSource})`, { issueKey: issue.key, step: "exec" });
            } else if (effectiveMode === "remote" && !effectiveBaseUrl) {
                log.warn(`🌐 Remote mode but no API_BASE_URL — tests will use localhost fallback. Set API_BASE_URL in .env or add "base_url: https://..." to the Jira description.`, { issueKey: issue.key, step: "exec" });
            } else if (effectiveMode === "sandbox") {
                log.info(`📦 Sandbox mode: starting backend in Docker`, { issueKey: issue.key, step: "exec" });
            }

            // Read credentials from Jira custom field — only needed in remote mode
            // Sandbox mode handles auth internally (register/login flow)
            const taskCredentials = effectiveMode === "remote"
                ? await this.jira.getCredentialsField(issue.key)
                : {};

            log.info(`🐳 Running tests in Docker...`, { issueKey: issue.key, step: "exec" });
            const repoUrl = this.buildCloneUrl(repo);
            let { result: execution, duration_ms: execMs } = await withTiming(() =>
                this.executor.execute(analysis, repoUrl, context.repo.defaultBranch, {
                    executionMode: effectiveMode,
                    apiBaseUrl: effectiveBaseUrl,
                    credentials: taskCredentials,
                })
            );

            // Test-level retry: if tests failed due to network issues, retry once
            if (!execution.success && isNetworkError(execution.stdout + execution.stderr)) {
                log.info(`🔄 Network error detected, retrying tests...`, { issueKey: issue.key, step: "exec" });
                const retry = await withTiming(() =>
                    this.executor.execute(analysis, repoUrl, context.repo.defaultBranch, {
                        executionMode: effectiveMode,
                        apiBaseUrl: effectiveBaseUrl,
                        credentials: taskCredentials,
                    })
                );
                execution = retry.result;
                execMs += retry.duration_ms;
            }
            
            if (execution.success) {
                log.timed("info", `✅ Tests passed (${(execMs / 1000).toFixed(1)}s)`, execMs, {
                    issueKey: issue.key,
                    step: "exec",
                    exitCode: execution.exitCode,
                    success: true
                });
            } else {
                log.timed("warn", `❌ Tests failed — exit ${execution.exitCode} (${(execMs / 1000).toFixed(1)}s)`, execMs, {
                    issueKey: issue.key,
                    step: "exec",
                    exitCode: execution.exitCode,
                    success: false
                });
            }

            // ── Step 5: PR Creation ─────────────────────────────────
            // Always create PR if there are patches — even if some tests failed.
            // The test results are visible in the PR and Jira comment.
            // This lets reviewers see the generated tests and fix minor issues.
            let prUrl: string | null = null;

            const combinedPatches = [
                ...analysis.patches,
                ...(execution.patches || [])
            ];

            if (combinedPatches.length > 0) {
                log.info(`🔀 Creating PR...`, { issueKey: issue.key, step: "pr" });
                try {
                    const { result, duration_ms: prMs } = await withTiming(() =>
                        this.createBranchAndPr(issue, repo, analysis, combinedPatches, context.repo.defaultBranch)
                    );
                    prUrl = result;
                    log.timed("info", `✅ PR: ${prUrl} (${(prMs / 1000).toFixed(1)}s)`, prMs, { issueKey: issue.key, step: "pr", prUrl });
                } catch (prErr) {
                    log.error(`PR creation failed: ${String(prErr)}`);
                    // Don't fail the whole pipeline just because PR creation failed
                }
            }

            // ── Step 6: Report to Jira ──────────────────────────────
            const pipelineResult: PipelineResult = {
                issueKey: issue.key,
                success: execution.success,
                analysis,
                execution,
                prUrl,
                error: execution.success ? null : `Exit code: ${execution.exitCode}`,
                duration_ms: Math.round(performance.now() - startTime),
            };

            const report = formatJiraReport(pipelineResult, {
                apiBaseUrl: effectiveBaseUrl,
                baseUrlSource: baseUrlSource,
            });
            await this.jira.addComment(issue.key, report);

            // Update state
            // If PR was created, mark as success even if some tests failed.
            // The test results are in the PR and Jira comment for review.
            if (prUrl || execution.success) {
                this.state.markSuccess(issue.key, prUrl ?? undefined);
                const totalSec = Math.round(pipelineResult.duration_ms / 1000);
                const statusEmoji = execution.success ? "🎉" : "⚠️";
                log.info(`${statusEmoji} ${issue.key} done — ${totalSec}s total${prUrl ? ` → ${prUrl}` : ''}`, { issueKey: issue.key, duration_ms: pipelineResult.duration_ms });
            } else {
                this.handleFailureState(issue.key, `Exit code: ${execution.exitCode}`);
            }

            return pipelineResult;
        } catch (e: unknown) {
            const norm = log.normalizedError(e, { issueKey: issue.key, step: "pipeline" });
            const errMsg = norm.message;
            const duration = Math.round(performance.now() - startTime);

            if (norm.prExistsFlag) {
                // If PR already exists, mark as done/skipped to avoid infinite loop
                this.state.markSuccess(issue.key, undefined); // Or use a special skipped state if supported
                this.jira.addComment(
                    issue.key,
                    `🤖 ⚠️ *AI Cyber Bot* encountered an issue: ${errMsg}.\n\n*Action needed:* ${norm.actionHint}`
                ).catch((err) => log.error(`Failed to add PR exists comment: ${String(err)}`));
                log.info(`${issue.key} finished (pr already exists)`, { issueKey: issue.key, duration_ms: duration });
            } else {
                this.handleFailureState(issue.key, errMsg);
            }

            return {
                issueKey: issue.key,
                success: false,
                analysis: null,
                execution: null,
                prUrl: null,
                error: errMsg,
                duration_ms: duration,
            };
        }
    }

    /** Handle failure state: track attempts, apply backoff, post to Jira */
    private handleFailureState(issueKey: string, errorMessage: string): void {
        const state = this.state.get(issueKey);
        const attempts = (state?.attemptCount ?? 0);
        const maxAttempts = this.config.maxAttempts;

        if (attempts >= maxAttempts) {
            log.warn(`[${issueKey}] Reached max attempts (${attempts}/${maxAttempts}). Marking permanently failed.`);
            this.state.update(issueKey, "permanently_failed", { errorMessage });

            // Apply 'ai-failed' label to issue
            this.jira.updateIssue(issueKey, {
                labels: ["ai-failed"]
            }).catch(e => log.error(`Failed to add ai-failed label to ${issueKey}: ${String(e)}`));

            this.jira.addComment(
                issueKey,
                `🤖 ❌ *AI Cyber Bot* has exhausted all retries (${attempts}/${maxAttempts}).\n\n*Last Error:* ${errorMessage}\n\nThe issue has been marked with the \`ai-failed\` label and I will no longer process it automatically.`
            ).catch(e => log.error(`Failed to post final failure comment: ${String(e)}`));

        } else {
            // Apply exponential backoff
            let cooldownMins = 1;
            if (attempts === 2) cooldownMins = 5;
            if (attempts >= 3) cooldownMins = 30;

            const nextRetry = new Date(Date.now() + cooldownMins * 60 * 1000).toISOString();
            log.info(`[${issueKey}] Failure attempt ${attempts}/${maxAttempts}. Next retry at ${nextRetry}`);

            this.state.update(issueKey, "failed", {
                errorMessage,
                nextRetryAt: nextRetry
            });

            this.jira.addComment(
                issueKey,
                `🤖 ⚠️ *AI Cyber Bot* encountered an error (Attempt ${attempts}/${maxAttempts}).\n\n*Error:* ${errorMessage}\n\nI will retry this issue automatically in ~${cooldownMins} minute(s).`
            ).catch(e => log.error(`Failed to post failure comment: ${String(e)}`));
        }
    }

    /** Create a branch, commit patches, and open a PR */
    private async createBranchAndPr(
        issue: JiraIssue,
        repo: string,
        analysis: AiAnalysis,
        patches: import("../types.js").AiPatch[],
        defaultBranch: string,
    ): Promise<string> {
        const branchName = `ai/${issue.key.toLowerCase()}-${slugify(issue.summary)}`;

        try {
            // Create branch — if it already exists (e.g. from a previous attempt), continue with it
            try {
                await this.scm.createBranch(repo, branchName, defaultBranch);
            } catch (branchErr: unknown) {
                const msg = String(branchErr);
                if (msg.includes("already exists") || msg.includes("Reference already exists") || msg.includes("422")) {
                    log.warn(`Branch ${branchName} already exists, reusing it`);
                } else {
                    throw branchErr;
                }
            }

            // Commit patches
            for (const patch of patches) {
                if (patch.action === "delete") continue;
                await this.scm.writeFile(
                    repo,
                    patch.path,
                    patch.content,
                    `[${issue.key}] ${patch.action}: ${patch.path}`,
                    branchName,
                );
            }

            // Create PR — if it already exists, try to find the existing one
            const prTitle = `[${issue.key}] ${issue.summary}`;
            const prBody = formatPrBody(issue, analysis, patches);

            try {
                const prUrl = await this.scm.createPullRequest(
                    repo,
                    prTitle,
                    prBody,
                    branchName,
                    defaultBranch,
                );

                log.debug(`PR created: ${prUrl}`);
                return prUrl;
            } catch (prErr: unknown) {
                const prMsg = String(prErr);
                if (prMsg.includes("already exists") || prMsg.includes("A pull request already exists") || prMsg.includes("422")) {
                    log.warn(`PR already exists for branch ${branchName}, returning branch URL as fallback`);
                    // Return a useful URL even if we can't get the exact PR URL
                    const [owner, repoName] = repo.split("/");
                    return `https://github.com/${owner}/${repoName}/compare/${defaultBranch}...${branchName}`;
                }
                throw prErr;
            }
        } catch (e: unknown) {
            log.error(`Failed to create PR: ${String(e)}`);
            throw e;
        }
    }

    /** Build clone URL for the repository */
    private buildCloneUrl(repo: string): string {
        // If repo is already a full URL, return it as-is
        if (repo.startsWith('https://') || repo.startsWith('http://')) {
            return repo;
        }
        
        // Build URL based on SCM provider
        switch (this.config.scmProvider) {
            case "github":
                return `https://github.com/${repo}.git`;
            case "gitlab":
                return `${this.config.gitlabUrl}/${repo}.git`;
            case "bitbucket":
                return `https://bitbucket.org/${repo}.git`;
            default:
                return `https://github.com/${repo}.git`;
        }
    }
}

/** Convert a string to URL-safe slug */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
}

/** Extract execution_mode from Jira issue description for per-task override */
function extractExecutionModeFromDescription(description: string): "remote" | "sandbox" | undefined {
    if (!description) return undefined;

    const pattern = /execution[_\s-]?mode\s*[:=]\s*(remote|sandbox)/i;
    const match = description.match(pattern);
    if (match?.[1]) {
        return match[1].toLowerCase() as "remote" | "sandbox";
    }

    return undefined;
}

/**
 * Extract a live API base URL from the repo's README file.
 * Looks for common patterns like "https://f1api.dev", "https://api.example.com"
 * but ignores GitHub/GitLab/npm/docs URLs.
 */
function extractBaseUrlFromReadme(sourceFiles: ScmFile[]): string | undefined {
    const readme = sourceFiles.find(f =>
        f.path.toLowerCase() === "readme.md" || f.path.toLowerCase() === "readme"
    );
    if (!readme) return undefined;

    const content = readme.content;

    // Hosts to ignore — these are not API base URLs
    const ignoredHosts = [
        "github.com", "gitlab.com", "bitbucket.org",
        "npmjs.com", "npmjs.org", "npm.im",
        "shields.io", "badge", "img.shields",
        "docs.github", "raw.githubusercontent",
        "twitter.com", "x.com", "linkedin.com",
        "discord.gg", "discord.com",
        "youtube.com", "youtu.be",
        "wikipedia.org",
        "localhost", "127.0.0.1",
        "example.com", "example.org",
        "gofastmcp.com", "fastmcp.cloud",
        "astral.sh", "pydantic.dev",
        "errors.pydantic.dev",
    ];

    // Patterns that indicate an API base URL in README context
    // e.g. "API URL: https://f1api.dev" or "Base URL: https://api.example.com"
    // or just a prominent https URL that looks like an API domain
    const explicitPatterns = [
        /(?:api[_\s-]?(?:url|base|endpoint)|base[_\s-]?url|live[_\s-]?(?:url|api|demo))\s*[:=]\s*(https:\/\/[^\s\n)>\]"']+)/gi,
        /(?:available\s+at|hosted\s+at|deployed\s+at|running\s+at|accessible\s+at)\s+(https:\/\/[^\s\n)>\]"']+)/gi,
    ];

    for (const pattern of explicitPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const url = match[1]?.trim().replace(/\/+$/, "");
            if (url && !ignoredHosts.some(h => url.includes(h))) {
                return url;
            }
        }
    }

    // Fallback: look for a prominent domain that appears as a project URL
    // e.g. "f1api.dev" or "https://f1api.dev" used as the project's own domain
    const domainPattern = /https:\/\/([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)\b/gi;
    const domainCounts = new Map<string, { url: string; count: number }>();

    let domainMatch;
    while ((domainMatch = domainPattern.exec(content)) !== null) {
        const fullUrl = domainMatch[0].replace(/\/+$/, "");
        const host = domainMatch[1]!.toLowerCase();
        if (ignoredHosts.some(h => host.includes(h) || h.includes(host))) continue;
        // Skip image/asset URLs
        if (fullUrl.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js)$/i)) continue;

        const existing = domainCounts.get(host);
        if (existing) {
            existing.count++;
        } else {
            domainCounts.set(host, { url: fullUrl, count: 1 });
        }
    }

    // Pick the most frequently mentioned non-ignored domain
    if (domainCounts.size > 0) {
        const sorted = [...domainCounts.entries()].sort((a, b) => b[1].count - a[1].count);
        const best = sorted[0];
        if (best && best[1].count >= 2) {
            // Strip path — return just the base domain
            try {
                const parsed = new URL(best[1].url);
                return `${parsed.protocol}//${parsed.host}`;
            } catch {
                return best[1].url;
            }
        }
    }

    return undefined;
}

/** Check if test output contains network-related errors worth retrying */
function isNetworkError(output: string): boolean {
    const lower = output.toLowerCase();
    return (
        lower.includes("connection refused") ||
        lower.includes("econnrefused") ||
        lower.includes("econnreset") ||
        lower.includes("etimedout") ||
        lower.includes("enotfound") ||
        lower.includes("name or service not known") ||
        lower.includes("network is unreachable") ||
        lower.includes("socket.gaierror")
    );
}

/**
 * Format a clean, readable PR body from analysis results.
 * Strips diff artifacts, code blocks, and other noise from AI output.
 */
function formatPrBody(
    issue: JiraIssue,
    analysis: AiAnalysis,
    patches: import("../types.js").AiPatch[],
): string {
    const lines: string[] = [];

    lines.push(`## ${issue.key}: ${issue.summary}`);
    lines.push("");

    // Summary — clean it up
    const summary = sanitizePlanText(analysis.summary);
    if (summary) {
        lines.push(`### Summary`);
        lines.push(summary);
        lines.push("");
    }

    // Test plan — only if it's meaningful after cleaning
    const plan = sanitizePlanText(analysis.plan);
    if (plan && plan.length > 20) {
        lines.push(`### Test Plan`);
        lines.push(plan);
        lines.push("");
    }

    // Files changed — deduplicate by path
    if (patches.length > 0) {
        const seen = new Set<string>();
        const uniquePatches = patches.filter(p => {
            if (seen.has(p.path)) return false;
            seen.add(p.path);
            return true;
        });

        lines.push(`### Files`);
        lines.push("");
        for (const p of uniquePatches) {
            const icon = p.action === "create" ? "🆕" : p.action === "delete" ? "🗑️" : "✏️";
            lines.push(`- ${icon} \`${p.path}\``);
        }
        lines.push("");
    }

    // Commands
    if (analysis.commands.length > 0) {
        lines.push(`### Commands`);
        lines.push("");
        lines.push("```");
        for (const cmd of analysis.commands) {
            lines.push(cmd);
        }
        lines.push("```");
        lines.push("");
    }

    lines.push("---");
    lines.push("*This PR was created automatically by AI Cyber Bot.*");

    return lines.join("\n");
}

/**
 * Remove diff artifacts, code blocks, SEARCH/REPLACE markers, and other
 * noise from AI-generated plan/summary text so it reads cleanly in PRs and Jira.
 */
function sanitizePlanText(text: string): string {
    if (!text) return "";

    const lines = text.split(/\r?\n/);
    const clean: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Track fenced code blocks
        if (trimmed.startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        // Skip empty lines
        if (trimmed === "") continue;

        // Skip diff markers
        if (trimmed.startsWith("<<<<<<")) continue;
        if (trimmed.startsWith("======")) continue;
        if (trimmed.startsWith(">>>>>>")) continue;
        if (trimmed.startsWith("@@")) continue;
        if (/^[+-][^+-]/.test(trimmed)) continue;
        if (trimmed === "SEARCH" || trimmed === "REPLACE") continue;

        // Skip "cmd.exe?" artifacts
        if (trimmed.includes("cmd.exe?")) continue;
        // Skip bare file path headers from diffs
        if (/^[a-zA-Z0-9_/.-]+\.(py|js|ts|json|md|yaml|yml)$/.test(trimmed)) continue;

        // Skip aider session noise
        if (/^Tokens:\s/.test(trimmed)) continue;
        if (/^Applied edit to\s/.test(trimmed)) continue;
        if (/^python\s+[\w./-]+\.py$/.test(trimmed)) continue;

        // Skip filler phrases
        if (/^Here is the (?:complete )?implementation/i.test(trimmed)) continue;
        if (/^You can run the test suite/i.test(trimmed)) continue;
        if (/^Let'?s create the/i.test(trimmed)) continue;

        clean.push(line);
    }

    return clean.join("\n").trim();
}
