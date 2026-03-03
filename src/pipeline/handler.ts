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
import type { JiraIssue, PipelineResult, AiAnalysis } from "../types.js";
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

        log.info(`${issue.key} started (attempt ${attempt}/${maxAttempts})`, { issueKey: issue.key, step: "start" });

        try {
            // Step 1: Get repository
            const repo = await this.jira.getRepositoryField(issue.key);
            if (!repo) {
                throw new Error("No repository found on issue. Set the Repository custom field.");
            }
            issue.repository = repo;

            // If approval required, write plan to Jira and wait
            if (this.config.requireApproval) {
                await this.jira.addComment(
                    issue.key,
                    `🤖 *AI Cyber Bot* has picked up this issue.\n\nRepository: \`${repo}\`\n\nAnalysis will begin shortly. I'll post my plan for review before making changes.`,
                );
            }

            // Step 2: Build context
            const { result: context, duration_ms: contextMs } = await withTiming(() =>
                buildTaskContext(issue, this.scm, repo),
            );
            log.timed("info", `${issue.key} context built`, contextMs, {
                issueKey: issue.key,
                step: "context",
                source: context.sourceFiles.length,
                tests: context.testFiles.length,
            });

            // Step 3: AI analysis
            const { result: analysis, duration_ms: aiMs } = await withTiming(() =>
                this.ai.analyze(context),
            );
            log.timed("info", `${issue.key} ai analysis complete`, aiMs, {
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

            // Step 4: Execute in Docker
            const repoUrl = this.buildCloneUrl(repo);
            const { result: execution, duration_ms: execMs } = await withTiming(() =>
                this.executor.execute(analysis, repoUrl, context.repo.defaultBranch)
            );
            log.timed("info", `${issue.key} execution complete`, execMs, {
                issueKey: issue.key,
                step: "exec",
                exitCode: execution.exitCode,
                success: execution.success
            });

            // Step 5: Create branch + PR (only if execution succeeded and there are patches)
            let prUrl: string | null = null;
            if (execution.success && analysis.patches.length > 0) {
                const { result, duration_ms: prMs } = await withTiming(() =>
                    this.createBranchAndPr(issue, repo, analysis, context.repo.defaultBranch)
                );
                prUrl = result;
                log.timed("info", `${issue.key} pr created`, prMs, { issueKey: issue.key, step: "pr", prUrl });
            } else if (!execution.success) {
                log.warn(`${issue.key} skipping PR creation because execution failed (exit ${execution.exitCode})`, { issueKey: issue.key, step: "pr" });
            }

            // Step 6: Report to Jira
            const pipelineResult: PipelineResult = {
                issueKey: issue.key,
                success: execution.success,
                analysis,
                execution,
                prUrl,
                error: execution.success ? null : `Exit code: ${execution.exitCode}`,
                duration_ms: Math.round(performance.now() - startTime),
            };

            const report = formatJiraReport(pipelineResult);
            await this.jira.addComment(issue.key, report);

            // Update state
            if (execution.success) {
                this.state.markSuccess(issue.key, prUrl ?? undefined);
                log.info(`${issue.key} finished successfully`, { issueKey: issue.key, duration_ms: pipelineResult.duration_ms });
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
        defaultBranch: string,
    ): Promise<string> {
        const branchName = `ai/${issue.key.toLowerCase()}-${slugify(issue.summary)}`;

        try {
            // Create branch
            await this.scm.createBranch(repo, branchName, defaultBranch);

            // Commit patches
            for (const patch of analysis.patches) {
                if (patch.action === "delete") continue;
                await this.scm.writeFile(
                    repo,
                    patch.path,
                    patch.content,
                    `[${issue.key}] ${patch.action}: ${patch.path}`,
                    branchName,
                );
            }

            // Create PR
            const prTitle = `[${issue.key}] ${issue.summary}`;
            const prBody = `## Jira Issue: ${issue.key}\n\n${analysis.summary}\n\n### Changes\n${analysis.plan}\n\n---\n*This PR was created automatically by AI Cyber Bot.*`;

            const prUrl = await this.scm.createPullRequest(
                repo,
                prTitle,
                prBody,
                branchName,
                defaultBranch,
            );

            log.info(`PR created: ${prUrl}`);
            return prUrl;
        } catch (e: unknown) {
            log.error(`Failed to create PR: ${String(e)}`);
            throw e;
        }
    }

    /** Build clone URL for the repository */
    private buildCloneUrl(repo: string): string {
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
