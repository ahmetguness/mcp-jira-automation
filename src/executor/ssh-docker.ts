/**
 * SSH Docker executor.
 *
 * Runs the generated test commands on a remote machine over SSH. The remote
 * machine is expected to have git and Docker available for the configured user.
 */

import { execFile } from "node:child_process";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";
import { validateBranchName, validatePatchPath, validateRepoUrl } from "../sanitize.js";
import { buildContainerEnv, parseContainerTestEnv } from "./container-env.js";
import { detectProject, getAllMarkerFiles } from "./project-detector.js";
import type { CommandExecutor, ExecutorRunResult } from "./runner.js";

const log = createLogger("executor:ssh-docker");

interface ProcessResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export class SshDockerExecutor implements CommandExecutor {
    private host: string;
    private port: number;
    private user: string;
    private privateKeyPath?: string;
    private remoteWorkdir: string;
    private timeoutMs: number;
    private connectTimeoutSec: number;
    private configImage: string;
    private cleanupWorkspace: boolean;
    private removeImage: boolean;
    private containerTestEnv: Record<string, string>;
    /** ControlMaster socket path for SSH connection multiplexing */
    private controlPath: string;

    constructor(config: Config) {
        if (!config.sshHost || !config.sshUser) {
            throw new Error("SSH executor requires SSH_HOST and SSH_USER");
        }

        this.host = config.sshHost;
        this.port = config.sshPort;
        this.user = config.sshUser;
        this.privateKeyPath = config.sshPrivateKeyPath;
        this.remoteWorkdir = normalizeRemoteBase(config.sshRemoteWorkdir);
        this.timeoutMs = config.execTimeoutMs;
        this.connectTimeoutSec = Math.max(1, Math.ceil(config.sshConnectTimeoutMs / 1000));
        this.configImage = config.dockerImage;
        this.cleanupWorkspace = config.sshCleanupWorkspace;
        this.removeImage = config.sshRemoveImage;
        this.containerTestEnv = parseContainerTestEnv(config.containerTestEnv);
        // Use OS temp dir for control socket — unique per executor instance
        this.controlPath = `/tmp/mcp-ssh-ctl-${this.user}-${this.host}-${this.port}-${process.pid}`;

        log.debug(`SSH Docker executor initialized (${this.user}@${this.host}:${this.port}, workdir: ${this.remoteWorkdir})`);
    }

    async checkConnection(): Promise<boolean> {
        const result = await this.ssh("docker info >/dev/null 2>&1 && git --version >/dev/null 2>&1");
        if (result.exitCode !== 0) {
            log.error(`Remote Docker/git check failed: ${result.stderr || result.stdout}`);
            return false;
        }
        return true;
    }

