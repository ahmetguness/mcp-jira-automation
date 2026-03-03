/**
 * Jira webhook listener — optional HTTP server to receive Jira webhooks.
 * Only active when MODE=webhook in .env
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "../config.js";
import type { JiraClient } from "./client.js";
import type { JiraIssue } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("jira:webhook");

export type IssueHandler = (issue: JiraIssue) => Promise<void>;

export class JiraWebhook {
    private server: ReturnType<typeof createServer> | null = null;

    constructor(
        private jiraClient: JiraClient,
        private config: Config,
    ) { }

    /** Start webhook HTTP server */
    start(handler: IssueHandler): void {
        this.server = createServer((req, res) => void this.handleRequest(req, res, handler));

        this.server.listen(this.config.webhookPort, () => {
            log.info(`Webhook server listening on port ${this.config.webhookPort}`);
        });
    }

    /** Stop webhook server */
    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            log.info("Webhook server stopped");
        }
    }

    private async handleRequest(req: IncomingMessage, res: ServerResponse, handler: IssueHandler): Promise<void> {
        if (req.method !== "POST" || req.url !== "/webhook") {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        try {
            const body = await readBody(req);
            const payload = JSON.parse(body);

            // Jira webhook payload: https://developer.atlassian.com/cloud/jira/platform/webhooks/
            const issueKey = payload?.issue?.key;
            if (!issueKey) {
                res.writeHead(400);
                res.end("Missing issue key");
                return;
            }

            log.info(`Webhook received for issue ${issueKey}`);

            // Check if assignee matches the bot
            const assignee =
                payload?.issue?.fields?.assignee?.displayName ??
                payload?.issue?.fields?.assignee?.name;

            if (assignee !== this.config.jiraBotDisplayName) {
                log.debug(`Ignoring ${issueKey}: assigned to "${assignee}", not bot`);
                res.writeHead(200);
                res.end("OK (ignored)");
                return;
            }

            // Fetch the full issue via MCP for consistency
            const issue = await this.jiraClient.getIssue(issueKey);
            res.writeHead(200);
            res.end("OK");

            // Process async
            handler(issue).catch((e) => log.error(`Error handling webhook issue ${issueKey}: ${e}`));
        } catch (e) {
            log.error(`Webhook error: ${e}`);
            res.writeHead(500);
            res.end("Internal Server Error");
        }
    }
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
    });
}
