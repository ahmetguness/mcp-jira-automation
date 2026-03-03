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

    private async poll(handler: IssueHandler): Promise<void> {
        if (!this.running) return;

        try {
            log.debug("Polling for new issues...");
            const issues = await this.jiraClient.fetchBotIssues();
            log.info(`Found ${issues.length} issue(s) in bot queue`);

            for (const issue of issues) {
                if (!this.running) break;
                try {
                    await handler(issue);
                } catch (e) {
                    log.error(`Failed to handle issue ${issue.key}: ${String(e)}`);
                }
            }
        } catch (e) {
            log.error(`Jira poll failed: ${String(e)}`);
        }

        if (this.running) {
            this.timer = setTimeout(() => void this.poll(handler), this.config.pollIntervalMs);
        }
    }
}
