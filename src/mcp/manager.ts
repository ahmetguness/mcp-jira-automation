/**
 * MCP Manager — manages lifecycle of all MCP connections.
 */

import type { Config } from "../config.js";
import { createLogger } from "../logger.js";
import { connectJiraMcp, connectScmMcp, type McpConnection } from "./spawn.js";
import { extractMcpToolResultText } from "../validation/mcp.js";

const log = createLogger("mcp:manager");

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

        // Extract text content safely via Zod validator
        const text = extractMcpToolResultText(result);

        try {
            return JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
        } catch {
            return text;
        }
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