    async run(opts: {
        repoUrl: string;
        branch: string;
        commands: string[];
        patches?: { path: string; content: string }[];
        environmentHint?: string;
        executionMode?: "remote" | "sandbox";
        apiBaseUrl?: string;
        credentials?: Record<string, string>;
    }): Promise<ExecutorRunResult> {
        const safeRepoUrl = validateRepoUrl(opts.repoUrl);
        const safeBranch = validateBranchName(opts.branch);
        const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const remoteRoot = `${this.remoteWorkdir}/${runId}`;
        const remoteRepo = `${remoteRoot}/repo`;
        const containerName = `mcp-ssh-${runId}`;
        let imageName = this.configImage === "auto" ? "node:20-bookworm" : this.configImage;
        const output: string[] = [];

        // Open a persistent SSH ControlMaster connection for this run
        // ControlMaster is only supported on Linux/macOS — skip on Windows
        const useControlMaster = process.platform !== "win32";
        if (useControlMaster) await this.openControlMaster();

        try {
            log.info(`Creating remote workspace ${remoteRoot}`);
            await this.mustSsh(`mkdir -p ${shq(remoteRoot)}`);

            const clone = await this.ssh(
                `git clone --depth 1 --branch ${shq(safeBranch)} ${shq(safeRepoUrl)} ${shq(remoteRepo)}`
            );
            output.push(clone.stdout, clone.stderr);
            if (clone.exitCode !== 0) {
                log.warn("Remote branch clone failed, retrying without --branch");
                const fallback = await this.ssh(
                    `rm -rf ${shq(remoteRepo)} && git clone --depth 1 ${shq(safeRepoUrl)} ${shq(remoteRepo)}`
                );
                output.push(fallback.stdout, fallback.stderr);
                if (fallback.exitCode !== 0) {
                    return {
                        exitCode: fallback.exitCode,
                        stdout: truncate(output.join("\n")),
                        stderr: "Remote git clone failed",
                    };
                }
            }

            const markers = await this.findProjectMarkers(remoteRepo);
            const detection = detectProject(markers, opts.environmentHint);
            const workdir = detection.workdir;
            if (this.configImage === "auto") {
                imageName = detection.image;
            }
            log.info(`Remote container: ${imageName} | workdir: ${workdir} | lang: ${detection.language}`);

            if (opts.patches?.length) {
                await this.uploadPatches(remoteRepo, workdir, opts.patches);
                log.info(`Uploaded ${opts.patches.length} patch(es) to remote workspace`);
            }

            const envVars = buildContainerEnv({
                language: detection.language,
                executionMode: opts.executionMode,
                apiBaseUrl: opts.apiBaseUrl,
                credentials: opts.credentials,
                detectedDatabases: [],
                databaseEnvVars: [],
                testEnvOverrides: this.containerTestEnv,
            });

            let lastExitCode = 0;
            const testResults: string[] = [];

            for (const cmd of opts.commands) {
                const dockerCmd = this.buildDockerRunCommand({
                    containerName,
                    imageName,
                    remoteRepo,
                    workdir,
                    envVars,
                    command: cmd,
                });

                log.info(`Remote ▶ ${cmd}`);
                const result = await this.ssh(dockerCmd, this.timeoutMs + 30_000);
                output.push(`>>> ${cmd}\n${result.stdout}${result.stderr}`);
                testResults.push(`Command: ${cmd}\nExit Code: ${result.exitCode}\n\nOutput:\n${result.stdout}${result.stderr}\n${"=".repeat(80)}\n`);
                lastExitCode = result.exitCode;

                if (result.exitCode !== 0) {
                    log.warn(`Remote command failed (exit ${result.exitCode}): ${cmd}`);
                    break;
                }
            }

            const capturedPatches = await this.captureChangedFiles(remoteRepo);
            if (testResults.length > 0 && !capturedPatches.some((p) => p.path === "test-results.md")) {
                const rawTestOutput = testResults.join("\n");
                capturedPatches.push({
                    path: "test-results.md",
                    content: formatTestResultsReport(rawTestOutput),
                    action: "create",
                });
            }

            return {
                exitCode: lastExitCode,
                stdout: truncate(output.join("\n")),
                stderr: "",
                patches: capturedPatches,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`Remote execution failed: ${message}`);
            return {
                exitCode: 1,
                stdout: truncate(output.join("\n")),
                stderr: message,
            };
        } finally {
            await this.cleanup(remoteRoot, containerName, imageName);
            if (process.platform !== "win32") await this.closeControlMaster();
        }
    }

    private buildDockerRunCommand(opts: {
        containerName: string;
        imageName: string;
        remoteRepo: string;
        workdir: string;
        envVars: string[];
        command: string;
    }): string {
        const envArgs = opts.envVars.map((entry) => `-e ${shq(entry)}`).join(" ");
        const setup = [
            "if ! command -v curl >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq curl >/dev/null 2>&1; fi",
            "if ! command -v python3 >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq python3 >/dev/null 2>&1; fi",
            "if ! command -v python >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then ln -sf $(command -v python3) /usr/local/bin/python; fi",
        ].join(" && ");
        const inner = `${setup} && ${opts.command}`;

        return [
            `docker rm -f ${shq(opts.containerName)} >/dev/null 2>&1 || true`,
            "&&",
            "docker run",
            `--name ${shq(opts.containerName)}`,
            "--rm",
            `-v ${shq(`${opts.remoteRepo}:/workspace`)}`,
            `-w ${shq(opts.workdir)}`,
            envArgs,
            shq(opts.imageName),
            "sh -lc",
            shq(inner),
        ].filter(Boolean).join(" ");
    }

