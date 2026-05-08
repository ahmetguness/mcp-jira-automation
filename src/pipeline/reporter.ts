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

        // Summary — clean aider noise
        const cleanSummary = cleanTextForJira(result.analysis.summary);
        if (cleanSummary) {
            report += `*Summary:*\n${cleanSummary}\n\n`;
        }

        // Plan — only show if meaningful after cleaning
        if (result.analysis.plan) {
            const cleanPlan = cleanTextForJira(result.analysis.plan);
            if (cleanPlan && cleanPlan.length > 20) {
                report += `*Plan:*\n${cleanPlan}\n\n`;
            }
        }

        // Files changed — deduplicate
        if (result.analysis.patches.length > 0) {
            const seen = new Set<string>();
            report += `*Files changed:*\n`;
            for (const p of result.analysis.patches) {
                if (seen.has(p.path)) continue;
                seen.add(p.path);
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

        // Parse test results into table format — this is the primary output
        const testLines = parseTestResultsFromOutput(result.execution.stdout);

        // Extract pass/fail/skip counts from stdout
        const testCounts = extractTestCounts(result.execution.stdout);
        if (testCounts) {
            const countIcon = testCounts.failed === 0 ? "✅" : "⚠️";
            report += `${countIcon} *${testCounts.passed} passed, ${testCounts.failed} failed, ${testCounts.skipped} skipped*\n\n`;
        }

        if (testLines.length > 0) {
            report += `*Test Results:*\n`;
            report += `||Test||Status||Details||\n`;
            for (const t of testLines) {
                const statusIcon = t.passed ? "(/)" : "(x)";
                report += `|${t.name}|${statusIcon} ${t.passed ? "PASSED" : "FAILED"}|${t.detail}|\n`;
            }
            report += `\n`;
        }

        // Condensed output — only show test-relevant lines, not full HTTP bodies
        if (result.execution.stdout) {
            const condensed = condenseTestOutput(result.execution.stdout);
            if (condensed) {
                report += `*Output (condensed):*\n{code}\n${condensed}\n{code}\n\n`;
            }
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


/**
 * Condense test output for Jira — keep test names, status lines, and summary.
 * Strip verbose HTTP response bodies and request details.
 */
function condenseTestOutput(stdout: string): string {
    if (!stdout) return "";

    const lines = stdout.split("\n");
    const kept: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // Always keep test markers and results
        if (trimmed.startsWith("[TEST]")) { kept.push(line); continue; }
        if (trimmed.includes("✓ PASSED") || trimmed.includes("✗ FAILED") || trimmed.includes("⚠ SKIPPED")) { kept.push(line); continue; }
        if (trimmed.includes("PASSED") && trimmed.includes("(")) { kept.push(line); continue; }

        // Keep summary lines
        if (trimmed.startsWith("Results:") || trimmed.startsWith("=====")) { kept.push(line); continue; }
        if (trimmed.startsWith("API Test Suite")) { kept.push(line); continue; }
        if (/^\d+ passed/.test(trimmed) || /^\d+ failed/.test(trimmed)) { kept.push(line); continue; }

        // Keep server connectivity check
        if (trimmed.includes("Server responding") || trimmed.includes("Server not responding")) { kept.push(line); continue; }
        if (trimmed.includes("Checking server connectivity")) { kept.push(line); continue; }

        // Keep auth setup results
        if (trimmed.includes("Auth:")) { kept.push(line); continue; }

        // Keep request summary (method + URL + status) but NOT full bodies
        if (trimmed.startsWith("Request:") && !trimmed.includes("{")) {
            kept.push(line);
            continue;
        }
        if (trimmed.startsWith("Status:") && trimmed.length < 30) {
            kept.push(line);
            continue;
        }

        // Skip verbose body dumps, HTML content, and long JSON
        if (trimmed.startsWith("Body:")) continue;
        if (trimmed.startsWith("Headers:")) continue;
        if (trimmed.startsWith("<!DOCTYPE")) continue;
        if (trimmed.startsWith("<html")) continue;

        // Skip git clone output
        if (trimmed.startsWith("Cloning into")) continue;

        // Skip command echo lines (>>> python ...)
        if (trimmed.startsWith(">>>")) continue;

        // Keep error messages
        if (trimmed.includes("Error:") || trimmed.includes("error:")) { kept.push(line); continue; }
        if (trimmed.includes("WARNING") || trimmed.includes("⚠")) { kept.push(line); continue; }
    }

    const result = kept.join("\n").trim();
    return result.slice(0, 3000);
}


/** Parse test results from Python test output into structured rows */
function parseTestResultsFromOutput(stdout: string): Array<{ name: string; passed: boolean; detail: string }> {
    if (!stdout) return [];

    const results: Array<{ name: string; passed: boolean; detail: string }> = [];
    const lines = stdout.split("\n");

    let currentTest = "";

    for (const line of lines) {
        // Detect test name: [TEST] test_name or [TEST] GET /api/endpoint
        const testMatch = line.match(/\[TEST\]\s+(.+)/);
        if (testMatch) {
            currentTest = testMatch[1]!.trim();
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


/**
 * Clean AI-generated text for Jira — remove diff artifacts, code blocks,
 * aider session noise, and filler phrases.
 */
function cleanTextForJira(text: string): string {
    if (!text) return "";

    const lines = text.split(/\r?\n/);
    const clean: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;
        if (trimmed === "") continue;

        // Skip diff/merge markers
        if (trimmed.startsWith("<<<<<<") || trimmed.startsWith("======") || trimmed.startsWith(">>>>>>")) continue;
        if (trimmed.startsWith("@@")) continue;
        if (/^[+-][^+-]/.test(trimmed)) continue;
        if (trimmed === "SEARCH" || trimmed === "REPLACE") continue;

        // Skip aider session noise
        if (/^Tokens:\s/.test(trimmed)) continue;
        if (/^Applied edit to\s/.test(trimmed)) continue;
        if (/^python\s+[\w./-]+\.py$/.test(trimmed)) continue;
        if (trimmed.includes("cmd.exe?")) continue;

        // Skip bare file path headers
        if (/^[a-zA-Z0-9_/.-]+\.(py|js|ts|json|md|yaml|yml)$/.test(trimmed)) continue;

        // Skip filler phrases
        if (/^Here is the (?:complete )?implementation/i.test(trimmed)) continue;
        if (/^You can run the test suite/i.test(trimmed)) continue;
        if (/^Let'?s create the/i.test(trimmed)) continue;

        clean.push(line);
    }

    const result = clean.join("\n").trim();
    if (result.length < 10) return "";
    return result.slice(0, 2000);
}


/**
 * Extract test pass/fail/skip counts from Python test output.
 * Looks for patterns like "Passed: 11, Failed: 1, Skipped: 0"
 * or "Results: 11 passed, 1 failed, 0 skipped"
 */
function extractTestCounts(stdout: string): { passed: number; failed: number; skipped: number } | null {
    if (!stdout) return null;

    // Pattern: "Passed: N, Failed: N, Skipped: N"
    const pattern1 = /Passed:\s*(\d+),?\s*Failed:\s*(\d+),?\s*Skipped:\s*(\d+)/i;
    const match1 = stdout.match(pattern1);
    if (match1) {
        return { passed: parseInt(match1[1]!), failed: parseInt(match1[2]!), skipped: parseInt(match1[3]!) };
    }

    // Pattern: "Results: N passed, N failed, N skipped"
    const pattern2 = /Results:\s*(\d+)\s*passed,?\s*(\d+)\s*failed,?\s*(\d+)\s*skipped/i;
    const match2 = stdout.match(pattern2);
    if (match2) {
        return { passed: parseInt(match2[1]!), failed: parseInt(match2[2]!), skipped: parseInt(match2[3]!) };
    }

    // Pattern: "N passed, N failed" (without skipped)
    const pattern3 = /(\d+)\s*passed,?\s*(\d+)\s*failed/i;
    const match3 = stdout.match(pattern3);
    if (match3) {
        return { passed: parseInt(match3[1]!), failed: parseInt(match3[2]!), skipped: 0 };
    }

    return null;
}
