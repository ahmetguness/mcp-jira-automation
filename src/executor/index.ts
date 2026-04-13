/**
 * Executor module — orchestrates command policy checking and Docker execution.
 */

import type { Config } from "../config.js";
import type { AiAnalysis, ExecutionResult } from "../types.js";
import { filterCommands, type ExecPolicy } from "./policy.js";
import { DockerExecutor } from "./docker.js";
import { createLogger, withTiming } from "../logger.js";

const log = createLogger("executor");

export class Executor {
    private docker: DockerExecutor;
    private policy: ExecPolicy;
    private executionMode: "remote" | "sandbox";
    private apiBaseUrl?: string;

    constructor(config: Config) {
        this.docker = new DockerExecutor(config);
        this.policy = config.execPolicy;
        this.executionMode = config.executionMode;
        this.apiBaseUrl = config.apiBaseUrl;
    }

    /** Check if Docker is available */
    async isReady(): Promise<boolean> {
        return this.docker.checkConnection();
    }

    /**
     * Execute AI-generated analysis in an isolated Docker container.
     *
     * 1. Filter commands through security policy
     * 2. Run in Docker container
     * 3. Return results
     */
    async execute(
        analysis: AiAnalysis,
        repoUrl: string,
        branch: string,
        overrides?: { executionMode?: "remote" | "sandbox"; apiBaseUrl?: string; credentials?: Record<string, string> },
    ): Promise<ExecutionResult> {
        log.info(`Executing ${analysis.commands.length} commands (policy: ${this.policy})`);

        // Filter commands
        const { allowed, blocked } = filterCommands(analysis.commands, this.policy);

        if (blocked.length > 0) {
            log.warn(`Blocked ${blocked.length} commands: ${blocked.join(", ")}`);
        }

        if (allowed.length === 0) {
            log.warn("No commands to execute after policy filtering");
            return {
                success: true,
                exitCode: 0,
                stdout: "No commands to execute (all blocked by policy or none provided)",
                stderr: "",
                duration_ms: 0,
                commands: [],
                blocked,
            };
        }

        // Prepare patches from AI analysis
        const patches = analysis.patches
            .filter((p) => p.action !== "delete")
            .map((p) => ({ path: p.path, content: p.content }));

        // Run in Docker
        const { result, duration_ms } = await withTiming(async () =>
            this.docker.run({
                repoUrl,
                branch,
                commands: allowed,
                patches,
                environmentHint: analysis.environment,
                executionMode: overrides?.executionMode ?? this.executionMode,
                apiBaseUrl: overrides?.apiBaseUrl ?? this.apiBaseUrl,
                credentials: overrides?.credentials,
            }),
        );

        log.timed("info", `Execution complete (exit: ${result.exitCode})`, duration_ms);

        // Detect OOM kill (Docker sends SIGKILL = exit 137)
        if (result.exitCode === 137) {
            log.error("Container was killed by OOM (exit 137). Consider increasing Docker memory limits or reducing test scope.");
            return {
                success: false,
                exitCode: 137,
                stdout: result.stdout,
                stderr: result.stderr + "\n\n⚠️ Container killed: Out of Memory (OOM). The test or server exceeded the Docker memory limit.",
                duration_ms,
                commands: allowed,
                blocked,
                patches: result.patches,
            };
        }

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration_ms,
            commands: allowed,
            blocked,
            patches: result.patches,
        };
    }
}
