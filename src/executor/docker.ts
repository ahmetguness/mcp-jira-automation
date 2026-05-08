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
import {
    detectDatabaseDependencies,
    generateDatabaseEnvironmentVariables,
    startDatabaseServices,
} from "./database-manager.js";
import {
    shouldStartServer,
    startServerInContainer,
    verifyServerRunning,
} from "./server-lifecycle.js";
import { buildContainerEnv, parseContainerTestEnv } from "./container-env.js";

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

function securityHostConfig(opts?: { binds?: string[]; readonlyRootfs?: boolean; allowDatabaseServices?: boolean }): Record<string, unknown> {
    const { binds, readonlyRootfs = true, allowDatabaseServices = false } = opts ?? {};

    // Base capabilities needed for basic container operations
    const capAdd = ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"];

    // Additional capabilities needed when running database services (PostgreSQL, MongoDB, etc.)
    if (allowDatabaseServices) {
        capAdd.push(
            "FOWNER",        // apt-get needs to change file ownership
            "SYS_CHROOT",    // some package installations need chroot
            "KILL",          // process management for database daemons
            "NET_BIND_SERVICE", // database services bind to ports
        );
    }

    return {
        AutoRemove: false,
        Memory: allowDatabaseServices ? 1024 * 1024 * 1024 : 512 * 1024 * 1024,  // 1GB for DB, 512MB otherwise
        MemorySwap: allowDatabaseServices ? 2048 * 1024 * 1024 : 1024 * 1024 * 1024, // 2GB / 1GB swap
        CpuPeriod: 100000,
        CpuQuota: allowDatabaseServices ? 200000 : 100000,  // 2 CPUs for DB, 1 otherwise
        PidsLimit: allowDatabaseServices ? 512 : 256,
        SecurityOpt: allowDatabaseServices ? [] : ["no-new-privileges"],
        CapDrop: ["ALL"],
        CapAdd: capAdd,
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
    private containerTestEnv: Record<string, string>;

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
        this.containerTestEnv = parseContainerTestEnv(config.containerTestEnv);
        log.debug(`Docker executor initialized (image: ${this.configImage}, timeout: ${this.timeoutMs}ms)`);
    }

    /** Check if Docker is available */
    /** Check if Docker is available, with retry on transient failures */
    async checkConnection(): Promise<boolean> {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await this.docker.ping();
                return true;
            } catch {
                if (attempt < 3) {
                    log.warn(`Docker ping failed (attempt ${attempt}/3), retrying in ${attempt}s...`);
                    await new Promise(r => setTimeout(r, attempt * 1000));
                }
            }
        }
        log.error("Docker is not running or not accessible after 3 attempts");
        return false;
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
        executionMode?: "remote" | "sandbox";
        apiBaseUrl?: string;
        credentials?: Record<string, string>;
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
            const detectedDatabases = await detectDatabaseDependencies(
                this.execInContainer.bind(this), scoutContainer, detection.language,
            );
            if (detectedDatabases.length > 0) {
                log.info(`🗄️ Detected databases: ${detectedDatabases.join(', ')}`);
            }

            // Phase 2.4: Module system detection (DISABLED - Python tests only)
            // Python tests don't need module system detection
            // const isEsm = await this.detectModuleSystemInContainer(scoutContainer, detection.workdir);

            // ═══ Phase 3: Resolve Docker image ═══
            // NOTE: Scout container stays alive until main container starts.
            // On Docker Desktop (Windows/WSL2), removing the scout before the
            // main container mounts the shared volume corrupts the overlayfs
            // layer, causing "lstat … invalid argument" errors.
            //
            // STRATEGY: Always use the SERVER's native image so the app runs
            // natively. Python (for tests) is installed inside the container
            // in Phase 4.1 if missing.
            let targetImage: string;
            
            if (this.configImage !== "auto") {
                targetImage = this.configImage;

                // Smart Override: Don't use a forced image if it conflicts with the detected language
                if (detection.language !== 'unknown' && !targetImage.includes(detection.language)) {
                    log.warn(`Explicit image ${targetImage} conflicts with detection of ${detection.language} (confidence: ${detection.confidence}). Overriding to ${detection.image}`);
                    targetImage = detection.image;
                }
            } else {
                targetImage = detection.image;
            }

            // ═══ Phase 4: Main container — deps + patches + commands ═══
            const mainName = `mcp-jira-exec-${ts}`;
            const mainWorkdir = detection.workdir;

            await this.ensureImage(targetImage);

            // Build environment variables using container-env module
            const databaseEnvVars = detectedDatabases.length > 0
                ? generateDatabaseEnvironmentVariables(detectedDatabases)
                : [];

            const envVars = buildContainerEnv({
                language: detection.language,
                executionMode: opts.executionMode,
                apiBaseUrl: opts.apiBaseUrl,
                credentials: opts.credentials,
                detectedDatabases,
                databaseEnvVars,
                testEnvOverrides: this.containerTestEnv,
            });

            // NOTE: WorkingDir is NOT set during container creation.
            // On Docker Desktop (Windows/WSL2), setting WorkingDir triggers an
            // lstat syscall on the overlayfs layer that fails with "invalid argument"
            // for complex images like node:20-bookworm. Instead, workdir is passed
            // to each exec call individually.
            log.info(`🐳 Container: ${targetImage} | workdir: ${mainWorkdir} | lang: ${detection.language}`);

            mainContainer = await this.docker.createContainer({
                Image: targetImage,
                name: mainName,
                Cmd: ["sleep", "infinity"],
                Tty: false,
                HostConfig: securityHostConfig({ binds: [volumeBind], readonlyRootfs: false, allowDatabaseServices: detectedDatabases.length > 0 }) as Docker.HostConfig,
                Env: envVars,
            });

            await mainContainer.start();

            // Now safe to release the scout
            await scoutContainer.stop().catch(() => { /* may already be stopped */ });
            await scoutContainer.remove({ force: true }).catch(() => { /* ignore */ });
            scoutContainer = null;

            // Phase 4.1: Ensure Python + curl are available in the container
            // Tests are ALWAYS Python, but the container image is the server's native image.
            // We need: python3 (+ python symlink), curl (for health checks)
            {
                log.info("🔧 Ensuring python3 and curl are available...");
                const ensureToolsScript = [
                    // Check and install curl
                    'command -v curl > /dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq curl > /dev/null 2>&1)',
                    // Check and install python3 + create python symlink
                    'if ! command -v python3 > /dev/null 2>&1; then apt-get update -qq; apt-get install -y -qq python3 > /dev/null 2>&1; fi',
                    'if ! command -v python > /dev/null 2>&1 && command -v python3 > /dev/null 2>&1; then ln -sf $(which python3) /usr/local/bin/python; fi',
                ].join(' && ');
                const toolsResult = await this.execInContainer(
                    mainContainer,
                    ["sh", "-c", ensureToolsScript],
                    mainWorkdir,
                    120_000
                );
                allOutput.push(toolsResult.output);
                if (toolsResult.exitCode !== 0) {
                    log.warn("python3/curl install had issues — tests may still work");
                } else {
                    log.debug("✅ python3 + curl ready");
                }
            }

            // Phase 4.1.1: For Node.js servers running in non-Node images, install Node.js
            // Only needed in sandbox mode — remote mode doesn't start the server
            if (opts.executionMode !== "remote" && detection.language === "node" && !targetImage.startsWith("node:") && !targetImage.startsWith("oven/bun")) {
                log.info("📦 Installing Node.js (server needs it)...");
                const nodeInstallResult = await this.execInContainer(
                    mainContainer,
                    ["sh", "-c", "command -v node > /dev/null 2>&1 || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs) && npm install -g tsx"],
                    mainWorkdir,
                    300_000
                );
                allOutput.push(nodeInstallResult.output);
                if (nodeInstallResult.exitCode !== 0) {
                    log.error("Node.js installation failed");
                    return {
                        exitCode: nodeInstallResult.exitCode,
                        stdout: allOutput.join("\n").slice(0, 50000),
                        stderr: "Node.js installation failed",
                    };
                }
                log.info("✅ Node.js installed");
            }

            // Phase 4.1.2: For PHP servers running in non-PHP images, install PHP + Composer
            // Only needed in sandbox mode — remote mode doesn't start the server
            if (opts.executionMode !== "remote" && detection.language === "php" && !targetImage.startsWith("php:")) {
                log.info("📦 Installing PHP + Composer (server needs it)...");
                const phpInstallScript = [
                    'command -v php > /dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq php-cli php-mbstring php-xml php-curl php-zip unzip > /dev/null 2>&1)',
                    'command -v composer > /dev/null 2>&1 || (curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer)',
                ].join(' && ');
                const phpInstallResult = await this.execInContainer(
                    mainContainer,
                    ["sh", "-c", phpInstallScript],
                    mainWorkdir,
                    300_000
                );
                allOutput.push(phpInstallResult.output);
                if (phpInstallResult.exitCode !== 0) {
                    log.error("PHP/Composer installation failed");
                    return {
                        exitCode: phpInstallResult.exitCode,
                        stdout: allOutput.join("\n").slice(0, 50000),
                        stderr: "PHP/Composer installation failed",
                    };
                }
                log.info("✅ PHP + Composer installed");
            }
            
            if (detection.installCmd && detection.installCmd.length > 0) {
                // In remote mode, skip server dependency installation — only Python is needed for tests
                if (opts.executionMode === "remote") {
                    log.info(`⏭️ Skipping dependency installation (remote mode — tests target external API)`);
                } else {
                const installCmd = applyInstallScriptsPolicy(detection.installCmd, this.allowInstallScripts);
                log.info(`📦 Installing dependencies: ${installCmd.join(" ")}`);

                const installTimeoutMs = 600_000;
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
                            log.error(`Dependencies failed (npm ci + npm install both failed)`);
                            return {
                                exitCode: fallbackResult.exitCode,
                                stdout: allOutput.join("\n").slice(0, 50000),
                                stderr: "Dependency installation failed (both npm ci and npm install)",
                            };
                        }
                        log.info("✅ Dependencies installed (npm install fallback)");
                    } else {
                        log.error(`Dependencies failed: ${installCmd.join(" ")}`);
                        return {
                            exitCode: installResult.exitCode,
                            stdout: allOutput.join("\n").slice(0, 50000),
                            stderr: "Dependency installation failed",
                        };
                    }
                } else {
                    log.info("✅ Dependencies installed");
                }
                }
            }

            // Phase 4.2: Patch adjustment for Python tests
            // AI generates Python test files, no transformation needed
            let commands = [...opts.commands];

            // Adjust command paths relative to workdir
            // If workdir is /workspace/backend and command is "python backend/test.py",
            // it should become "python test.py" to avoid /workspace/backend/backend/test.py
            const workdirSubpath = mainWorkdir.replace(/^\/workspace\/?/, "");
            if (workdirSubpath) {
                commands = commands.map(cmd => {
                    // Replace "python3 backend/file.py" or "python backend/file.py" with "python file.py"
                    const pattern = new RegExp(`\\bpython3?\\s+${workdirSubpath}/`, 'g');
                    return cmd.replace(pattern, 'python ');
                });
            }

            // Write patches via putArchive (tar stream)
            if (opts.patches?.length) {
                await this.writePatchesToContainer(mainContainer, opts.patches, mainWorkdir);
                log.info(`Wrote ${opts.patches.length} patch(es) via putArchive`);
            }

            // Phase 4.2.4: Start database services if detected
            if (detectedDatabases.length > 0 && opts.executionMode !== "remote") {
                log.info(`🗄️ Starting database services: ${detectedDatabases.join(', ')}...`);
                await startDatabaseServices(this.execInContainer.bind(this), mainContainer, detectedDatabases, mainWorkdir);
            } else if (detectedDatabases.length > 0 && opts.executionMode === "remote") {
                log.info(`⏭️ Skipping database services (remote mode — using external API)`);
            }

            // Phase 4.2.5: Start server if needed (for API tests)
            let serverPort = 3001; // default
            if (shouldStartServer(commands, detection.language, opts.executionMode)) {
                log.info(`🚀 Starting server...`);
                const detected = await startServerInContainer(this.execInContainer.bind(this), mainContainer, mainWorkdir);
                if (detected > 0) {
                    serverPort = detected;
                    log.info(`✅ Server ready on port ${serverPort}`);
                } else {
                    log.warn(`⚠️ Server not detected on any port`);
                }

                // If server is on a different port than 3001, patch test files
                if (serverPort !== 3001) {
                    log.debug(`Patching test files: port 3001 → ${serverPort}`);
                    await this.execInContainer(
                        mainContainer,
                        ['sh', '-c', `find . -maxdepth 1 -name "*.py" -exec sed -i 's/localhost:3001/localhost:${serverPort}/g' {} +`],
                        mainWorkdir,
                        5000
                    );
                }
            }

            // Phase 4.3: Run each command via sh -c
            let lastExitCode = 0;
            const testResults: string[] = [];
            
            for (const cmd of commands) {
                // If server was started, verify it's still running before executing test
                if (shouldStartServer(commands, detection.language, opts.executionMode)) {
                    const serverReady = await verifyServerRunning(
                        this.execInContainer.bind(this), mainContainer, mainWorkdir, serverPort,
                    );

                    if (!serverReady) {
                        // verifyServerRunning already logs debug info
                    }
                }

                // Replace hardcoded port references in test commands
                let finalCmd = cmd;
                if (serverPort !== 3001) {
                    finalCmd = cmd.replace(/localhost:3001/g, `localhost:${serverPort}`);
                }

                // Only inject SERVER_PORT in sandbox mode — remote mode uses API_BASE_URL
                if (opts.executionMode !== "remote") {
                    finalCmd = `SERVER_PORT=${serverPort} ${finalCmd}`;
                }

                log.info(`▶ ${finalCmd}`);

                const result = await this.execInContainer(mainContainer, ["sh", "-c", finalCmd], mainWorkdir);
                allOutput.push(`>>> ${finalCmd}\n${result.output}`);
                testResults.push(`Command: ${finalCmd}\nExit Code: ${result.exitCode}\n\nOutput:\n${result.output}\n${'='.repeat(80)}\n`);
                lastExitCode = result.exitCode;

                if (result.exitCode !== 0) {
                    log.warn(`Command failed (exit ${result.exitCode}): ${finalCmd}`);
                    if (result.output) {
                        const lines = result.output.split('\n').slice(-10); // Last 10 lines
                        log.warn(`Output (last 10 lines):\n${lines.join('\n')}`);
                    }
                    break;
                }
            }
            
            // Phase 4.4: Write test results to a file
            if (testResults.length > 0) {
                const testResultsContent = `# Test Execution Results\n\nGenerated: ${new Date().toISOString()}\n\n${'='.repeat(80)}\n\n${testResults.join('\n')}`;
                const testResultsPath = 'test-results.md';
                
                log.debug(`Writing test results to ${testResultsPath}`);
                const writeCmd = `cat > ${testResultsPath} << 'EOF_TEST_RESULTS'\n${testResultsContent}\nEOF_TEST_RESULTS`;
                await this.execInContainer(mainContainer, ["sh", "-c", writeCmd], mainWorkdir);
            }

            log.info(`Container finished (exit: ${lastExitCode})`);

            // Phase 5: Capture new or modified files
            log.info(`Capturing generated artifacts...`);
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
                            log.debug(`Captured: ${file} (${action})`);
                        }
                    }
                }
            }
            
            // Always capture test-results.md if it exists (even if not tracked by git)
            const testResultsCheck = await this.execInContainer(mainContainer, ["test", "-f", "test-results.md"], mainWorkdir);
            if (testResultsCheck.exitCode === 0) {
                const testResultsContent = await this.execInContainer(mainContainer, ["cat", "test-results.md"], mainWorkdir);
                if (testResultsContent.exitCode === 0) {
                    // Check if already captured
                    const alreadyCaptured = capturedPatches.some(p => p.path === "test-results.md");
                    if (!alreadyCaptured) {
                        capturedPatches.push({
                            path: "test-results.md",
                            content: testResultsContent.output,
                            action: "create"
                        });
                        log.debug(`Captured: test-results.md`);
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
     * DEPRECATED: Module system detection (ESM vs CommonJS)
     * No longer needed since all API tests are now written in Python.
     * Kept for reference but not used in the execution pipeline.
     */
    // private async detectModuleSystemInContainer(
    //     container: Docker.Container,
    //     workdir: string,
    // ): Promise<boolean> {
    //     try {
    //         // Try workdir-specific package.json first (monorepo), then root
    //         const paths = workdir !== '/workspace'
    //             ? [`${workdir}/package.json`, '/workspace/package.json']
    //             : ['/workspace/package.json'];
    //
    //         for (const pkgPath of paths) {
    //             const result = await this.execInContainer(container, ['cat', pkgPath]);
    //             if (result.exitCode === 0 && result.output.trim()) {
    //                 try {
    //                     const pkg = JSON.parse(result.output);
    //                     if (pkg.type === 'module') {
    //                         log.info(`Detected ES module project (from ${pkgPath})`);
    //                         return true;
    //                     }
    //                 } catch {
    //                     // Invalid JSON, skip
    //                 }
    //             }
    //         }
    //     } catch (error) {
    //         log.warn(`Failed to detect module system: ${String(error)}`);
    //     }
    //
    //     return false;
    // }

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

}
