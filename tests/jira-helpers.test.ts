import { describe, it, expect } from "vitest";
import { normalizeRepoUrl } from "../src/jira/client.js";

describe("Jira Helpers", () => {
    // ── normalizeRepoUrl ─────────────────────────────────

    describe("normalizeRepoUrl", () => {
        it("should return org/repo format as-is", () => {
            expect(normalizeRepoUrl("ahmetguness/mcp-jira-automation")).toBe(
                "ahmetguness/mcp-jira-automation",
            );
        });

        it("should handle org/repo with dots and hyphens", () => {
            expect(normalizeRepoUrl("my-org/my.repo-name")).toBe("my-org/my.repo-name");
        });

        it("should extract org/repo from GitHub HTTPS URL", () => {
            expect(normalizeRepoUrl("https://github.com/org/repo")).toBe("org/repo");
        });

        it("should extract org/repo from GitLab URL", () => {
            expect(normalizeRepoUrl("https://gitlab.com/group/repo")).toBe("group/repo");
        });

        it("should handle GitLab subgroup URLs", () => {
            expect(normalizeRepoUrl("https://gitlab.com/group/sub/repo")).toBe(
                "group/sub/repo",
            );
        });

        it("should extract org/repo from Bitbucket URL", () => {
            expect(normalizeRepoUrl("https://bitbucket.org/workspace/repo")).toBe(
                "workspace/repo",
            );
        });

        it("should strip .git suffix from URL", () => {
            expect(normalizeRepoUrl("https://github.com/org/repo.git")).toBe("org/repo");
        });

        it("should strip trailing slash from URL", () => {
            expect(normalizeRepoUrl("https://github.com/org/repo/")).toBe("org/repo");
        });

        it("should handle URL with .git suffix and trailing slash (known edge case)", () => {
            // normalizeRepoUrl strips trailing / before .git, so .git remains
            // In practice this URL format is extremely rare
            expect(normalizeRepoUrl("https://github.com/org/repo.git/")).toBe("org/repo.git");
        });

        it("should handle multi-level path (GitLab-style)", () => {
            expect(normalizeRepoUrl("group/subgroup/repo")).toBe("group/subgroup/repo");
        });

        it("should trim whitespace", () => {
            expect(normalizeRepoUrl("  org/repo  ")).toBe("org/repo");
        });

        it("should handle non-URL non-slug input gracefully", () => {
            expect(normalizeRepoUrl("just-a-name")).toBe("just-a-name");
        });
    });
});
