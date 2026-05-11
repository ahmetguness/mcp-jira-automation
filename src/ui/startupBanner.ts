import chalk from "chalk";
import type { Config } from "../config.js";

/**
 * Renders the startup banner to stdout.
 * Uses direct stdout write to bypass Pino serialization.
 */
export function printStartupBanner(config: Config): void {
    const isJsonMode = process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production";
    const forceUi = process.env.LOG_UI === "1";
    if (isJsonMode && !forceUi) return;

    const W = 58; // inner width

    const line  = chalk.cyan("─".repeat(W));
    const empty = chalk.cyan("│") + " ".repeat(W) + chalk.cyan("│");

    function row(content: string): string {
        // Strip ANSI for length calculation
        const plain = content.replace(/\x1b\[[0-9;]*m/g, "");
        const pad = W - plain.length;
        const left  = Math.floor(pad / 2);
        const right = pad - left;
        return chalk.cyan("│") + " ".repeat(left) + content + " ".repeat(right) + chalk.cyan("│");
    }

    function kv(label: string, value: string): string {
        const labelPlain = label.replace(/\x1b\[[0-9;]*m/g, "");
        const valuePlain = value.replace(/\x1b\[[0-9;]*m/g, "");
        const gap = W - 4 - labelPlain.length - valuePlain.length;
        return chalk.cyan("│") + "  " + label + " ".repeat(Math.max(1, gap)) + value + "  " + chalk.cyan("│");
    }

    const execModeLabel = config.executionMode === "remote" && config.apiBaseUrl
        ? `remote → ${config.apiBaseUrl}`
        : config.executionMode;

    const approvalLabel = config.requireApproval ? "required" : "auto-run";

    const lines: string[] = [
        chalk.cyan("╭") + line + chalk.cyan("╮"),
        empty,
        row(chalk.white.bold("MCP Jira Automation")),
        row(chalk.gray("AI-powered API test automation")),
        empty,
        chalk.cyan("├") + line + chalk.cyan("┤"),
        empty,
        kv(chalk.gray("SCM Provider"), chalk.white(config.scmProvider)),
        kv(chalk.gray("AI Provider "), chalk.white(config.aiProvider)),
        kv(chalk.gray("Mode        "), chalk.white(config.mode)),
        kv(chalk.gray("Policy      "), chalk.white(config.execPolicy)),
        kv(chalk.gray("Executor    "), chalk.white(config.executorBackend)),
        kv(chalk.gray("Approval    "), config.requireApproval ? chalk.yellow(approvalLabel) : chalk.green(approvalLabel)),
        kv(chalk.gray("Execution   "), chalk.white(execModeLabel)),
        empty,
        chalk.cyan("├") + line + chalk.cyan("┤"),
        empty,
        row(chalk.gray("Set the Repository custom field on a Jira")),
        row(chalk.gray("issue or in its description to begin.")),
        empty,
        chalk.cyan("╰") + line + chalk.cyan("╯"),
    ];

    process.stdout.write("\n" + lines.join("\n") + "\n\n");
}
