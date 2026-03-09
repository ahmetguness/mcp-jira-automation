/**
 * Docker-based isolated executor — language-agnostic.
 *
 * Two-container architecture:
 * - Scout container (alpine/git): clones repo, detects project type
 * - Main container (detected image): installs deps, applies patches, runs commands
 *
 * Workspace shared via Docker volume between containers.
 *
 * Security model:
 * - git clone via Cmd array (no shell interpolation)
 * - Patches written via putArchive (tar stream, no heredoc)
 * - Each command exec'd individually via Cmd array
 * - Container: cap_drop ALL, no-new-privileges, ReadonlyRootfs + writable /workspace & /tmp
 */

import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { pack, type Pack } from "tar-stream";
import { createLogger, withTiming } from "../logger.js";
import type { Config } from "../config.js";
import { validateBranchName, validateRepoUrl, validatePatchPath } from "../sanitize.js";
import {
    detectProject,
    getAllMarkerFiles,
    applyInstallScriptsPolicy,
    LANGUAGE_ENV,
    type Detection,
} from "./project-detector.js";

const log = createLogger("executor:docker");

const SCOUT_IMAGE = "alpine/git";

// ─── Types ───────────────────────────────────────────────────

interface DockerRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    patches?: { path: string; content: string; action: "create" | "modify" }[];
}

// ─── Shared security HostConfig ──────────────────────────────

function securityHostConfig(opts?: { binds?: string[]; readonlyRootfs?: boolean }): Record<string, unknown> {
    const { binds, readonlyRootfs = true } = opts ?? {};
    return {
        AutoRemove: false,
        Memory: 512 * 1024 * 1024,        // 512MB
        MemorySwap: 1024 * 1024 * 1024,    // 1GB
        CpuPeriod: 100000,
        CpuQuota: 100000,                   // 1 CPU
        PidsLimit: 256,
        SecurityOpt: ["no-new-privileges"],
        CapDrop: ["ALL"],
        CapAdd: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"],
        ReadonlyRootfs: readonlyRootfs,
        Tmpfs: {
            "/tmp": "exec,size=100M",
            "/root": "exec,size=100M",
        },
        Binds: binds,
    };
}

// ─── DockerExecutor ──────────────────────────────────────────

export class DockerExecutor {
    private docker: Docker;
    private configImage: string;
    private timeoutMs: number;
    private allowInstallScripts: boolean;

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
        this.configImage = config.dockerImage;
        this.timeoutMs = config.execTimeoutMs;
        this.allowInstallScripts = config.allowInstallScripts;
        log.info(`Docker executor initialized (image: ${this.configImage}, timeout: ${this.timeoutMs}ms)`);
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

