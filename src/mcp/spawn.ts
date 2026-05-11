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
    const transport = new SSEClientTransport(new URL(config.mcpAtlassianUrl));
    const client = new Client({ name: "mcp-jira-automation", version: "1.0.0" });
    await client.connect(transport);
    log.info("mcp-atlassian connected ✅");
    return { client, transport, name: "mcp-atlassian" };
}

/** Spawn SCM MCP server as a child process via stdio */
export async function connectScmMcp(config: Config): Promise<McpConnection> {
    const { command, args, env, name } = getScmSpawnConfig(config);
    log.debug(`Spawning: ${name} (${command} ${redactArgs(args).join(" ")})`);

    const transport = new StdioClientTransport({
        command,
        args,
        env: { ...process.env as Record<string, string>, ...env },
        stderr: "pipe",
    });

    if (transport.stderr) {
        let stderrBuffer = "";
        transport.stderr.on("data", (chunk: unknown) => {
            const str = Buffer.isBuffer(chunk)
                ? chunk.toString("utf-8")
                : String(chunk);

            stderrBuffer += str;
            const lines = stderrBuffer.split("\n");
            stderrBuffer = lines.pop() || "";

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;

                // Only log errors/fatals from MCP server stderr; suppress info-level chatter
                if (line.toLowerCase().includes("error") || line.toLowerCase().includes("fatal")) {
                    log.error(line, { provider: name });
                }
                // All other MCP server internal logs are silently dropped
            }
        });
    }

    const client = new Client({ name: "mcp-jira-automation", version: "1.0.0" });
    await client.connect(transport);
    log.info(`${name} connected ✅`);
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
            if (config.executorBackend === "ssh") {
                return getRemoteGitHubMcpSpawnConfig(config);
            }
            return {
                command: "docker",
                args: [
                    "run", "--rm", "-i",
                    "--network", "host",
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
            if (config.bitbucketApiToken) {
                if (!config.bitbucketEmail) throw new Error("BITBUCKET_EMAIL is required with BITBUCKET_API_TOKEN when SCM_PROVIDER=bitbucket");
            } else if (!config.bitbucketUsername || !config.bitbucketAppPassword) {
                throw new Error("BITBUCKET_EMAIL and BITBUCKET_API_TOKEN are required when SCM_PROVIDER=bitbucket");
            }
            if (config.executorBackend === "ssh") {
                return getRemoteBitbucketMcpSpawnConfig(config);
            }
            return {
                command: "uvx",
                args: ["--from", "iflow-mcp-kallows-mcp-bitbucket", "iflow-mcp_kallows-mcp-bitbucket"],
                env: {
                    BITBUCKET_USERNAME: config.bitbucketUsername ?? config.bitbucketEmail ?? "",
                    BITBUCKET_APP_PASSWORD: config.bitbucketAppPassword ?? config.bitbucketApiToken ?? "",
                    ...(config.bitbucketWorkspace ? { BITBUCKET_WORKSPACE: config.bitbucketWorkspace } : {}),
                },
                name: "mcp-bitbucket",
            };

        default:
            throw new Error(`Unsupported SCM Provider: ${String(config.scmProvider)}`);
    }
}

function buildBaseSshArgs(config: Config): string[] {
    const sshArgs = [
        "-p", String(config.sshPort),
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", `ConnectTimeout=${Math.max(1, Math.ceil(config.sshConnectTimeoutMs / 1000))}`,
    ];
    if (config.sshPrivateKeyPath) sshArgs.push("-i", config.sshPrivateKeyPath);
    return sshArgs;
}

function getRemoteGitHubMcpSpawnConfig(config: Config): SpawnConfig {
    if (!config.sshHost || !config.sshUser) {
        throw new Error("SSH_HOST and SSH_USER are required for remote GitHub MCP when EXECUTOR_BACKEND=ssh");
    }

    const sshArgs = buildBaseSshArgs(config);

    const remoteCommand = [
        "env",
        `GITHUB_PERSONAL_ACCESS_TOKEN=${shq(config.githubToken!)}`,
        "docker", "run", "--rm", "-i",
        "--network", "host",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server",
    ].join(" ");

    return {
        command: "ssh",
        args: [
            ...sshArgs,
            `${config.sshUser}@${config.sshHost}`,
            remoteCommand,
        ],
        env: {},
        name: "github-mcp-server@ssh",
    };
}

function getRemoteBitbucketMcpSpawnConfig(config: Config): SpawnConfig {
    if (!config.sshHost || !config.sshUser) {
        throw new Error("SSH_HOST and SSH_USER are required for remote Bitbucket MCP when EXECUTOR_BACKEND=ssh");
    }

    const envParts = [
        `BITBUCKET_USERNAME=${shq(config.bitbucketUsername!)}`,
        `BITBUCKET_APP_PASSWORD=${shq(config.bitbucketAppPassword!)}`,
    ];
    if (config.bitbucketWorkspace) {
        envParts.push(`BITBUCKET_WORKSPACE=${shq(config.bitbucketWorkspace)}`);
    }

    return {
        command: "ssh",
        args: [
            ...buildBaseSshArgs(config),
            `${config.sshUser}@${config.sshHost}`,
            ["env", ...envParts, "sh", "-lc", shq("UVX=$(command -v uvx || printf '%s/.local/bin/uvx' \"$HOME\"); exec \"$UVX\" --from iflow-mcp-kallows-mcp-bitbucket iflow-mcp_kallows-mcp-bitbucket")].join(" "),
        ],
        env: {},
        name: "mcp-bitbucket@ssh",
    };
}

function shq(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function redactArgs(args: string[]): string[] {
    return args.map((arg) => arg
        .replace(/GITHUB_PERSONAL_ACCESS_TOKEN='[^']*'/g, "GITHUB_PERSONAL_ACCESS_TOKEN=<redacted>")
        .replace(/BITBUCKET_APP_PASSWORD='[^']*'/g, "BITBUCKET_APP_PASSWORD=<redacted>"));
}
