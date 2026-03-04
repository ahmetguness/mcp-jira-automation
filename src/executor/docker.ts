/**
 * Docker-based isolated executor.
 * Runs AI-generated commands inside a temporary container.
 *
 * Security model:
 * - git clone via Cmd array (no shell interpolation)
 * - Patches written via putArchive (tar stream, no heredoc)
 * - Each command exec'd individually via Cmd array
 * - Container: cap_drop ALL, no-new-privileges, ReadonlyRootfs + writable /workspace & /tmp
 */

import Docker from "dockerode";
import { pack, type Pack } from "tar-stream";
import { createLogger, withTiming } from "../logger.js";
import type { Config } from "../config.js";
import { validateBranchName, validateRepoUrl, validatePatchPath, tokenizeCommand } from "../sanitize.js";

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
        const dockerHost = process.env.DOCKER_HOST;
        if (dockerHost) {
            const url = new URL(dockerHost);
            this.docker = new Docker({
                host: url.hostname,
                port: Number(url.port) || 2375,
            });
        } else {
            this.docker = new Docker();
        }
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
     * Phases:
     * 1. Create container (idle with sleep)
     * 2. git clone via exec Cmd array
     * 3. Write patches via putArchive (tar)
     * 4. Run each command via exec Cmd array
     * 5. Collect output + remove container
     */
    async run(opts: {
        repoUrl: string;
        branch: string;
        commands: string[];
        patches?: { path: string; content: string }[];
    }): Promise<DockerRunResult> {
        // Validate inputs before any Docker interaction
        const safeBranch = validateBranchName(opts.branch);
        const safeRepoUrl = validateRepoUrl(opts.repoUrl);

        const containerName = `mcp-jira-exec-${Date.now()}`;
        let container: Docker.Container | null = null;
        const allOutput: string[] = [];

        try {
            log.info(`Creating container ${containerName}`);

            // Phase 1: Create idle container
            container = await this.docker.createContainer({
                Image: this.image,
                name: containerName,
                Cmd: ["sleep", "infinity"],
                WorkingDir: "/workspace",
                Tty: false,
                HostConfig: {
                    AutoRemove: false,
                    Memory: 512 * 1024 * 1024,       // 512MB
                    MemorySwap: 1024 * 1024 * 1024,   // 1GB
                    CpuPeriod: 100000,
                    CpuQuota: 100000,                  // 1 CPU
                    PidsLimit: 256,
                    SecurityOpt: ["no-new-privileges"],
                    CapDrop: ["ALL"],
                    CapAdd: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"],
                    ReadonlyRootfs: true,
                    Tmpfs: {
                        "/tmp": "exec,size=100M",
                        "/workspace": "exec,size=500M",
                        "/root": "exec,size=100M",
                    },
                },
                Env: [
                    "DEBIAN_FRONTEND=noninteractive",
                    "HOME=/root",
                    "npm_config_cache=/root/.npm"
                ],
            });

            await container.start();
            log.info(`Container ${containerName} started`);

            // Phase 2: git clone via Cmd array (no shell interpolation)
            const cloneResult = await this.execInContainer(container, [
                "git", "clone", "--depth", "1", "--branch", safeBranch, safeRepoUrl, "/workspace",
            ]);
            allOutput.push(cloneResult.output);

            if (cloneResult.exitCode !== 0) {
                // Fallback: clone without branch
                log.warn(`Branch clone failed, retrying without --branch`);
                const fallbackResult = await this.execInContainer(container, [
                    "git", "clone", "--depth", "1", safeRepoUrl, "/workspace",
                ]);
                allOutput.push(fallbackResult.output);
                if (fallbackResult.exitCode !== 0) {
                    log.error(`Git clone failed (exit ${fallbackResult.exitCode})`);
                    return {
                        exitCode: fallbackResult.exitCode,
                        stdout: allOutput.join("\n").slice(0, 50000),
                        stderr: "Git clone failed",
                    };
                }
            }

            // Phase 3: Write patches via putArchive (tar stream)
            if (opts.patches?.length) {
                await this.writePatchesToContainer(container, opts.patches);
                log.info(`Wrote ${opts.patches.length} patch(es) via putArchive`);
            }

            // Phase 4: Run each command via exec Cmd array
            let lastExitCode = 0;
            for (const cmd of opts.commands) {
                const tokens = tokenizeCommand(cmd);
                log.info(`Running: ${tokens.join(" ")}`);

                const result = await this.execInContainer(container, tokens);
                allOutput.push(`>>> ${cmd}\n${result.output}`);
                lastExitCode = result.exitCode;

                if (result.exitCode !== 0) {
                    log.error(`Command failed (exit ${result.exitCode}): ${cmd}`);
                    break;
                }
            }

            log.info(`Container ${containerName} finished (exit: ${lastExitCode})`);

            return {
                exitCode: lastExitCode,
                stdout: allOutput.join("\n").slice(0, 50000),
                stderr: "",
            };
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`Container execution failed: ${errMsg}`);

            if (container) {
                try { await container.kill(); } catch { /* already stopped */ }
            }

            return {
                exitCode: 1,
                stdout: allOutput.join("\n").slice(0, 50000),
                stderr: errMsg,
            };
        } finally {
            if (container) {
                try {
                    await container.remove({ force: true });
                    log.debug(`Container ${containerName} removed`);
                } catch { /* ignore cleanup errors */ }
            }
        }
    }

    /** Execute a command inside a running container, returning exit code + output */
    private async execInContainer(
        container: Docker.Container,
        cmd: string[],
    ): Promise<{ exitCode: number; output: string }> {
        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true,
        });

        const stream = await exec.start({ Detach: false, Tty: false });

        const output = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            const timeout = setTimeout(() => {
                reject(new Error("Container execution timed out"));
            }, this.timeoutMs);

            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
                clearTimeout(timeout);
                resolve(Buffer.concat(chunks).toString("utf-8"));
            });
            stream.on("error", (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        const inspect = await exec.inspect();
        return { exitCode: inspect.ExitCode ?? 1, output };
    }

    /** Write patch files to container via tar archive — no shell, no heredoc */
    private async writePatchesToContainer(
        container: Docker.Container,
        patches: { path: string; content: string }[],
    ): Promise<void> {
        const archive: Pack = pack();

        for (const p of patches) {
            const safePath = validatePatchPath(p.path);
            const buf = Buffer.from(p.content, "utf-8");
            archive.entry({ name: safePath, size: buf.length }, buf);
        }

        archive.finalize();

        // Workaround for Docker putArchive returning 400 when Rootfs is read-only.
        // We use docker exec with tar to extract the archive from stdin directly into /workspace.
        // SECURITY: Using Cmd array prevents shell injection. -f - reads from stdin safely.
        const exec = await container.exec({
            Cmd: ["tar", "-x", "-f", "-", "-C", "/workspace"],
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
        });

        const stream = await exec.start({ stdin: true, hijack: true });

        // Pipe our safe tar stream directly into the exec process
        await new Promise<void>((resolve, reject) => {
            archive.on("error", reject);
            stream.on("error", reject);

            // Resolve when tar finishes writing to stream
            stream.on("end", resolve);

            archive.pipe(stream);
        });

        let inspect = await exec.inspect();
        // Wait for the exec process to fully exit to reliably get ExitCode
        while (inspect.Running) {
            await new Promise((r) => setTimeout(r, 100));
            inspect = await exec.inspect();
        }

        if (inspect.ExitCode !== 0) {
            throw new Error(`Failed to apply patches via tar (exit code ${inspect.ExitCode})`);
        }
    }
}
