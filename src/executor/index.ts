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

    constructor(private config: Config) {
        this.docker = new DockerExecutor(config);
        this.policy = config.execPolicy;
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
            }),
        );

        log.timed("info", `Execution complete (exit: ${result.exitCode})`, duration_ms);

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration_ms,
            commands: allowed,
            blocked,
        };
    }
}
