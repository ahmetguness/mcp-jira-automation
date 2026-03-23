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
        log.debug(`Docker executor initialized (image: ${this.configImage}, timeout: ${this.timeoutMs}ms)`);
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
            const detectedDatabases = await this.detectDatabaseDependencies(scoutContainer, detection.language);
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
            let targetImage: string;
            
            // CRITICAL: If environmentHint is "python", force Python image
            // This is needed because AI generates Python tests regardless of server language
            if (opts.environmentHint === "python") {
                targetImage = "python:3.12-bookworm";
            } else if (this.configImage !== "auto") {
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
                // Common 3rd-party service placeholders (Cloudinary, AWS S3, etc.)
                'CLOUDINARY_CLOUD_NAME=test-cloud',
                'CLOUDINARY_API_KEY=test-cloudinary-key',
                'CLOUDINARY_API_SECRET=test-cloudinary-secret',
                'AWS_ACCESS_KEY_ID=test-aws-key',
                'AWS_SECRET_ACCESS_KEY=test-aws-secret',
                'AWS_REGION=us-east-1',
                'S3_BUCKET=test-bucket',
                'STRIPE_SECRET_KEY=sk_test_fake_key',
                'STRIPE_PUBLISHABLE_KEY=pk_test_fake_key',
            );

            // Add database configuration if databases are detected
            if (detectedDatabases.length > 0) {
                const databaseEnvVars = this.generateDatabaseEnvironmentVariables(detectedDatabases);
                envVars.push(...databaseEnvVars);
            }

            // Always provide DATABASE_URL as a fallback if not already set by detection
            // Many apps require this env var and fail at startup without it
            const hasDbUrl = envVars.some(v => v.startsWith('DATABASE_URL='));
            const hasMongoUrl = envVars.some(v => v.startsWith('MONGODB_URL='));
            if (!hasDbUrl) {
                envVars.push('DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test');
            }
            if (!hasMongoUrl) {
                envVars.push('MONGODB_URL=mongodb://localhost:27017/test');
            }

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

            // Phase 4.1: Install dependencies
            // For Python test execution on Node.js projects, install Node.js and dependencies
            // so the server can run (Python tests make HTTP requests to it)
            if (opts.environmentHint === "python" && detection.language === "node") {
                log.info("📦 Installing Node.js in Python container...");
                const nodeInstallResult = await this.execInContainer(
                    mainContainer,
                    ["sh", "-c", "command -v node || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs) && npm install -g tsx"],
                    mainWorkdir,
                    300_000 // 5 minutes timeout
                );
                allOutput.push(nodeInstallResult.output);
                
                if (nodeInstallResult.exitCode !== 0) {
                    log.error("Node.js installation failed");
                    return {
                        exitCode: nodeInstallResult.exitCode,
                        stdout: allOutput.join("\n").slice(0, 50000),
                        stderr: "Node.js installation failed in Python container",
                    };
                }
                log.info("✅ Node.js installed");
            }
            
            if (detection.installCmd && detection.installCmd.length > 0) {
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
            if (detectedDatabases.length > 0) {
                log.info(`🗄️ Starting database services: ${detectedDatabases.join(', ')}...`);
                await this.startDatabaseServices(mainContainer, detectedDatabases, mainWorkdir);
            }

            // Phase 4.2.5: Start server if needed (for API tests)
            let serverPort = 3001; // default
            if (this.shouldStartServer(commands, detection.language)) {
                log.info(`🚀 Starting server...`);
                const detected = await this.startServerInContainer(mainContainer, mainWorkdir);
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
                if (this.shouldStartServer(commands, detection.language)) {
                    let serverReady = false;
                    for (let attempt = 0; attempt < 10; attempt++) {
                        const serverCheck = await this.execInContainer(
                            mainContainer,
                            ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:${serverPort}/ 2>/dev/null; echo ""`],
                            mainWorkdir,
                            5000
                        );
                        const httpCode = serverCheck.output.trim().split('\n').map(l => l.trim()).find(l => /^\d{3}$/.test(l)) ?? '000';
                        
                        if (httpCode !== '000') {
                            serverReady = true;
                            break;
                        }
                        
                        if (attempt < 9) {
                            log.debug(`Server not ready on port ${serverPort}, retrying... (${attempt + 1}/10)`);
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                    }
                    
                    if (!serverReady) {
                        log.error(`Server not responding on port ${serverPort} after 10 retries`);
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
  if kill -0 $PID 2>/dev/null; then echo "Process $PID is alive"; else echo "Process $PID is dead"; fi
else echo "No PID file"; fi
echo ""
echo "=== Listening Ports ==="
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Cannot check ports"
echo ""
echo "=== Node Processes ==="
ps aux | grep node | grep -v grep || echo "No node processes"
`],
                            mainWorkdir,
                            10000
                        );
                        log.error(`Server debug info:\n${debugInfo.output}`);
                    }
                }

                // Replace hardcoded port references in test commands
                let finalCmd = cmd;
                if (serverPort !== 3001) {
                    finalCmd = cmd.replace(/localhost:3001/g, `localhost:${serverPort}`);
                }
                finalCmd = `SERVER_PORT=${serverPort} ${finalCmd}`;

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

    /**
     * Determine if server startup is needed based on commands and language
     */
    private shouldStartServer(commands: string[], _language: string): boolean {
        // Enable server startup for Python tests (they make HTTP requests to localhost)
        return commands.some(cmd => cmd.includes('python') && cmd.includes('.py'));
    }

    /**
     * Start application server in container before running tests.
     * Returns the detected port the server is listening on.
     */
    private async startServerInContainer(
            container: Docker.Container,
            workdir: string
        ): Promise<number> {
            // Try multiple common ports — apps may ignore PORT env var
            const candidatePorts = [3001, 3000, 8080, 8000, 5000, 4000];

            // Create a startup script that properly captures all output
            const startupScript = String.raw`#!/bin/sh
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

    # Track attempted methods for diagnostics
    ATTEMPTED_METHODS=""

    # Stage 1: Check package.json for start script
    if [ -f "package.json" ]; then
      echo "Checking package.json for start script..."
      START_SCRIPT=$(cat package.json | grep -o '"start"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"start"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')

      if [ -n "$START_SCRIPT" ]; then
        echo "Found start script in package.json: $START_SCRIPT"
        ATTEMPTED_METHODS="package.json start script: $START_SCRIPT"

        # Check if start script references a dist/ file that doesn't exist
        # This happens when TypeScript projects haven't been built yet
        DIST_FILE=$(echo "$START_SCRIPT" | grep -o 'dist/[^ ]*' || true)
        if [ -n "$DIST_FILE" ] && [ ! -f "$DIST_FILE" ]; then
          echo "Start script references $DIST_FILE but it does not exist (TypeScript not built)"
          echo "Skipping package.json start script, will try tsx with source files instead"
          ATTEMPTED_METHODS="$ATTEMPTED_METHODS (skipped: dist not built)"
        else
          # Execute the start script
          eval "$START_SCRIPT" 2>&1 &
          SERVER_PID=$!
          echo $SERVER_PID > /tmp/server.pid
          echo "Server PID: $SERVER_PID"

          # Wait a moment to see if server crashes immediately
          sleep 3
          if kill -0 $SERVER_PID 2>/dev/null; then
            echo "Server started successfully using package.json start script"
            exit 0
          else
            echo "Server process died after starting with package.json script"
            ATTEMPTED_METHODS="$ATTEMPTED_METHODS (failed)"
          fi
        fi
      else
        echo "No start script found in package.json"
      fi
    fi

    # Stage 2: File system search with expanded patterns
    echo "Searching for server entry point..."
    FOUND_ENTRY_POINT=""
    ATTEMPTED_PATHS=""

    # Define location and filename patterns
    LOCATIONS=". src backend backend/src server server/src api api/src"
    FILENAMES="server.js server.ts index.js index.ts main.js main.ts start.js start.ts app.js app.ts"

    # Check standard locations first (for backward compatibility)
    for LOCATION in $LOCATIONS; do
      for FILENAME in $FILENAMES; do
        if [ "$LOCATION" = "." ]; then
          ENTRY_PATH="$FILENAME"
        else
          ENTRY_PATH="$LOCATION/$FILENAME"
        fi

        ATTEMPTED_PATHS="$ATTEMPTED_PATHS $ENTRY_PATH"

        if [ -f "$ENTRY_PATH" ]; then
          echo "Found server entry point: $ENTRY_PATH"
          FOUND_ENTRY_POINT="$ENTRY_PATH"
          break 2
        fi
      done
    done

    # Check packages/* pattern for monorepos
    if [ -z "$FOUND_ENTRY_POINT" ] && [ -d "packages" ]; then
      echo "Checking packages/* for monorepo structure..."
      for PKG_DIR in packages/*; do
        if [ -d "$PKG_DIR" ]; then
          for FILENAME in $FILENAMES; do
            # Check packages/*/filename
            ENTRY_PATH="$PKG_DIR/$FILENAME"
            ATTEMPTED_PATHS="$ATTEMPTED_PATHS $ENTRY_PATH"
            if [ -f "$ENTRY_PATH" ]; then
              echo "Found server entry point: $ENTRY_PATH"
              FOUND_ENTRY_POINT="$ENTRY_PATH"
              break 2
            fi

            # Check packages/*/src/filename
            ENTRY_PATH="$PKG_DIR/src/$FILENAME"
            ATTEMPTED_PATHS="$ATTEMPTED_PATHS $ENTRY_PATH"
            if [ -f "$ENTRY_PATH" ]; then
              echo "Found server entry point: $ENTRY_PATH"
              FOUND_ENTRY_POINT="$ENTRY_PATH"
              break 2
            fi
          done
        fi
      done
    fi

    # Start the server if entry point was found
    if [ -n "$FOUND_ENTRY_POINT" ]; then
      echo "Starting server with: $FOUND_ENTRY_POINT"
      ATTEMPTED_METHODS="$ATTEMPTED_METHODS, file search: $FOUND_ENTRY_POINT"
      
      # Check if it's a TypeScript file
      case "$FOUND_ENTRY_POINT" in
        *.ts)
          echo "TypeScript file detected, using tsx"
          npx -y tsx "$FOUND_ENTRY_POINT" 2>&1 &
          ;;
        *)
          node "$FOUND_ENTRY_POINT" 2>&1 &
          ;;
      esac
      
      SERVER_PID=$!
      echo $SERVER_PID > /tmp/server.pid
      echo "Server PID: $SERVER_PID"

      # Wait longer for TypeScript compilation + server init (tsx needs more time)
      sleep 5
      if kill -0 $SERVER_PID 2>/dev/null; then
        echo "Server started successfully using file search"
        exit 0
      else
        echo "Server process died after starting with file search"
        ATTEMPTED_METHODS="$ATTEMPTED_METHODS (failed)"
      fi
    fi

    # Stage 3: Fallback with require pattern (for backward compatibility)
    echo "No entry point found via file search, trying require pattern"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, require pattern: require('./src/app').listen(3001)"
    node -e "require('./src/app').listen(3001)" 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID > /tmp/server.pid
    echo "Server PID: $SERVER_PID"

    # Wait a moment to see if server crashes immediately
    sleep 2
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      echo "=========================================="
      echo "ERROR: All server startup attempts failed"
      echo "=========================================="
      echo ""
      echo "Stage 1 - Package.json Script Discovery:"
      if [ -f "package.json" ]; then
        if echo "$ATTEMPTED_METHODS" | grep -q "package.json start script"; then
          echo "  ✗ Found start script but server process died"
        else
          echo "  ✗ No start script found in package.json"
        fi
      else
        echo "  ✗ No package.json file found"
      fi
      echo ""
      echo "Stage 2 - File System Search:"
      echo "  ✗ No valid server entry point found"
      echo "  Attempted paths:"
      for PATH_ITEM in $ATTEMPTED_PATHS; do
        echo "    - $PATH_ITEM"
      done
      echo ""
      echo "Stage 3 - Require Pattern Fallback:"
      echo "  ✗ Server process died immediately after starting"
      echo "  This usually means the app crashed during initialization"
      echo ""
      echo "Summary of attempted methods:"
      echo "$ATTEMPTED_METHODS"
      echo ""
      echo "=========================================="
      echo "Troubleshooting suggestions:"
      echo "1. Ensure your server entry point is in one of the searched locations"
      echo "2. Add a 'start' script to package.json pointing to your server file"
      echo "3. Check that your server file exports a valid Express/HTTP server"
      echo "4. Review server logs above for initialization errors"
      echo "=========================================="
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
                    ['sh', '-c', `/tmp/start-server.sh`],
                    workdir,
                    30000
                );

                // Give server more time to start (TypeScript compilation + Prisma init can be slow)
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Wait for server to become ready — try multiple ports since apps may ignore PORT env var
                let detectedPort = 0;
                for (const candidatePort of candidatePorts) {
                    const isReady = await this.waitForServerReady(container, candidatePort, 10000);
                    if (isReady) {
                        detectedPort = candidatePort;
                        break;
                    }
                }

                // If no port found yet, do a longer wait
                if (detectedPort === 0) {
                    log.debug('Extended port scan...');
                    for (let attempt = 0; attempt < 15; attempt++) {
                        // Try each candidate port with curl
                        for (const candidatePort of candidatePorts) {
                            try {
                                const check = await this.execInContainer(
                                    container,
                                    ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 http://localhost:${candidatePort}/ 2>/dev/null; echo ""`],
                                    undefined,
                                    3000
                                );
                                const code = check.output.trim().split('\n').map(l => l.trim()).find(l => /^\d{3}$/.test(l)) ?? '000';
                                if (code !== '000') {
                                    detectedPort = candidatePort;
                                    log.debug(`Server found on port ${candidatePort} (HTTP ${code})`);
                                    break;
                                }
                            } catch { /* continue */ }
                        }
                        if (detectedPort > 0) break;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                if (detectedPort > 0) {
                    await this.execInContainer(
                        container,
                        ['sh', '-c', `echo ${detectedPort} > /tmp/server-port`],
                        workdir,
                        5000
                    );
                    return detectedPort;
                } else {
                    // Get server logs for debugging
                    const logsResult = await this.execInContainer(
                        container,
                        ['sh', '-c', 'cat /tmp/server.log 2>/dev/null || echo "No server logs"'],
                        workdir,
                        5000
                    );
                    log.warn(`Could not start server. Server logs:\n${logsResult.output}`);
                    return 0;
                }
            } catch (error) {
                log.warn(`Server startup failed: ${(error as Error).message}`);
                return 0;
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
                // Use --connect-timeout to fail fast, and capture only the HTTP code
                const result = await this.execInContainer(
                    container,
                    ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:${port}/ 2>/dev/null; echo ""`],
                    undefined,
                    5000
                );

                // Extract only the last 3-digit number from output (the HTTP code)
                const lines = result.output.trim().split('\n');
                const lastLine = lines[lines.length - 1]?.trim() ?? '';
                // curl writes http_code then our echo adds empty line; get the code
                const httpCode = lines.map(l => l.trim()).find(l => /^\d{3}$/.test(l)) ?? '000';
                
                if (httpCode !== '000') {
                    log.debug(`waitForServerReady: port ${port} responded with HTTP ${httpCode}`);
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
            // Direct database drivers
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
            // Prisma — actual DB determined by schema, default to postgresql
            'prisma': 'postgresql',
            '@prisma/client': 'postgresql',
        };

        // ORM packages that need a driver to determine the actual database
        // These are checked separately — if a specific driver is also present, that takes priority
        const nodeOrmPackages = ['sequelize', 'typeorm', 'knex', 'drizzle-orm'];

        // Python database packages mapping
        const pythonDatabasePackages: Record<string, string> = {
            'pymongo': 'mongodb',
            'motor': 'mongodb',
            'mongoengine': 'mongodb',
            'psycopg2': 'postgresql',
            'psycopg2-binary': 'postgresql',
            'asyncpg': 'postgresql',
            'mysql-connector-python': 'mysql',
            'mysqlclient': 'mysql',
            'PyMySQL': 'mysql',
            'redis': 'redis',
            'aioredis': 'redis',
            'sqlalchemy': 'postgresql',
            'django': 'postgresql',
            'tortoise-orm': 'postgresql',
            'peewee': 'sqlite',
            'databases': 'postgresql',
        };

        try {
            if (language === 'node') {
                // Check package.json for Node.js dependencies
                // Search in multiple locations to support monorepo structures
                const packageJsonPaths = [
                    '/workspace/package.json',
                    '/workspace/backend/package.json',
                    '/workspace/server/package.json',
                    '/workspace/api/package.json',
                ];

                for (const pkgPath of packageJsonPaths) {
                    const result = await this.execInContainer(container, ['cat', pkgPath]);
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
                                    log.debug(`Detected ${dbType} dependency: ${packageName} (from ${pkgPath})`);
                                }
                            }

                            // For ORM packages without a specific driver, infer the database
                            // If an ORM is present but no direct driver was detected, default to postgresql
                            for (const ormPkg of nodeOrmPackages) {
                                if (allDeps[ormPkg] && detectedDatabases.size === 0) {
                                    detectedDatabases.add('postgresql');
                                    log.debug(`ORM ${ormPkg} detected without specific driver, defaulting to postgresql (from ${pkgPath})`);
                                }
                            }
                        } catch (error) {
                            log.warn(`Failed to parse ${pkgPath}`, { error });
                        }
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
                testUrl: 'postgresql://postgres:postgres@localhost:5432/test',
            },
            'mysql': {
                envVarName: 'MYSQL_URL',
                testUrl: 'mysql://root:root@localhost:3306/test',
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

    /**
     * Start database services inside the container for detected databases.
     * Installs and starts PostgreSQL/MongoDB/MySQL/Redis as needed so the
     * application server can connect to them during test execution.
     */
    private async startDatabaseServices(
        container: Docker.Container,
        detectedDatabases: string[],
        workdir: string
    ): Promise<void> {
        for (const dbType of detectedDatabases) {
            try {
                switch (dbType) {
                    case 'postgresql':
                        await this.startPostgreSQL(container, workdir);
                        break;
                    case 'mongodb':
                        await this.startMongoDB(container, workdir);
                        break;
                    case 'mysql':
                        await this.startMySQL(container, workdir);
                        break;
                    case 'redis':
                        await this.startRedis(container, workdir);
                        break;
                    case 'sqlite':
                        log.info('SQLite detected — no service to start (file-based)');
                        break;
                    default:
                        log.warn(`Unknown database type: ${dbType} — skipping`);
                }
            } catch (error) {
                log.warn(`Failed to start ${dbType} service: ${(error as Error).message}`);
            }
        }

        // Run ORM migrations/schema sync after all databases are up
        await this.runOrmSetup(container, workdir);
    }

    private async startPostgreSQL(container: Docker.Container, workdir: string): Promise<void> {
        const result = await this.execInContainer(
            container,
            ['sh', '-c', [
                'apt-get update -qq',
                'apt-get install -y -qq postgresql postgresql-client > /dev/null 2>&1',
                'mkdir -p /run/postgresql && chown postgres:postgres /run/postgresql',
                'su postgres -c "pg_ctlcluster 15 main start" 2>/dev/null || su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl -D /var/lib/postgresql/*/main start -l /tmp/pg.log"',
                'for i in $(seq 1 10); do su postgres -c "pg_isready" && break || sleep 1; done',
                'su postgres -c "psql -c \\"CREATE DATABASE test;\\" 2>/dev/null || true"',
                'su postgres -c "psql -c \\"ALTER USER postgres PASSWORD \'postgres\';\\" 2>/dev/null || true"',
                'echo "PostgreSQL started successfully"',
            ].join(' && ')],
            workdir,
            120000
        );
        this.logDbResult(result, 'PostgreSQL');
    }

    private async startMongoDB(container: Docker.Container, workdir: string): Promise<void> {
        const result = await this.execInContainer(
            container,
            ['sh', '-c', [
                'apt-get update -qq',
                // Install mongosh and mongod via official repo
                'apt-get install -y -qq gnupg curl > /dev/null 2>&1',
                'curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg',
                'echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list',
                'apt-get update -qq',
                'apt-get install -y -qq mongodb-org > /dev/null 2>&1',
                'mkdir -p /data/db /var/log/mongodb',
                'mongod --dbpath /data/db --logpath /var/log/mongodb/mongod.log --fork --bind_ip 127.0.0.1',
                // Wait for MongoDB to be ready
                'for i in $(seq 1 15); do mongosh --eval "db.runCommand({ping:1})" --quiet > /dev/null 2>&1 && break || sleep 1; done',
                'echo "MongoDB started successfully"',
            ].join(' && ')],
            workdir,
            180000 // 3 minutes — MongoDB install is larger
        );
        this.logDbResult(result, 'MongoDB');
    }

    private async startMySQL(container: Docker.Container, workdir: string): Promise<void> {
        const result = await this.execInContainer(
            container,
            ['sh', '-c', [
                'apt-get update -qq',
                'apt-get install -y -qq mariadb-server mariadb-client > /dev/null 2>&1',
                'mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld',
                'mysqld_safe --skip-grant-tables &',
                // Wait for MySQL to be ready
                'for i in $(seq 1 15); do mysqladmin ping --silent 2>/dev/null && break || sleep 1; done',
                // Create test database and set root password
                'mysql -e "CREATE DATABASE IF NOT EXISTS test;" 2>/dev/null || true',
                'mysql -e "ALTER USER \'root\'@\'localhost\' IDENTIFIED BY \'root\'; FLUSH PRIVILEGES;" 2>/dev/null || true',
                'echo "MySQL (MariaDB) started successfully"',
            ].join(' && ')],
            workdir,
            120000
        );
        this.logDbResult(result, 'MySQL');
    }

    private async startRedis(container: Docker.Container, workdir: string): Promise<void> {
        const result = await this.execInContainer(
            container,
            ['sh', '-c', [
                'apt-get update -qq',
                'apt-get install -y -qq redis-server > /dev/null 2>&1',
                'redis-server --daemonize yes',
                'for i in $(seq 1 5); do redis-cli ping 2>/dev/null | grep -q PONG && break || sleep 1; done',
                'echo "Redis started successfully"',
            ].join(' && ')],
            workdir,
            60000
        );
        this.logDbResult(result, 'Redis');
    }

    /**
     * Detect and run ORM-specific setup commands (migrations, schema push, etc.)
     * Supports: Prisma, TypeORM, Sequelize, Knex, Drizzle, Mongoose (no-op)
     */
    private async runOrmSetup(container: Docker.Container, workdir: string): Promise<void> {
        // Check which ORM tools are available by looking at node_modules/.bin and config files
        const ormCheck = await this.execInContainer(
            container,
            ['sh', '-c', [
                'echo "---PRISMA---"',
                'test -f node_modules/.bin/prisma && echo "yes" || echo "no"',
                'echo "---TYPEORM---"',
                'test -f node_modules/.bin/typeorm && echo "yes" || echo "no"',
                'echo "---SEQUELIZE---"',
                'test -f node_modules/.bin/sequelize && echo "yes" || echo "no"',
                'echo "---KNEX---"',
                'test -f node_modules/.bin/knex && echo "yes" || echo "no"',
                'echo "---DRIZZLE---"',
                'test -f node_modules/.bin/drizzle-kit && echo "yes" || echo "no"',
                'echo "---MONGOOSE---"',
                // Mongoose doesn't need migrations — just check if it's installed
                'test -d node_modules/mongoose && echo "yes" || echo "no"',
            ].join(' && ')],
            workdir,
            5000
        );

        const output = ormCheck.output;
        const hasOrm = (marker: string) => {
            const idx = output.indexOf(marker);
            if (idx === -1) return false;
            const after = output.slice(idx + marker.length).trim();
            return after.startsWith('yes');
        };

        if (hasOrm('---PRISMA---')) {
            log.info('Running Prisma setup...');
            // Read prisma schema to detect actual database provider
            const schemaCheck = await this.execInContainer(
                container,
                ['sh', '-c', 'cat prisma/schema.prisma 2>/dev/null || cat schema.prisma 2>/dev/null || echo ""'],
                workdir,
                5000
            );
            const schemaContent = schemaCheck.output;
            let prismaProvider = 'postgresql'; // default
            if (schemaContent.includes('provider = "mysql"') || schemaContent.includes("provider = 'mysql'")) {
                prismaProvider = 'mysql';
            } else if (schemaContent.includes('provider = "mongodb"') || schemaContent.includes("provider = 'mongodb'")) {
                prismaProvider = 'mongodb';
            } else if (schemaContent.includes('provider = "sqlite"') || schemaContent.includes("provider = 'sqlite'")) {
                prismaProvider = 'sqlite';
            }
            log.debug(`Prisma provider: ${prismaProvider}`);

            const result = await this.execInContainer(
                container,
                ['sh', '-c', 'npx prisma generate 2>&1 && npx prisma db push --skip-generate --accept-data-loss 2>&1'],
                workdir,
                60000
            );
            if (result.exitCode === 0) {
                log.info('✅ Prisma schema pushed');
            } else {
                log.warn(`Prisma setup failed: ${result.output.slice(0, 200)}`);
            }
        }

        if (hasOrm('---TYPEORM---')) {
            log.info('Running TypeORM schema sync...');
            const result = await this.execInContainer(
                container,
                ['sh', '-c', 'npx typeorm schema:sync 2>&1 || npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js schema:sync 2>&1'],
                workdir,
                60000
            );
            if (result.exitCode === 0) {
                log.info('✅ TypeORM synced');
            } else {
                log.warn(`TypeORM sync failed: ${result.output.slice(0, 200)}`);
            }
        }

        if (hasOrm('---SEQUELIZE---')) {
            log.info('Running Sequelize migrations...');
            const result = await this.execInContainer(
                container,
                ['sh', '-c', 'npx sequelize-cli db:migrate 2>&1 || echo "Sequelize migration skipped"'],
                workdir,
                60000
            );
            if (result.exitCode === 0) {
                log.info('✅ Sequelize migrations done');
            } else {
                log.warn(`Sequelize migration failed: ${result.output.slice(0, 200)}`);
            }
        }

        if (hasOrm('---KNEX---')) {
            log.info('Running Knex migrations...');
            const result = await this.execInContainer(
                container,
                ['sh', '-c', 'npx knex migrate:latest 2>&1 || echo "Knex migration skipped"'],
                workdir,
                60000
            );
            if (result.exitCode === 0) {
                log.info('✅ Knex migrations done');
            } else {
                log.warn(`Knex migration failed: ${result.output.slice(0, 200)}`);
            }
        }

        if (hasOrm('---DRIZZLE---')) {
            log.info('Running Drizzle push...');
            const result = await this.execInContainer(
                container,
                ['sh', '-c', 'npx drizzle-kit push 2>&1 || echo "Drizzle push skipped"'],
                workdir,
                60000
            );
            if (result.exitCode === 0) {
                log.info('✅ Drizzle schema pushed');
            } else {
                log.warn(`Drizzle push failed: ${result.output.slice(0, 200)}`);
            }
        }

        if (hasOrm('---MONGOOSE---')) {
            log.debug('Mongoose detected — no migration needed');
        }
    }

    private logDbResult(result: { exitCode: number; output: string }, name: string): void {
        if (result.exitCode === 0) {
            log.info(`${name} service started successfully`);
        } else {
            log.warn(`${name} setup exited with code ${result.exitCode}: ${result.output.slice(0, 300)}`);
        }
    }

    /**
     * DEPRECATED: Transform CommonJS syntax to ES module syntax
     * No longer needed since all API tests are now written in Python.
     * Kept for reference but not used in the execution pipeline.
     */
    // private transformCommonJSToESM(content: string): string {
    //     let transformed = content;
    //
    //     // First, handle dynamic require() inside arrow functions
    //     // Pattern: () => { const app = require('./path'); ... }
    //     // We need to match the arrow function signature and add async keyword
    //     transformed = transformed.replace(
    //         /(\([\w\s,]*\)\s*=>\s*\{[^}]*)(const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?\s*return\s+\3\.listen)/g,
    //         "async $1const { default: $3 } = await import('$4'); return $3.listen"
    //     );
    //
    //     // Transform top-level require() statements to import statements
    //     // Pattern: const varName = require('module'); (at start of line or after newline)
    //     transformed = transformed.replace(
    //         /(^|\n)const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g,
    //         "$1import $2 from '$3';"
    //     );
    //
    //     // Pattern: const { named } = require('module'); (at start of line or after newline)
    //     transformed = transformed.replace(
    //         /(^|\n)const\s+\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\);?/g,
    //         "$1import {$2} from '$3';"
    //     );
    //
    //     // Pattern: require('module') without assignment (side effects)
    //     transformed = transformed.replace(
    //         /(^|\n)require\(['"]([^'"]+)['"]\);?/g,
    //         "$1import '$2';"
    //     );
    //
    //     // Transform module.exports to export default
    //     transformed = transformed.replace(
    //         /module\.exports\s*=\s*/g,
    //         "export default "
    //     );
    //
    //     // Transform exports.name = value to export const name = value
    //     transformed = transformed.replace(
    //         /exports\.(\w+)\s*=\s*/g,
    //         "export const $1 = "
    //     );
    //
    //     // Add .js extension to relative imports if missing (required for ESM)
    //     // Pattern: from './path' or from "../path" without extension
    //     transformed = transformed.replace(
    //         /from\s+['"](\.\.[/\\][^'"]+|\.\/[^'"]+)['"];/g,
    //         (match, path) => {
    //             // Only add .js if no extension present
    //             if (!path.match(/\.\w+$/)) {
    //                 return `from '${path}.js';`;
    //             }
    //             return match;
    //         }
    //     );
    //
    //     // Also handle await import() paths
    //     transformed = transformed.replace(
    //         /import\(['"](\.\.[/\\][^'"]+|\.\/[^'"]+)['"]\)/g,
    //         (match, path) => {
    //             // Only add .js if no extension present
    //             if (!path.match(/\.\w+$/)) {
    //                 return `import('${path}.js')`;
    //             }
    //             return match;
    //         }
    //     );
    //
    //     return transformed;
    // }
}