    /** Pull image if not found locally */
    private async ensureImage(imageName: string): Promise<void> {
        try {
            log.debug(`Checking if image ${imageName} exists locally...`);
            await this.docker.getImage(imageName).inspect();
        } catch (e: any) {
            if (e.statusCode === 404) {
                log.info(`Image ${imageName} not found locally. Pulling...`);
                await new Promise<void>((resolve, reject) => {
                    this.docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
                        if (err) return reject(err);
                        this.docker.modem.followProgress(stream, (onFinishedErr: Error | null) => {
                            if (onFinishedErr) return reject(onFinishedErr);
                            resolve();
                        });
                    });
                });
                log.info(`Successfully pulled image ${imageName}`);
            } else {
                throw e;
            }
        }
    }

    /**
     * Run commands in an isolated Docker container.
     *
     * Two-container pipeline:
     * 1. Scout: git clone + project detection (alpine/git)
     * 2. Main:  install deps + apply patches + run commands (detected image)
     */
    async run(opts: {
        repoUrl: string;
        branch: string;
        commands: string[];
        patches?: { path: string; content: string }[];
        environmentHint?: string;
    }): Promise<DockerRunResult> {
        // Validate inputs before any Docker interaction
        const safeBranch = validateBranchName(opts.branch);
        const safeRepoUrl = validateRepoUrl(opts.repoUrl);

        const ts = Date.now();
        const volumeName = `mcp-workspace-${ts}`;
        let scoutContainer: Docker.Container | null = null;
        let mainContainer: Docker.Container | null = null;
        const allOutput: string[] = [];

        try {
            // ═══ Phase 1: Create shared Docker volume ═══
            log.info(`Creating workspace volume ${volumeName}`);
            await this.docker.createVolume({ Name: volumeName });

            const volumeBind = `${volumeName}:/workspace`;

            // ═══ Phase 2: Scout container — clone + detect ═══
            const scoutName = `mcp-scout-${ts}`;
            log.info(`Creating scout container ${scoutName}`);

            await this.ensureImage(SCOUT_IMAGE);

            scoutContainer = await this.docker.createContainer({
                Image: SCOUT_IMAGE,
                name: scoutName,
                Entrypoint: ["/bin/sh"],
                Cmd: ["-c", "sleep 86400"],
                WorkingDir: "/workspace",
                Tty: false,
                HostConfig: securityHostConfig({ binds: [volumeBind] }) as Docker.HostConfig,
                Env: ["HOME=/root"],
            });

            await scoutContainer.start();
            log.info(`Scout container ${scoutName} started`);

            // Phase 2.1: git clone
            const cloneResult = await this.execInContainer(scoutContainer, [
                "git", "clone", "--depth", "1", "--branch", safeBranch, safeRepoUrl, "/workspace",
            ]);
            allOutput.push(cloneResult.output);

            if (cloneResult.exitCode !== 0) {
                log.warn(`Branch clone failed, retrying without --branch`);
                const fallbackResult = await this.execInContainer(scoutContainer, [
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

            // Phase 2.2: Detect project type by scanning for marker files
            const detection = await this.detectProjectInContainer(scoutContainer, opts.environmentHint);

            // ═══ Phase 3: Resolve Docker image ═══
            // NOTE: Scout container stays alive until main container starts.
            // On Docker Desktop (Windows/WSL2), removing the scout before the
            // main container mounts the shared volume corrupts the overlayfs
            // layer, causing "lstat … invalid argument" errors.
            let targetImage: string;
            if (this.configImage !== "auto") {
                targetImage = this.configImage;
                log.info(`Using explicit image from config: ${targetImage}`);

                // Smart Override: Don't use a forced image if it conflicts with the detected language
                if (detection.language !== 'unknown' && !targetImage.includes(detection.language)) {
                    log.warn(`Explicit image ${targetImage} conflicts with detection of ${detection.language} (confidence: ${detection.confidence}). Overriding to ${detection.image}`);
                    targetImage = detection.image;
                }
            } else {
                targetImage = detection.image;
                log.info(`Auto-detected image: ${targetImage} (lang=${detection.language}, confidence=${detection.confidence})`);
            }

            // ═══ Phase 4: Main container — deps + patches + commands ═══
            const mainName = `mcp-jira-exec-${ts}`;
            const mainWorkdir = detection.workdir;

            await this.ensureImage(targetImage);

            // Build environment variables
            const envVars = [
                "DEBIAN_FRONTEND=noninteractive",
                "HOME=/root",
                "NO_COLOR=1",
                "FORCE_COLOR=0",
                ...LANGUAGE_ENV[detection.language],
            ];

            // NOTE: WorkingDir is NOT set during container creation.
            // On Docker Desktop (Windows/WSL2), setting WorkingDir triggers an
            // lstat syscall on the overlayfs layer that fails with "invalid argument"
            // for complex images like node:20-bookworm. Instead, workdir is passed
            // to each exec call individually.
            log.info(`Creating main container ${mainName} (image: ${targetImage}, workdir: ${mainWorkdir}, readonlyRootfs: false)`);

            mainContainer = await this.docker.createContainer({
                Image: targetImage,
                name: mainName,
                Cmd: ["sleep", "infinity"],
                Tty: false,
                HostConfig: securityHostConfig({ binds: [volumeBind], readonlyRootfs: false }) as Docker.HostConfig,
                Env: envVars,
            });
            log.info(`Main container ${mainName} created, starting...`);

            await mainContainer.start();
            log.info(`Main container ${mainName} started`);

            // Now safe to release the scout — main container holds the volume reference.
            await scoutContainer.stop().catch(() => { /* may already be stopped */ });
            await scoutContainer.remove({ force: true }).catch(() => { /* ignore */ });
            scoutContainer = null;
            log.info(`Scout container ${scoutName} removed`);

            // Phase 4.1: Install dependencies
            if (detection.installCmd && detection.installCmd.length > 0) {
                const installCmd = applyInstallScriptsPolicy(detection.installCmd, this.allowInstallScripts);
                log.info(`Installing dependencies: ${installCmd.join(" ")}`);

                const installResult = await this.execInContainer(mainContainer, installCmd, mainWorkdir);
                allOutput.push(installResult.output);

                if (installResult.exitCode !== 0) {
                    // Fallback: If npm ci fails, retry with npm install
                    if (installCmd[0] === "npm" && installCmd[1] === "ci") {
                        log.warn(`npm ci failed (exit ${installResult.exitCode}), retrying with npm install...`);
                        const fallbackCmd = ["npm", "install"];
                        const fallbackInstallCmd = applyInstallScriptsPolicy(fallbackCmd, this.allowInstallScripts);
                        
                        const fallbackResult = await this.execInContainer(mainContainer, fallbackInstallCmd, mainWorkdir);
                        allOutput.push(fallbackResult.output);

                        if (fallbackResult.exitCode !== 0) {
                            log.error(`Dependency install failed with fallback (exit ${fallbackResult.exitCode}): ${fallbackInstallCmd.join(" ")}`);
                            return {
                                exitCode: fallbackResult.exitCode,
                                stdout: allOutput.join("\n").slice(0, 50000),
                                stderr: "Dependency installation failed (both npm ci and npm install)",
                            };
                        }
                        log.info("Dependencies installed successfully with npm install fallback");
                    } else {
                        log.error(`Dependency install failed (exit ${installResult.exitCode}): ${installCmd.join(" ")}`);
                        return {
                            exitCode: installResult.exitCode,
                            stdout: allOutput.join("\n").slice(0, 50000),
                            stderr: "Dependency installation failed",
                        };
                    }
                } else {
                    log.info("Dependencies installed successfully");
                }
            }

            // Phase 4.2: Write patches via putArchive (tar stream)
            if (opts.patches?.length) {
                await this.writePatchesToContainer(mainContainer, opts.patches);
                log.info(`Wrote ${opts.patches.length} patch(es) via putArchive`);
            }

            // Phase 4.3: Run each command via sh -c
            let lastExitCode = 0;
            for (const cmd of opts.commands) {
                log.info(`Running: ${cmd}`);

                const result = await this.execInContainer(mainContainer, ["sh", "-c", cmd], mainWorkdir);
                allOutput.push(`>>> ${cmd}\n${result.output}`);
                lastExitCode = result.exitCode;

                if (result.exitCode !== 0) {
                    log.error(`Command failed (exit ${result.exitCode}): ${cmd}`);
                    break;
                }
            }

            log.info(`Main container ${mainName} finished (exit: ${lastExitCode})`);

            // Phase 5: Capture new or modified files
            log.info(`Capturing generated artifacts from container ${mainName}`);
            const statusResult = await this.execInContainer(mainContainer, ["git", "status", "--porcelain"], mainWorkdir);
            const capturedPatches: { path: string; content: string; action: "create" | "modify" }[] = [];

            if (statusResult.exitCode === 0 && statusResult.output) {
                const lines = statusResult.output.split("\n").filter(l => l.trim().length > 0);
                for (const line of lines) {
                    const status = line.slice(0, 2);
                    const file = line.slice(3).trim();

                    let action: "create" | "modify" | null = null;
                    if (status === "??") action = "create";
                    else if (status.includes("M") || status.includes("A")) action = "modify";

                    if (action) {
                        const contentResult = await this.execInContainer(mainContainer, ["cat", file], mainWorkdir);
                        if (contentResult.exitCode === 0) {
                            capturedPatches.push({
                                path: file,
                                content: contentResult.output,
                                action
                            });
                            log.info(`Captured generated file: ${file} (${action})`);
                        }
                    }
                }
            }

            return {
                exitCode: lastExitCode,
                stdout: allOutput.join("\n").slice(0, 50000),
                stderr: "",
                patches: capturedPatches
            };
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`Container execution failed: ${errMsg}`);

            // Kill any running container
            if (scoutContainer) {
                try { await scoutContainer.kill(); } catch { /* already stopped */ }
            }
            if (mainContainer) {
                try { await mainContainer.kill(); } catch { /* already stopped */ }
            }

            return {
                exitCode: 1,
                stdout: allOutput.join("\n").slice(0, 50000),
                stderr: errMsg,
            };
        } finally {
            // Cleanup: remove containers and volume
            if (scoutContainer) {
                try { await scoutContainer.remove({ force: true }); } catch { /* ignore */ }
            }
            if (mainContainer) {
                try {
                    await mainContainer.remove({ force: true });
                    log.debug(`Main container removed`);
                } catch { /* ignore */ }
            }
            try {
                const volume = this.docker.getVolume(volumeName);
                await volume.remove();
                log.debug(`Volume ${volumeName} removed`);
            } catch { /* ignore cleanup errors */ }
        }
    }

    // ─── Project Detection ───────────────────────────────────

    /**
     * Detect project type by scanning for marker files inside a running container.
     * Uses `find` to discover markers up to 3 directories deep, then passes
     * the results to the project detector algorithm.
     */
    private async detectProjectInContainer(
        container: Docker.Container,
        aiHint?: string,
    ): Promise<Detection> {
        const markerFiles = getAllMarkerFiles();

        // Build find command: find /workspace -maxdepth 3 \( -name "file1" -o -name "file2" ... \) -type f
        const findArgs = ["find", "/workspace", "-maxdepth", "3", "("];
        for (let i = 0; i < markerFiles.length; i++) {
            if (i > 0) findArgs.push("-o");
            findArgs.push("-name", markerFiles[i]!);
        }
        findArgs.push(")", "-type", "f");

        log.info("Scanning for project markers (maxdepth=3)...");
        const findResult = await this.execInContainer(container, findArgs);

        const foundFiles: string[] = [];
        if (findResult.exitCode === 0 && findResult.output.trim()) {
            for (const line of findResult.output.trim().split("\n")) {
                const trimmed = line.trim();
                if (trimmed) {
                    // Convert absolute path to relative: /workspace/package.json → package.json
                    const relative = trimmed.replace(/^\/workspace\/?/, "");
                    if (relative) foundFiles.push(relative);
                }
            }
        }

        return detectProject(foundFiles, aiHint);
    }

    // ─── Container Exec ──────────────────────────────────────

    /** Execute a command inside a running container, returning exit code + output */
    private async execInContainer(
        container: Docker.Container,
        cmd: string[],
        workdir?: string,
    ): Promise<{ exitCode: number; output: string }> {
        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true,
            ...(workdir ? { WorkingDir: workdir } : {}),
        });

        const stream = await exec.start({ Detach: false, Tty: false });

        // Docker multiplexes stdout/stderr with 8-byte binary frame headers
        // when Tty=false.  We must demux to get clean text output.
        const output = await new Promise<string>((resolve, reject) => {
            const stdout = new PassThrough();
            const stderr = new PassThrough();
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            const timeout = setTimeout(() => {
                reject(new Error("Container execution timed out"));
            }, this.timeoutMs);

            stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
            stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

            this.docker.modem.demuxStream(stream, stdout, stderr);

            stream.on("end", () => {
                clearTimeout(timeout);
                const out = Buffer.concat(stdoutChunks).toString("utf-8");
                const err = Buffer.concat(stderrChunks).toString("utf-8");
                resolve(out + err);
            });
            stream.on("error", (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        const inspect = await exec.inspect();
        return { exitCode: inspect.ExitCode ?? 1, output };
    }

    // ─── Patch Writer ────────────────────────────────────────

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
