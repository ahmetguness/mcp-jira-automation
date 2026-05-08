/**
 * Jira webhook listener — optional HTTP server to receive Jira webhooks.
 * Only active when MODE=webhook in .env
 *
 * Security:
 * - HMAC-SHA256 signature verification (when WEBHOOK_SECRET is configured)
 * - Request body size limit (1 MB) to prevent memory exhaustion
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import type { Config } from "../config.js";
import type { JiraClient } from "./client.js";
import type { JiraIssue } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("jira:webhook");

/** Maximum request body size in bytes (1 MB) */
const MAX_BODY_SIZE = 1024 * 1024;

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
            if (!this.config.webhookSecret) {
                log.warn("WEBHOOK_SECRET is not set — webhook signature verification is disabled. Set WEBHOOK_SECRET in .env for production use.");
            }
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

            // Verify HMAC signature if secret is configured
            if (this.config.webhookSecret) {
                const signature = req.headers["x-hub-signature"] as string | undefined
                    ?? req.headers["x-atlassian-webhook-signature"] as string | undefined;

                if (!verifySignature(body, signature, this.config.webhookSecret)) {
                    log.warn("Webhook signature verification failed — rejecting request");
                    res.writeHead(401);
                    res.end("Unauthorized");
                    return;
                }
            }

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
            log.error(`Failed to process webhook: ${String(e)}`);
            res.writeHead(500);
            res.end("Internal Server Error");
        }
    }
}

/**
 * Read request body with size limit to prevent memory exhaustion.
 * Rejects with an error if body exceeds MAX_BODY_SIZE.
 */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let totalSize = 0;

        req.on("data", (chunk: Buffer) => {
            totalSize += chunk.length;
            if (totalSize > MAX_BODY_SIZE) {
                req.destroy();
                reject(new Error(`Request body too large (>${MAX_BODY_SIZE} bytes)`));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
    });
}

/**
 * Verify HMAC-SHA256 signature of the webhook payload.
 * Supports both "sha256=<hex>" format and raw hex format.
 */
function verifySignature(body: string, signature: string | undefined, secret: string): boolean {
    if (!signature) {
        return false;
    }

    const expected = createHmac("sha256", secret).update(body).digest("hex");

    // Support "sha256=<hex>" prefix format (GitHub-style) and raw hex
    const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;

    // Constant-time comparison to prevent timing attacks
    if (expected.length !== provided.length) {
        return false;
    }

    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
        mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
    }
    return mismatch === 0;
}
