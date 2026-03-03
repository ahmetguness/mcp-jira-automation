/**
 * MCP Manager — manages lifecycle of all MCP connections.
 */

import type { Config } from "../config.js";
import { createLogger } from "../logger.js";
import { connectJiraMcp, connectScmMcp, type McpConnection } from "./spawn.js";
import { extractMcpToolResultText } from "../validation/mcp.js";

const log = createLogger("mcp:manager");

/**
 * Unwraps common MCP tool return shapes into a usable JS value.
 * Handles:
 * - structuredContent.result
 * - content[0].text as JSON (or plain text)
 * - raw JSON string
 */
function unwrapMcpResult(raw: unknown): unknown {
    // Case 1: Raw is already an object we can inspect
    if (raw && typeof raw === "object") {
        const anyRaw = raw as any;

        const structured = anyRaw.structuredContent?.result;
        if (structured !== undefined) return structured;

        const text = anyRaw.content?.[0]?.text;
        if (typeof text === "string") {
            const trimmed = text.trim();

            // Try JSON parse if it looks like JSON
            if (
                (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                (trimmed.startsWith("[") && trimmed.endsWith("]"))
            ) {
                try {
                    return JSON.parse(trimmed);
                } catch {
                    // fallthrough to return plain text
                }
            }

            return trimmed;
        }
    }

    // Case 2: Raw is a string (sometimes already JSON)
    if (typeof raw === "string") {
        const trimmed = raw.trim();

        if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
            try {
                return JSON.parse(trimmed);
            } catch {
                return trimmed;
            }
        }

        return trimmed;
    }

    return raw;
}

export class McpManager {
    private jira: McpConnection | null = null;
    private scm: McpConnection | null = null;

    constructor(private config: Config) { }

    /** Initialize all MCP connections */
    async connect(): Promise<void> {
        log.info("Initializing MCP connections...");

        this.jira = await connectJiraMcp(this.config);

        const { tools: jiraTools } = await this.jira.client.listTools();
        log.info(`mcp-atlassian provides ${jiraTools.length} tools`);

        this.scm = await connectScmMcp(this.config);

        const { tools: scmTools } = await this.scm.client.listTools();
        log.info(`${this.scm.name} provides ${scmTools.length} tools`);
    }

    /** Get Jira MCP client */
    getJiraClient(): McpConnection {
        if (!this.jira) throw new Error("Jira MCP not connected. Call connect() first.");
        return this.jira;
    }

    /** Get SCM MCP client */
    getScmClient(): McpConnection {
        if (!this.scm) throw new Error("SCM MCP not connected. Call connect() first.");
        return this.scm;
    }

    /** Call a tool on a specific MCP server */
    async callTool(connection: McpConnection, name: string, args: Record<string, unknown>): Promise<unknown> {
        log.debug(`Calling ${connection.name}/${name}`, args);

        const result = await connection.client.callTool({ name, arguments: args });

        // Extract text content safely via Zod validator (may be string or structured)
        const extracted = extractMcpToolResultText(result);

        // Normalize to a JS value:
        // - If extracted is a JSON string, parse it
        // - If it's already structured, keep it
        // - If it's plain text, return it
        return unwrapMcpResult(extracted);
    }

    /** Call a Jira tool */
    async callJiraTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return this.callTool(this.getJiraClient(), name, args);
    }

    /** Call an SCM tool */
    async callScmTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return this.callTool(this.getScmClient(), name, args);
    }

    /** Gracefully close all connections */
    async close(): Promise<void> {
        log.info("Closing MCP connections...");
        const tasks: Promise<void>[] = [];

        if (this.jira) {
            tasks.push(this.jira.client.close().catch((e) => log.warn(`Error closing Jira MCP: ${String(e)}`)));
            this.jira = null;
        }
        if (this.scm) {
            tasks.push(this.scm.client.close().catch((e) => log.warn(`Error closing SCM MCP: ${String(e)}`)));
            this.scm = null;
        }

        await Promise.all(tasks);
        log.info("All MCP connections closed");
    }
}