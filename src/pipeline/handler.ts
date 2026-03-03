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

        // Check state for idempotency
        if (!this.state.shouldProcess(issue.key)) {
            log.info(`Skipping ${issue.key} (already processed or locked)`);
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
            log.warn(`Could not lock ${issue.key}`);
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

        try {
            // Step 1: Get repository
            log.info(`[${issue.key}] Step 1: Reading repository field`);
            const repo = await this.jira.getRepositoryField(issue.key);
            if (!repo) {
                throw new Error("No repository found on issue. Set the Repository custom field.");
            }
            issue.repository = repo;
            log.info(`[${issue.key}] Repository: ${repo}`);

            // If approval required, write plan to Jira and wait
            if (this.config.requireApproval) {
                log.info(`[${issue.key}] REQUIRE_APPROVAL=true, waiting for approval`);
                await this.jira.addComment(
                    issue.key,
                    `🤖 *AI Cyber Bot* has picked up this issue.\n\nRepository: \`${repo}\`\n\nAnalysis will begin shortly. I'll post my plan for review before making changes.`,
                );
            }

            // Step 2: Build context
            log.info(`[${issue.key}] Step 2: Building task context`);
            const { result: context, duration_ms: contextMs } = await withTiming(() =>
                buildTaskContext(issue, this.scm, repo),
            );
            log.timed("info", `[${issue.key}] Context built`, contextMs, {
                sourceFiles: context.sourceFiles.length,
                testFiles: context.testFiles.length,
            });

            // Step 3: AI analysis
            log.info(`[${issue.key}] Step 3: AI analysis`);
            const { result: analysis, duration_ms: aiMs } = await withTiming(() =>
                this.ai.analyze(context),
            );
            log.timed("info", `[${issue.key}] AI analysis complete`, aiMs, {
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
            log.info(`[${issue.key}] Step 4: Executing in Docker`);
            const repoUrl = this.buildCloneUrl(repo);
            const execution = await this.executor.execute(analysis, repoUrl, context.repo.defaultBranch);

            // Step 5: Create branch + PR (only if there are patches)
            let prUrl: string | null = null;
            if (analysis.patches.length > 0) {
                log.info(`[${issue.key}] Step 5: Creating branch and PR`);
                prUrl = await this.createBranchAndPr(issue, repo, analysis, context.repo.defaultBranch);
            }

            // Step 6: Report to Jira
            log.info(`[${issue.key}] Step 6: Reporting to Jira`);
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
            } else {
                this.state.markFailed(issue.key, `Exit code: ${execution.exitCode}`);
            }

            log.info(`[${issue.key}] Pipeline complete (${pipelineResult.duration_ms}ms, success=${execution.success})`);
            return pipelineResult;
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`[${issue.key}] Pipeline failed: ${errMsg}`);

            this.state.markFailed(issue.key, errMsg);

            // Try to report failure to Jira
            try {
                await this.jira.addComment(
                    issue.key,
                    `🤖 ❌ *AI Cyber Bot* failed to process this issue.\n\n*Error:* ${errMsg}\n\nThe bot will retry on the next polling cycle.`,
                );
            } catch {
                log.error(`Could not report failure to Jira for ${issue.key}`);
            }

            return {
                issueKey: issue.key,
                success: false,
                analysis: null,
                execution: null,
                prUrl: null,
                error: errMsg,
                duration_ms: Math.round(performance.now() - startTime),
            };
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
