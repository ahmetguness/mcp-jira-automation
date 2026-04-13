/**
 * Jira polling listener — periodically checks for new issues assigned to the AI bot.
 */

import type { Config } from "../config.js";
import type { JiraClient } from "./client.js";
import type { JiraIssue } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("jira:poller");

export type IssueHandler = (issue: JiraIssue) => Promise<void>;

export class JiraPoller {
    private running = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private consecutiveFailures = 0;
    private readonly maxBackoffMs = 5 * 60 * 1000; // 5 minutes max

    constructor(
        private jiraClient: JiraClient,
        private config: Config,
    ) { }

    /** Start polling loop */
    start(handler: IssueHandler): void {
        if (this.running) return;
        this.running = true;
        log.info(`Polling started (interval: ${this.config.pollIntervalMs}ms)`);
        void this.poll(handler);
    }

    /** Stop polling */
    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        log.info("Polling stopped");
    }

    /** Calculate next poll delay with exponential backoff on failures */
    private getNextDelay(): number {
        if (this.consecutiveFailures === 0) return this.config.pollIntervalMs;
        const backoff = Math.min(
            this.config.pollIntervalMs * Math.pow(2, this.consecutiveFailures),
            this.maxBackoffMs,
        );
        return backoff;
    }

    private async poll(handler: IssueHandler): Promise<void> {
        if (!this.running) return;

        try {
            log.debug("Polling for new issues...");
            const issues = await this.jiraClient.fetchBotIssues();
            if (issues.length > 0) {
                log.info(`Found ${issues.length} issue(s) in bot queue`);
            }

            // Reset backoff on success
            if (this.consecutiveFailures > 0) {
                log.info(`Jira connection restored after ${this.consecutiveFailures} failure(s)`);
            }
            this.consecutiveFailures = 0;

            for (const issue of issues) {
                if (!this.running) break;
                try {
                    await handler(issue);
                } catch (e) {
                    log.error(`Failed to handle issue ${issue.key}: ${String(e)}`);
                }
            }
        } catch (e) {
            this.consecutiveFailures++;
            const nextDelay = this.getNextDelay();
            log.error(`Jira poll failed (${this.consecutiveFailures} consecutive): ${String(e)}. Next retry in ${Math.round(nextDelay / 1000)}s`);
        }

        if (this.running) {
            const delay = this.getNextDelay();
            this.timer = setTimeout(() => void this.poll(handler), delay);
        }
    }
}
