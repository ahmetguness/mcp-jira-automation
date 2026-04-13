/**
 * Reporter — formats pipeline results as Jira comments.
 */

import type { PipelineResult } from "../types.js";

export function formatJiraReport(result: PipelineResult, options?: { apiBaseUrl?: string; baseUrlSource?: string }): string {
    const icon = result.success ? "✅" : "❌";
    const status = result.success ? "SUCCESS" : "FAILED";

    let report = `🤖 *AI Cyber Bot Report* ${icon}\n\n`;
    report += `*Status:* ${status}\n`;
    report += `*Duration:* ${(result.duration_ms / 1000).toFixed(1)}s\n`;
    if (options?.apiBaseUrl) {
        report += `*Target:* ${options.apiBaseUrl} (source: ${options.baseUrlSource ?? "unknown"})\n`;
    }
    report += `\n`;

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

        // Parse test results into table format
        const testLines = parseTestResultsFromOutput(result.execution.stdout);
        if (testLines.length > 0) {
            report += `*Test Results:*\n`;
            report += `||Test||Status||Details||\n`;
            for (const t of testLines) {
                const statusIcon = t.passed ? "(/)" : "(x)";
                report += `|${t.name}|${statusIcon} ${t.passed ? "PASSED" : "FAILED"}|${t.detail}|\n`;
            }
            report += `\n`;
        }

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


/** Parse test results from Python test output into structured rows */
function parseTestResultsFromOutput(stdout: string): Array<{ name: string; passed: boolean; detail: string }> {
    if (!stdout) return [];

    const results: Array<{ name: string; passed: boolean; detail: string }> = [];
    const lines = stdout.split("\n");

    let currentTest = "";
    let currentStatus = "";

    for (const line of lines) {
        // Detect test name: [TEST] test_name or [TEST] GET /api/endpoint
        const testMatch = line.match(/\[TEST\]\s+(.+)/);
        if (testMatch) {
            currentTest = testMatch[1]!.trim();
            currentStatus = "";
            continue;
        }

        // Detect status line
        if (currentTest) {
            if (line.includes("PASSED") || line.includes("✓") || line.includes("✅")) {
                const detail = line.replace(/.*(?:PASSED|✓|✅)\s*/, "").trim();
                results.push({ name: currentTest, passed: true, detail: detail || "OK" });
                currentTest = "";
            } else if (line.includes("FAILED") || line.includes("✗") || line.includes("❌")) {
                const detail = line.replace(/.*(?:FAILED|✗|❌)\s*/, "").trim();
                results.push({ name: currentTest, passed: false, detail: detail || "Failed" });
                currentTest = "";
            } else if (line.includes("SKIPPED") || line.includes("⚠")) {
                const detail = line.replace(/.*(?:SKIPPED|⚠)\s*/, "").trim();
                results.push({ name: currentTest, passed: true, detail: detail || "Skipped" });
                currentTest = "";
            }
        }
    }

    return results;
}
