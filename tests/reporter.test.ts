import { describe, it, expect } from "vitest";
import { formatJiraReport } from "../src/pipeline/reporter.js";
import type { PipelineResult } from "../src/types.js";

describe("formatJiraReport", () => {
    it("should format a successful pipeline result with PR link", () => {
        const result: PipelineResult = {
            issueKey: "CYBER-1",
            success: true,
            analysis: {
                summary: "Added input validation",
                plan: "Validate user input on form submit",
                patches: [
                    { path: "src/form.ts", content: "...", action: "modify" },
                    { path: "src/utils.ts", content: "...", action: "create" },
                ],
                commands: ["npm test"],
            },
            execution: {
                success: true,
                exitCode: 0,
                stdout: "All tests passed",
                stderr: "",
                duration_ms: 5000,
                commands: ["npm test"],
                blocked: [],
            },
            prUrl: "https://github.com/org/repo/pull/42",
            error: null,
            duration_ms: 15000,
        };

        const report = formatJiraReport(result);

        expect(report).toContain("✅");
        expect(report).toContain("SUCCESS");
        expect(report).toContain("15.0s");
        expect(report).toContain("Added input validation");
        expect(report).toContain("src/form.ts");
        expect(report).toContain("(modify)");
        expect(report).toContain("src/utils.ts");
        expect(report).toContain("(create)");
        expect(report).toContain("Exit code: 0");
        expect(report).toContain("All tests passed");
        expect(report).toContain("https://github.com/org/repo/pull/42");
    });

    it("should format a failed pipeline result with error output", () => {
        const result: PipelineResult = {
            issueKey: "CYBER-2",
            success: false,
            analysis: {
                summary: "Attempted fix",
                plan: "Fix the bug",
                patches: [],
                commands: ["npm test"],
            },
            execution: {
                success: false,
                exitCode: 1,
                stdout: "Running tests...",
                stderr: "TypeError: Cannot read property 'x' of undefined",
                duration_ms: 3000,
                commands: ["npm test"],
                blocked: [],
            },
            prUrl: null,
            error: "Exit code: 1",
            duration_ms: 8000,
        };

        const report = formatJiraReport(result);

        expect(report).toContain("❌");
        expect(report).toContain("FAILED");
        expect(report).toContain("TypeError");
        expect(report).not.toContain("Pull Request");
    });

    it("should show blocked commands when present", () => {
        const result: PipelineResult = {
            issueKey: "CYBER-3",
            success: true,
            analysis: {
                summary: "Test",
                plan: "",
                patches: [],
                commands: ["npm test", "sudo rm -rf /"],
            },
            execution: {
                success: true,
                exitCode: 0,
                stdout: "OK",
                stderr: "",
                duration_ms: 1000,
                commands: ["npm test"],
                blocked: ["sudo rm -rf /"],
            },
            prUrl: null,
            error: null,
            duration_ms: 2000,
        };

        const report = formatJiraReport(result);
        expect(report).toContain("Blocked commands");
        expect(report).toContain("sudo rm -rf /");
    });

    it("should handle minimal result with no analysis and no execution", () => {
        const result: PipelineResult = {
            issueKey: "CYBER-4",
            success: false,
            analysis: null,
            execution: null,
            prUrl: null,
            error: "No repository found on issue",
            duration_ms: 100,
        };

        const report = formatJiraReport(result);

        expect(report).toContain("❌");
        expect(report).toContain("FAILED");
        expect(report).toContain("No repository found on issue");
        expect(report).not.toContain("Summary:");
        expect(report).not.toContain("Exit code:");
    });

    it("should not show stderr for successful executions", () => {
        const result: PipelineResult = {
            issueKey: "CYBER-5",
            success: true,
            analysis: null,
            execution: {
                success: true,
                exitCode: 0,
                stdout: "built ok",
                stderr: "some warnings that are fine",
                duration_ms: 2000,
                commands: ["npm run build"],
                blocked: [],
            },
            prUrl: null,
            error: null,
            duration_ms: 3000,
        };

        const report = formatJiraReport(result);
        expect(report).not.toContain("Errors:");
    });
});
