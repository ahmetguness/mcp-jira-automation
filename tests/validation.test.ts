import { describe, expect, it } from "vitest";
import { parseJiraIssue } from "../src/validation/jira.js";
import { extractMcpToolResultText } from "../src/validation/mcp.js";
import { parseGitHubRepo } from "../src/validation/scm.js";

describe("Validation Layer", () => {
    describe("Jira Validators", () => {
        it("should parse valid Jira raw issue", () => {
            const raw = {
                key: "CYBER-1",
                summary: "Test",
                fields: {
                    status: { name: "Open" }
                }
            };
            const result = parseJiraIssue(raw);
            expect(result.key).toBe("CYBER-1");
            expect(result.summary).toBe("Test");
            expect(result.fields?.status?.name).toBe("Open");
        });

        it("should handle null fields appropriately without throwing", () => {
            const result = parseJiraIssue({ key: "CYBER-1", description: null, status: null });
            expect(result.key).toBe("CYBER-1");
            expect(result.description).toBe(null);
        });
    });

    describe("MCP Tool Validators", () => {
        it("should extract structured tool result correctly", () => {
            const payload = {
                structuredContent: { result: "some-success-string" },
            };
            expect(extractMcpToolResultText(payload)).toBe("some-success-string");
        });

        it("should extract content text correctly", () => {
            const payload = {
                content: [{ text: "success-text" }]
            };
            expect(extractMcpToolResultText(payload)).toBe("success-text");
        });

        it("should fallback gracefully if shape is unknown", () => {
            const unknownShape = { hello: "world" };
            expect(extractMcpToolResultText(unknownShape)).toEqual(unknownShape);
        });
    });

    describe("SCM Validators", () => {
        it("should parse generic GitHub Repo payload", () => {
            const raw = {
                full_name: "ahmetguness/mcp-jira-automation",
                default_branch: "master"
            };
            const result = parseGitHubRepo(raw);
            expect(result.full_name).toBe("ahmetguness/mcp-jira-automation");
        });
    });
});
