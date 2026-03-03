/**
 * Reporter — formats pipeline results as Jira comments.
 */

import type { PipelineResult } from "../types.js";

export function formatJiraReport(result: PipelineResult): string {
    const icon = result.success ? "✅" : "❌";
    const status = result.success ? "SUCCESS" : "FAILED";

    let report = `🤖 *AI Cyber Bot Report* ${icon}\n\n`;
    report += `*Status:* ${status}\n`;
    report += `*Duration:* ${(result.duration_ms / 1000).toFixed(1)}s\n\n`;

    // Analysis
    if (result.analysis) {
        report += `---\n\n`;
        report += `*Summary:*\n${result.analysis.summary}\n\n`;

        if (result.analysis.plan) {
            report += `*Plan:*\n${result.analysis.plan}\n\n`;
        }

        if (result.analysis.patches.length > 0) {
            report += `*Files changed:*\n`;
            for (const p of result.analysis.patches) {
                report += `- \`${p.path}\` (${p.action})\n`;
            }
            report += `\n`;
        }
    }

    // Execution
    if (result.execution) {
        report += `---\n\n`;
        report += `*Execution:*\n`;
        report += `- Exit code: ${result.execution.exitCode}\n`;
        report += `- Duration: ${(result.execution.duration_ms / 1000).toFixed(1)}s\n`;
        report += `- Commands run: ${result.execution.commands.length}\n`;

        if (result.execution.blocked.length > 0) {
            report += `- ⚠️ Blocked commands: ${result.execution.blocked.join(", ")}\n`;
        }

        report += `\n`;

        // Truncated output
        if (result.execution.stdout) {
            const output = result.execution.stdout.slice(0, 3000);
            report += `*Output:*\n{code}\n${output}\n{code}\n\n`;
        }

        if (result.execution.stderr && !result.success) {
            const stderr = result.execution.stderr.slice(0, 2000);
            report += `*Errors:*\n{code}\n${stderr}\n{code}\n\n`;
        }
    }

    // PR
    if (result.prUrl) {
        report += `---\n\n`;
        report += `🔗 *Pull Request:* ${result.prUrl}\n`;
        report += `\n_Please review and merge the PR if the changes are satisfactory._\n`;
    }

    // Error
    if (result.error && !result.execution) {
        report += `---\n\n`;
        report += `*Error:*\n{code}\n${result.error}\n{code}\n`;
    }

    return report;
}
