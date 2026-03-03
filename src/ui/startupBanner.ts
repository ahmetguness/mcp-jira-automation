import boxen from "boxen";
import chalk from "chalk";
import type { Config } from "../config.js";

/**
 * Renders the one-time FastMCP-style startup banner to stdout.
 * Uses direct standard write to bypass Pino serialization guarantees.
 */
export function printStartupBanner(config: Config): void {
    const isJsonMode = process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production";
    const forceUi = process.env.LOG_UI === "1";

    // Never print banner in JSON mode unless explicitly forced
    if (isJsonMode && !forceUi) {
        return;
    }

    const title = chalk.white.bold("MCP Jira Automation") + chalk.gray(" — AI Cyber Bot");

    const lines = [
        "",
        `${chalk.cyan.bold("SCM Provider:")}   ${chalk.white(config.scmProvider)}`,
        `${chalk.magenta.bold("AI Provider:")}    ${chalk.white(config.aiProvider)}`,
        `${chalk.blue.bold("Mode:")}           ${chalk.white(config.mode)}`,
        `${chalk.yellow.bold("Policy:")}         ${chalk.white(config.execPolicy)}`,
        `${chalk.green.bold("Approval:")}       ${chalk.white(config.requireApproval ? "Required" : "Auto-run")}`,
        "",
        `${chalk.gray("Note:")} Set the Repository custom field on a Jira`,
        `      issue or in its description to begin processing.`,
        ""
    ];

    const banner = boxen(lines.join("\n"), {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "cyan",
        title: title,
        titleAlignment: "center"
    });

    // Write raw to terminal (bypassing pino one-line rules)
    process.stdout.write(banner + "\n");
}
