/**
 * Spawn MCP servers as child processes with stdio transport.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("mcp:spawn");

export interface McpConnection {
    client: Client;
    transport: SSEClientTransport | StdioClientTransport;
    name: string;
}

/** Connect to mcp-atlassian via SSE (already running externally) */
export async function connectJiraMcp(config: Config): Promise<McpConnection> {
    log.info(`Connecting to mcp-atlassian at ${config.mcpAtlassianUrl}`);
    const transport = new SSEClientTransport(new URL(config.mcpAtlassianUrl));
    const client = new Client({ name: "mcp-jira-automation", version: "1.0.0" });
    await client.connect(transport);
    log.info("Connected to mcp-atlassian ✅");
    return { client, transport, name: "mcp-atlassian" };
}

/** Spawn SCM MCP server as a child process via stdio */
export async function connectScmMcp(config: Config): Promise<McpConnection> {
    const { command, args, env, name } = getScmSpawnConfig(config);
    log.info(`Spawning SCM MCP server: ${name} (${command} ${args.join(" ")})`);

    const transport = new StdioClientTransport({
        command,
        args,
        env: { ...process.env as Record<string, string>, ...env },
    });

    const client = new Client({ name: "mcp-jira-automation", version: "1.0.0" });
    await client.connect(transport);
    log.info(`Connected to ${name} ✅`);
    return { client, transport, name };
}

interface SpawnConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
    name: string;
}

function getScmSpawnConfig(config: Config): SpawnConfig {
    switch (config.scmProvider) {
        case "github":
            if (!config.githubToken) throw new Error("GITHUB_TOKEN is required when SCM_PROVIDER=github");
            return {
                command: "docker",
                args: [
                    "run", "--rm", "-i",
                    "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
                    "ghcr.io/github/github-mcp-server",
                ],
                env: { GITHUB_PERSONAL_ACCESS_TOKEN: config.githubToken },
                name: "github-mcp-server",
            };

        case "gitlab":
            if (!config.gitlabToken) throw new Error("GITLAB_TOKEN is required when SCM_PROVIDER=gitlab");
            return {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-gitlab"],
                env: {
                    GITLAB_PERSONAL_ACCESS_TOKEN: config.gitlabToken,
                    GITLAB_API_URL: `${config.gitlabUrl}/api/v4`,
                },
                name: "gitlab-mcp-server",
            };

        case "bitbucket":
            if (!config.bitbucketUsername || !config.bitbucketAppPassword) {
                throw new Error("BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD are required when SCM_PROVIDER=bitbucket");
            }
            return {
                command: "uvx",
                args: ["mcp-bitbucket"],
                env: {
                    BITBUCKET_USERNAME: config.bitbucketUsername,
                    BITBUCKET_APP_PASSWORD: config.bitbucketAppPassword,
                    ...(config.bitbucketWorkspace ? { BITBUCKET_WORKSPACE: config.bitbucketWorkspace } : {}),
                },
                name: "mcp-bitbucket",
            };

        default:
            throw new Error(`Unsupported SCM Provider: ${String(config.scmProvider)}`);
    }
}
