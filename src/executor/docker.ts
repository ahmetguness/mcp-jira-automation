/**
 * Docker-based isolated executor.
 * Runs AI-generated commands inside a temporary container.
 */

import Docker from "dockerode";
import { createLogger, withTiming } from "../logger.js";
import type { Config } from "../config.js";

const log = createLogger("executor:docker");

interface DockerRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export class DockerExecutor {
    private docker: Docker;
    private image: string;
    private timeoutMs: number;

    constructor(config: Config) {
        this.docker = new Docker();
        this.image = config.dockerImage;
        this.timeoutMs = config.execTimeoutMs;
        log.info(`Docker executor initialized (image: ${this.image}, timeout: ${this.timeoutMs}ms)`);
    }

    /** Check if Docker is available */
    async checkConnection(): Promise<boolean> {
        try {
            await this.docker.ping();
            return true;
        } catch {
            log.error("Docker is not running or not accessible");
            return false;
        }
    }

    /**
     * Run commands in an isolated Docker container.
     *
     * Steps:
     * 1. Create temporary container with repo cloned
     * 2. Apply patches (write files)
     * 3. Run commands sequentially
     * 4. Collect output
     * 5. Remove container
     */
    async run(opts: {
        repoUrl: string;
        branch: string;
        commands: string[];
        patches?: { path: string; content: string }[];
    }): Promise<DockerRunResult> {
        const containerName = `mcp-jira-exec-${Date.now()}`;
        let container: Docker.Container | null = null;

        try {
            // Build the setup script: clone repo, apply patches, run commands
            const setupCommands: string[] = [
                "set -e",
                `git clone --depth 1 --branch ${opts.branch} ${opts.repoUrl} /workspace 2>&1 || git clone --depth 1 ${opts.repoUrl} /workspace 2>&1`,
                "cd /workspace",
            ];

            // Apply patches
            if (opts.patches?.length) {
                for (const patch of opts.patches) {
                    const dir = patch.path.split("/").slice(0, -1).join("/");
                    if (dir) {
                        setupCommands.push(`mkdir -p /workspace/${dir}`);
                    }
                    // Use heredoc for file content to handle special characters
                    const safeContent = patch.content.replace(/'/g, "'\\''");
                    setupCommands.push(
                        `cat > /workspace/${patch.path} << 'PATCH_EOF'\n${safeContent}\nPATCH_EOF`,
                    );
                }
            }

            // Add test commands
            for (const cmd of opts.commands) {
                setupCommands.push(`echo ">>> Running: ${cmd.replace(/"/g, '\\"')}"`);
                setupCommands.push(cmd);
            }

            const fullScript = setupCommands.join("\n");

            log.info(`Creating container ${containerName}`);

            container = await this.docker.createContainer({
                Image: this.image,
                name: containerName,
                Cmd: ["sh", "-lc", fullScript],
                WorkingDir: "/workspace",
                Tty: true,
                HostConfig: {
                    // Security: no network needed for tests in most cases
                    // But we need it for git clone and npm install
                    AutoRemove: false,
                    Memory: 512 * 1024 * 1024, // 512MB
                    MemorySwap: 1024 * 1024 * 1024, // 1GB
                    CpuPeriod: 100000,
                    CpuQuota: 100000, // 1 CPU
                },
                // Install git in the container if not present
                Env: [
                    "DEBIAN_FRONTEND=noninteractive",
                    "HOME=/root",
                ],
            });

            await container.start();
            log.info(`Container ${containerName} started`);

            // Wait for completion with timeout
            const { result: waitResult } = await withTiming(async () => {
                return Promise.race([
                    container!.wait() as Promise<{ StatusCode: number }>,
                    new Promise<{ StatusCode: number }>((_, reject) =>
                        setTimeout(() => reject(new Error("Container execution timed out")), this.timeoutMs),
                    ),
                ]);
            });

            // Collect logs
            const logStream = await container.logs({ stdout: true, stderr: true, follow: false });
            // Since Tty is true, stdout and stderr are not multiplexed
            const output = logStream.toString("utf-8");

            const exitCode = waitResult.StatusCode;
            log.info(`Container ${containerName} finished (exit: ${exitCode})`);

            if (exitCode !== 0) {
                log.error(`Docker execution failed (exit ${exitCode})`, { dockerOutput: output });
            }

            return {
                exitCode: exitCode,
                stdout: output.slice(0, 50000), // Limit output size
                stderr: "",
            };
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`Container execution failed: ${errMsg}`);

            // Try to kill the container if it timed out
            if (container) {
                try {
                    await container.kill();
                } catch {
                    // Container may already be stopped
                }
            }

            return {
                exitCode: 1,
                stdout: "",
                stderr: errMsg,
            };
        } finally {
            // Clean up container
            if (container) {
                try {
                    await container.remove({ force: true });
                    log.debug(`Container ${containerName} removed`);
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }
}
