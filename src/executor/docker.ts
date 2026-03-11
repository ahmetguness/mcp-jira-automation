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
import { createLogger } from "../logger.js";
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
        } catch (e: unknown) {
            if (e && typeof e === 'object' && 'statusCode' in e && e.statusCode === 404) {
                log.info(`Image ${imageName} not found locally. Pulling...`);
                await new Promise<void>((resolve, reject) => {
                    void this.docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
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

            // Phase 2.3: Detect database dependencies for automatic configuration
            const detectedDatabases = await this.detectDatabaseDependencies(scoutContainer, detection.language);

            // Phase 2.4: Detect module system (ESM vs CommonJS)
            const isEsm = await this.detectModuleSystemInContainer(scoutContainer, detection.workdir);

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

            // Add common test environment variables that applications typically need
            envVars.push(
                'JWT_SECRET=test-secret-key-for-testing-only-do-not-use-in-production',
                'JWT_ACCESS_EXPIRATION_MINUTES=30',
                'JWT_REFRESH_EXPIRATION_DAYS=30',
                'JWT_RESET_PASSWORD_EXPIRATION_MINUTES=10',
                'JWT_VERIFY_EMAIL_EXPIRATION_MINUTES=10',
                'API_KEY=test-api-key',
                'SESSION_SECRET=test-session-secret-for-testing-only',
                'ENCRYPTION_KEY=test-encryption-key-32-chars!!',
                'SMTP_HOST=localhost',
                'SMTP_PORT=1025',
                'SMTP_USERNAME=test',
                'SMTP_PASSWORD=test',
                'EMAIL_FROM=test@example.com',
            );

            // Add database configuration if databases are detected
            // This provides test database URLs automatically for applications that require them
            if (detectedDatabases.length > 0) {
                const databaseEnvVars = this.generateDatabaseEnvironmentVariables(detectedDatabases);
                envVars.push(...databaseEnvVars);
                log.info(`Added database configuration for: ${detectedDatabases.join(", ")}`);
            }

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

                // Use 10 minutes timeout for dependency installation (can take longer than regular commands)
                const installTimeoutMs = 600_000; // 10 minutes
                const installResult = await this.execInContainer(mainContainer, installCmd, mainWorkdir, installTimeoutMs);
                allOutput.push(installResult.output);

                if (installResult.exitCode !== 0) {
                    // Fallback: If npm ci fails, retry with npm install
                    if (installCmd[0] === "npm" && installCmd[1] === "ci") {
                        log.warn(`npm ci failed (exit ${installResult.exitCode}), retrying with npm install...`);
                        const fallbackCmd = ["npm", "install"];
                        const fallbackInstallCmd = applyInstallScriptsPolicy(fallbackCmd, this.allowInstallScripts);
                        
                        const fallbackResult = await this.execInContainer(mainContainer, fallbackInstallCmd, mainWorkdir, installTimeoutMs);
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

            // Phase 4.2: ESM-safe patch adjustment
            // If the repo uses "type": "module", rename .js patches to .cjs
            // so Node.js always treats AI-generated test scripts as CommonJS.
            let commands = [...opts.commands];
            if (isEsm && opts.patches?.length) {
                for (const p of opts.patches) {
                    if (p.path.endsWith('.js') && !p.path.endsWith('.mjs')) {
                        const oldName = p.path;
                        const newName = p.path.replace(/\.js$/, '.cjs');
                        log.info(`ESM repo detected: renaming patch ${oldName} -> ${newName}`);
                        p.path = newName;

                        // Update commands that reference the old filename
                        const oldBasename = oldName.split('/').pop()!;
                        const newBasename = newName.split('/').pop()!;
                        commands = commands.map(cmd =>
                            cmd.includes(oldBasename) ? cmd.replace(oldBasename, newBasename) : cmd
                        );
                    }
                }
            }

            // Write patches via putArchive (tar stream)
            if (opts.patches?.length) {
                await this.writePatchesToContainer(mainContainer, opts.patches, mainWorkdir);
                log.info(`Wrote ${opts.patches.length} patch(es) via putArchive`);
            }

            // Phase 4.2.5: Start server if needed (for API tests)
            if (this.shouldStartServer(commands, detection.language)) {
                await this.startServerInContainer(mainContainer, mainWorkdir);
            }

            // Phase 4.3: Run each command via sh -c
            let lastExitCode = 0;
            for (const cmd of commands) {
                // If server was started, verify it's still running before executing test
                if (this.shouldStartServer(commands, detection.language)) {
                    const serverCheck = await this.execInContainer(
                        mainContainer,
                        ['sh', '-c', 'curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ 2>/dev/null | tail -1'],
                        mainWorkdir,
                        5000
                    );
                    const httpCode = serverCheck.output.trim();
                    log.info(`Pre-test server check: HTTP code="${httpCode}" (length=${httpCode.length})`);
                    
                    if (httpCode === '000' || httpCode === '' || httpCode.length !== 3) {
                        log.error(`Server is not responding correctly before test execution! HTTP code: "${httpCode}"`);
                        // Get comprehensive debug info
                        const debugInfo = await this.execInContainer(
                            mainContainer,
                            ['sh', '-c', `
echo "=== Server Logs ==="
cat /tmp/server.log 2>/dev/null || echo "No server logs"
echo ""
echo "=== PID Check ==="
if [ -f /tmp/server.pid ]; then
  PID=$(cat /tmp/server.pid)
  echo "PID file contains: $PID"
  if kill -0 $PID 2>/dev/null; then
    echo "Process $PID is alive"
  else
    echo "Process $PID is dead"
  fi
else
  echo "No PID file"
fi
echo ""
echo "=== Listening Ports ==="
netstat -tlnp 2>/dev/null | grep 3001 || ss -tlnp 2>/dev/null | grep 3001 || echo "Port 3001 not listening"
echo ""
echo "=== Node Processes ==="
ps aux | grep node | grep -v grep || echo "No node processes"
`],
                            mainWorkdir,
                            10000
                        );
                        log.error(`Server debug info:\n${debugInfo.output}`);
                    } else {
                        log.info(`Server verified responding before test (HTTP ${httpCode})`);
                    }
                }

                log.info(`Running: ${cmd}`);

                const result = await this.execInContainer(mainContainer, ["sh", "-c", cmd], mainWorkdir);
                allOutput.push(`>>> ${cmd}\n${result.output}`);
                lastExitCode = result.exitCode;

                if (result.exitCode !== 0) {
                    log.error(`Command failed (exit ${result.exitCode}): ${cmd}`);
                    // Log stdout/stderr for debugging
                    if (result.output) {
                        const lines = result.output.split('\n').slice(0, 20); // First 20 lines
                        log.error(`Command output:\n${lines.join('\n')}`);
                    }
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

    /**
     * Detect if the project uses ES modules by reading package.json from the container.
     * Returns true if package.json has "type": "module".
     */
    private async detectModuleSystemInContainer(
        container: Docker.Container,
        workdir: string,
    ): Promise<boolean> {
        try {
            // Try workdir-specific package.json first (monorepo), then root
            const paths = workdir !== '/workspace'
                ? [`${workdir}/package.json`, '/workspace/package.json']
                : ['/workspace/package.json'];

            for (const pkgPath of paths) {
                const result = await this.execInContainer(container, ['cat', pkgPath]);
                if (result.exitCode === 0 && result.output.trim()) {
                    try {
                        const pkg = JSON.parse(result.output);
                        if (pkg.type === 'module') {
                            log.info(`Detected ES module project (from ${pkgPath})`);
                            return true;
                        }
                    } catch {
                        // Invalid JSON, skip
                    }
                }
            }
        } catch (error) {
            log.warn(`Failed to detect module system: ${String(error)}`);
        }

        return false;
    }

    // ─── Container Exec ──────────────────────────────────────

    /** Execute a command inside a running container, returning exit code + output */
    private async execInContainer(
        container: Docker.Container,
        cmd: string[],
        workdir?: string,
        customTimeoutMs?: number,
    ): Promise<{ exitCode: number; output: string }> {
        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true,
            ...(workdir ? { WorkingDir: workdir } : {}),
        });

        const stream = await exec.start({ Detach: false, Tty: false });

        // Use custom timeout if provided, otherwise use default
        const timeoutMs = customTimeoutMs ?? this.timeoutMs;

        // Docker multiplexes stdout/stderr with 8-byte binary frame headers
        // when Tty=false.  We must demux to get clean text output.
        const output = await new Promise<string>((resolve, reject) => {
            const stdout = new PassThrough();
            const stderr = new PassThrough();
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            const timeout = setTimeout(() => {
                reject(new Error("Container execution timed out"));
            }, timeoutMs);

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
        workdir: string = "/workspace",
    ): Promise<void> {
        const archive: Pack = pack();

        // Extract the subdirectory from workdir (e.g., "/workspace/backend" -> "backend")
        const workdirSubpath = workdir.replace(/^\/workspace\/?/, "");
        
        for (const p of patches) {
            const safePath = validatePatchPath(p.path);
            
            // Adjust patch path based on workdir
            // If patch path is absolute or already includes the workdir subpath, use as-is
            // Otherwise, prepend the workdir subpath
            let finalPath = safePath;
            
            if (workdirSubpath && !safePath.startsWith(workdirSubpath + "/") && !safePath.startsWith("/")) {
                finalPath = `${workdirSubpath}/${safePath}`;
                log.info(`Adjusted patch path: ${safePath} -> ${finalPath} (workdir: ${workdir})`);
            }
            
            const buf = Buffer.from(p.content, "utf-8");
            archive.entry({ name: finalPath, size: buf.length }, buf);
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

    /**
     * Determine if server startup is needed based on commands and language
     */
    private shouldStartServer(commands: string[], language: string): boolean {
        // DISABLED: Automatic server startup is disabled because:
        // 1. Generated tests should be self-contained and start their own server if needed
        // 2. Pre-starting the server requires database services (MongoDB, PostgreSQL, etc.)
        //    which are not available in the isolated container
        // 3. The AI-generated test files handle server lifecycle themselves
        return false;
    }

    /**
     * Start application server in container before running tests
     */
    private async startServerInContainer(
        container: Docker.Container,
        workdir: string
    ): Promise<void> {
        const port = 3001; // Default port for API tests
        
        // Create a startup script that properly captures all output
        const startupScript = `#!/bin/sh
# Redirect all output to log file
exec > /tmp/server.log 2>&1

# Set common environment variables that apps might need
export NODE_ENV=test
export PORT=3001

echo "Starting server..."
echo "Environment variables set:"
echo "NODE_ENV=$NODE_ENV"
echo "PORT=$PORT"
echo "MONGODB_URL=$MONGODB_URL"
echo "JWT_SECRET=$JWT_SECRET"

# Try different server entry points
if [ -f "src/app.js" ]; then
  echo "Starting with src/app.js"
  node src/app.js 2>&1 &
elif [ -f "app.js" ]; then
  echo "Starting with app.js"
  node app.js 2>&1 &
elif [ -f "src/index.js" ]; then
  echo "Starting with src/index.js"
  node src/index.js 2>&1 &
elif [ -f "index.js" ]; then
  echo "Starting with index.js"
  node index.js 2>&1 &
else
  echo "Trying require pattern"
  node -e "require('./src/app').listen(${port})" 2>&1 &
fi
SERVER_PID=\$!
echo \$SERVER_PID > /tmp/server.pid
echo "Server PID: \$SERVER_PID"

# Wait a moment to see if server crashes immediately
sleep 2
if ! kill -0 \$SERVER_PID 2>/dev/null; then
  echo "ERROR: Server process \$SERVER_PID died immediately after starting"
  echo "This usually means the app crashed during initialization"
fi
`;

        try {
            // Write the startup script
            await this.execInContainer(
                container,
                ['sh', '-c', `cat > /tmp/start-server.sh << 'EOFSCRIPT'\n${startupScript}\nEOFSCRIPT\nchmod +x /tmp/start-server.sh`],
                workdir,
                5000
            );

            // Run the startup script (output already redirected in script)
            await this.execInContainer(
                container,
                ['sh', '-c', 'cd /workspace && /tmp/start-server.sh'],
                workdir,
                5000
            );

            // Give server a moment to start
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Wait for server to become ready
            const isReady = await this.waitForServerReady(container, port, 15000);

            if (isReady) {
                // Verify server process is still running
                const pidCheck = await this.execInContainer(
                    container,
                    ['sh', '-c', 'if [ -f /tmp/server.pid ]; then kill -0 $(cat /tmp/server.pid) 2>/dev/null && echo "running" || echo "dead"; else echo "no-pid"; fi'],
                    workdir,
                    5000
                );

                if (pidCheck.output.trim() === 'running') {
                    log.info(`Server started successfully on port ${port} and verified stable (PID: $(cat /tmp/server.pid))`);
                } else {
                    log.warn(`Server responded but process check failed: ${pidCheck.output}`);
                }
            } else {
                // Get server logs for debugging
                const logsResult = await this.execInContainer(
                    container,
                    ['sh', '-c', 'cat /tmp/server.log 2>/dev/null || echo "No server logs"'],
                    workdir,
                    5000
                );
                log.warn(`Could not start server. Server logs:\n${logsResult.output}`);
            }
        } catch (error) {
            log.warn(`Server startup failed: ${(error as Error).message}`);
        }
    }

    /**
     * Wait for server to become ready by polling the port
     */
    private async waitForServerReady(
        container: Docker.Container,
        port: number,
        timeoutMs: number
    ): Promise<boolean> {
        const startTime = Date.now();
        const delays = [100, 200, 400, 800, 1600]; // Exponential backoff
        let attemptIndex = 0;

        while (Date.now() - startTime < timeoutMs) {
            try {
                // Try to connect to the server using curl
                const result = await this.execInContainer(
                    container,
                    ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null || echo "000"`],
                    undefined,
                    5000
                );

                // Check if we got any HTTP response (even 404 means server is running)
                const httpCode = result.output.trim();
                if (httpCode !== '000' && httpCode !== '') {
                    return true;
                }
            } catch {
                // Connection failed, continue waiting
            }

            // Wait before next attempt with exponential backoff
            const delay = delays[Math.min(attemptIndex, delays.length - 1)] ?? 1600;
            await new Promise(resolve => setTimeout(resolve, delay));
            attemptIndex++;
        }

        return false;
    }

    /**
     * Detect database dependencies from package.json or requirements.txt
     * Returns array of detected database types (mongodb, postgresql, mysql, redis, sqlite)
     */
    private async detectDatabaseDependencies(
        container: Docker.Container,
        language: string
    ): Promise<string[]> {
        const detectedDatabases: Set<string> = new Set();

        // Node.js database packages mapping
        const nodeDatabasePackages: Record<string, string> = {
            'mongoose': 'mongodb',
            'mongodb': 'mongodb',
            'pg': 'postgresql',
            'postgres': 'postgresql',
            'mysql': 'mysql',
            'mysql2': 'mysql',
            'redis': 'redis',
            'ioredis': 'redis',
            'sqlite3': 'sqlite',
            'better-sqlite3': 'sqlite',
            'sequelize': 'postgresql',
            'typeorm': 'postgresql',
            'prisma': 'postgresql',
            'knex': 'postgresql',
        };

        // Python database packages mapping
        const pythonDatabasePackages: Record<string, string> = {
            'pymongo': 'mongodb',
            'psycopg2': 'postgresql',
            'psycopg2-binary': 'postgresql',
            'mysql-connector-python': 'mysql',
            'redis': 'redis',
            'sqlalchemy': 'postgresql',
            'django': 'postgresql',
        };

        try {
            if (language === 'node') {
                // Check package.json for Node.js dependencies
                const result = await this.execInContainer(container, ['cat', '/workspace/package.json']);
                if (result.exitCode === 0 && result.output.trim()) {
                    try {
                        const pkg = JSON.parse(result.output);
                        const allDeps = {
                            ...pkg.dependencies,
                            ...pkg.devDependencies,
                        };

                        // Check each dependency against known database packages
                        for (const [packageName, dbType] of Object.entries(nodeDatabasePackages)) {
                            if (allDeps[packageName]) {
                                detectedDatabases.add(dbType);
                                log.debug(`Detected ${dbType} dependency: ${packageName}`);
                            }
                        }
                    } catch (error) {
                        log.warn('Failed to parse package.json', { error });
                    }
                }
            } else if (language === 'python') {
                // Check requirements.txt for Python dependencies
                const result = await this.execInContainer(container, ['cat', '/workspace/requirements.txt']);
                if (result.exitCode === 0 && result.output.trim()) {
                    const content = result.output;

                    // Check each line for known database packages
                    for (const [packageName, dbType] of Object.entries(pythonDatabasePackages)) {
                        // Match package name at start of line or after whitespace, followed by version specifier or newline
                        const regex = new RegExp(`(^|\\s)${packageName}([=<>!]|$)`, 'm');
                        if (regex.test(content)) {
                            detectedDatabases.add(dbType);
                            log.debug(`Detected ${dbType} dependency: ${packageName}`);
                        }
                    }
                }
            }
        } catch (error) {
            log.warn('Failed to detect database dependencies', { error });
        }

        return Array.from(detectedDatabases);
    }

    /**
     * Generate database environment variables for detected databases
     * Returns array of environment variable strings (e.g., "MONGODB_URL=mongodb://localhost:27017/test")
     */
    private generateDatabaseEnvironmentVariables(detectedDatabases: string[]): string[] {
        const envVars: string[] = [];

        const databaseConfig: Record<string, { envVarName: string; testUrl: string }> = {
            'mongodb': {
                envVarName: 'MONGODB_URL',
                testUrl: 'mongodb://localhost:27017/test',
            },
            'postgresql': {
                envVarName: 'DATABASE_URL',
                testUrl: 'postgresql://localhost:5432/test',
            },
            'mysql': {
                envVarName: 'MYSQL_URL',
                testUrl: 'mysql://localhost:3306/test',
            },
            'redis': {
                envVarName: 'REDIS_URL',
                testUrl: 'redis://localhost:6379',
            },
            'sqlite': {
                envVarName: 'SQLITE_DATABASE',
                testUrl: ':memory:',
            },
        };

        for (const dbType of detectedDatabases) {
            const config = databaseConfig[dbType];
            if (config) {
                envVars.push(`${config.envVarName}=${config.testUrl}`);
            }
        }

        return envVars;
    }
}