    private async findProjectMarkers(remoteRepo: string): Promise<string[]> {
        const names = getAllMarkerFiles().map((name) => `-name ${shq(name)}`).join(" -o ");
        const command = `cd ${shq(remoteRepo)} && find . -maxdepth 3 \\( ${names} \\) -type f | sed 's#^./##'`;
        const result = await this.ssh(command);
        if (result.exitCode !== 0) return [];
        return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }

    private async uploadPatches(
        remoteRepo: string,
        workdir: string,
        patches: { path: string; content: string }[],
    ): Promise<void> {
        for (const patch of patches) {
            const safePath = validatePatchPath(patch.path);
            const finalPath = adjustPatchPathForWorkdir(safePath, workdir);
            const remoteFile = `${remoteRepo}/${finalPath}`;
            const remoteDir = remoteFile.split("/").slice(0, -1).join("/");
            const contentBase64 = Buffer.from(patch.content, "utf-8").toString("base64");
            const result = await this.ssh(
                `mkdir -p ${shq(remoteDir)} && base64 -d > ${shq(remoteFile)}`,
                this.timeoutMs,
                contentBase64,
            );

            if (result.exitCode !== 0) {
                throw new Error(result.stderr || result.stdout || `Failed to upload patch ${patch.path}`);
            }
        }
    }

    private async captureChangedFiles(remoteRepo: string): Promise<{ path: string; content: string; action: "create" | "modify" }[]> {
        const status = await this.ssh(`cd ${shq(remoteRepo)} && git status --porcelain`);
        if (status.exitCode !== 0 || !status.stdout.trim()) return [];

        const patches: { path: string; content: string; action: "create" | "modify" }[] = [];
        for (const line of status.stdout.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const statusCode = line.slice(0, 2);
            const file = line.slice(3).trim();
            if (!file || file.includes(" -> ")) continue;

            let action: "create" | "modify" | null = null;
            if (statusCode === "??") action = "create";
            else if (statusCode.includes("M") || statusCode.includes("A")) action = "modify";
            if (!action) continue;

            const safePath = validatePatchPath(file);
            const content = await this.ssh(`cd ${shq(remoteRepo)} && cat ${shq(safePath)}`);
            if (content.exitCode === 0) {
                patches.push({ path: safePath, content: content.stdout, action });
            }
        }

        return patches;
    }

    private async cleanup(remoteRoot: string, containerName: string, imageName: string): Promise<void> {
        const tasks = [
            `docker rm -f ${shq(containerName)} >/dev/null 2>&1 || true`,
        ];

        if (this.removeImage && imageName) {
            tasks.push(`docker rmi -f ${shq(imageName)} >/dev/null 2>&1 || true`);
        }

        if (this.cleanupWorkspace) {
            tasks.push(
                `case ${shq(remoteRoot)} in ${shq(this.remoteWorkdir)}/*) rm -rf ${shq(remoteRoot)} ;; *) echo "Refusing to remove unsafe remote path" >&2 ;; esac`
            );
        }

        await this.ssh(tasks.join(" && ")).catch(() => undefined);
    }

    private async mustSsh(command: string): Promise<ProcessResult> {
        const result = await this.ssh(command);
        if (result.exitCode !== 0) {
            throw new Error(result.stderr || result.stdout || `SSH command failed: ${command}`);
        }
        return result;
    }

    private ssh(command: string, timeoutMs = this.timeoutMs, input?: string): Promise<ProcessResult> {
        return runProcess("ssh", [...this.baseSshArgs(), this.target, command], timeoutMs, input);
    }

    private baseSshArgs(): string[] {
        const args = [
            "-p", String(this.port),
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", `ConnectTimeout=${this.connectTimeoutSec}`,
        ];
        // ControlMaster multiplexing is only supported on Linux/macOS
        if (process.platform !== "win32") {
            args.push(
                "-o", `ControlPath=${this.controlPath}`,
                "-o", "ControlMaster=auto",
            );
        }
        if (this.privateKeyPath) args.push("-i", this.privateKeyPath);
        return args;
    }

    /** Open a persistent ControlMaster connection to reuse across SSH calls */
    private async openControlMaster(): Promise<void> {
        const args = [
            "-p", String(this.port),
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", `ConnectTimeout=${this.connectTimeoutSec}`,
            "-o", `ControlPath=${this.controlPath}`,
            "-o", "ControlMaster=yes",
            "-o", "ControlPersist=60",  // keep alive 60s after last use
            "-N",  // don't execute a command, just open the tunnel
        ];
        if (this.privateKeyPath) args.push("-i", this.privateKeyPath);
        args.push(this.target);

        // Fire-and-forget: the process stays alive in background
        // We give it 5s to establish; if it fails, subsequent ssh calls fall back to normal
        const result = await runProcess("ssh", args, 5_000);
        if (result.exitCode !== 0 && result.exitCode !== null) {
            log.debug(`ControlMaster setup returned ${result.exitCode} — subsequent calls will use direct connections`);
        } else {
            log.debug(`SSH ControlMaster established (${this.controlPath})`);
        }
    }

    /** Close the ControlMaster connection */
    private async closeControlMaster(): Promise<void> {
        const args = [
            "-p", String(this.port),
            "-o", `ControlPath=${this.controlPath}`,
            "-O", "exit",
            this.target,
        ];
        await runProcess("ssh", args, 5_000).catch(() => undefined);
    }

    private get target(): string {
        return `${this.user}@${this.host}`;
    }
}

function runProcess(file: string, args: string[], timeoutMs: number, input?: string): Promise<ProcessResult> {
    return new Promise((resolve) => {
        const child = execFile(file, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            const maybeCode = typeof (error as { code?: unknown } | null)?.code === "number"
                ? (error as { code: number }).code
                : undefined;
            resolve({
                exitCode: maybeCode ?? (error ? 1 : 0),
                stdout: String(stdout ?? ""),
                stderr: String(stderr ?? ""),
            });
        });

        if (input !== undefined) {
            child.stdin?.end(input);
        }
    });
}

function shq(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeRemoteBase(value: string): string {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed.startsWith("/") || trimmed === "/" || trimmed.includes("\0")) {
        throw new Error("SSH_REMOTE_WORKDIR must be a safe absolute POSIX path");
    }
    return trimmed;
}

function adjustPatchPathForWorkdir(patchPath: string, workdir: string): string {
    const workdirSubpath = workdir.replace(/^\/workspace\/?/, "");
    if (!workdirSubpath || patchPath.startsWith(`${workdirSubpath}/`)) {
        return patchPath;
    }
    return `${workdirSubpath}/${patchPath}`;
}

function truncate(value: string): string {
    return value.slice(0, 50_000);
}

function formatTestResultsReport(output: string): string {
    const sections = parseRequestResponseSections(output);
    const lines: string[] = [
        "# Test Execution Results",
        "",
        `Generated: ${new Date().toISOString()}`,
        "",
    ];

    if (sections.length > 0) {
        lines.push("## API Request/Response Report", "");
        for (const [index, section] of sections.entries()) {
            lines.push(`### ${index + 1}. ${section.request}`);
            lines.push("");
            lines.push(`- Status: ${section.status || "unknown"}`);
            if (section.error) {
                lines.push(`- Error: ${section.error}`);
            }
            if (section.body) {
                lines.push("");
                lines.push("Response body:");
                lines.push("");
                lines.push("```json");
                lines.push(section.body);
                lines.push("```");
            }
            lines.push("");
        }
    }

    lines.push("## Raw Output", "");
    lines.push("```text");
    lines.push(output.trim());
    lines.push("```");
    lines.push("");

    return lines.join("\n");
}

function parseRequestResponseSections(output: string): Array<{ request: string; status?: string; body?: string; error?: string }> {
    const sections: Array<{ request: string; status?: string; body?: string; error?: string }> = [];
    let current: { request: string; status?: string; body?: string; error?: string } | null = null;

    for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Request:")) {
            if (current) sections.push(current);
            current = { request: trimmed.replace(/^Request:\s*/, "") };
            continue;
        }
        if (!current) continue;

        if (trimmed.startsWith("Status:")) {
            current.status = trimmed.replace(/^Status:\s*/, "");
        } else if (trimmed.startsWith("Body:")) {
            current.body = trimmed.replace(/^Body:\s*/, "").slice(0, 4000);
        } else if (trimmed.startsWith("Error:")) {
            current.error = trimmed.replace(/^Error:\s*/, "");
        }
    }

    if (current) sections.push(current);
    return sections;
}
