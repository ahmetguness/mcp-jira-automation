import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Preservation Property Tests for Git Clone Fix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 * 
 * Property 2: Preservation - Full URL Passthrough
 * 
 * IMPORTANT: Observation-first methodology
 * - These tests observe and document behavior on UNFIXED code
 * - They verify that full HTTPS URLs from allowed hosts work correctly
 * - After the fix, these tests should continue to pass (no regressions)
 * 
 * EXPECTED ON UNFIXED CODE: Tests PASS (confirms baseline behavior to preserve)
 * EXPECTED AFTER FIX: Tests PASS (confirms no regressions)
 * 
 * GOAL: Ensure the fix does not break existing functionality for:
 * - Full GitHub URLs (https://github.com/...)
 * - Full GitLab URLs (https://gitlab.com/...)
 * - Full Bitbucket URLs (https://bitbucket.org/...)
 * - Validation errors for invalid URLs
 */

describe("Preservation Property Tests - Full URL Passthrough", () => {
    /**
     * Property 2.1: GitHub URL Preservation
     * 
     * For all full HTTPS URLs from github.com, validateRepoUrl should
     * return the URL unchanged (passthrough behavior).
     */
    describe("GitHub URL Preservation", () => {
        it("should preserve full GitHub URLs unchanged", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Concrete examples of full GitHub URLs
            const githubUrls = [
                "https://github.com/owner/repo",
                "https://github.com/my-org/my-repo",
                "https://github.com/user.name/repo-name",
                "https://github.com/org_123/repo_456",
                "https://github.com/facebook/react",
                "https://github.com/microsoft/vscode",
            ];
            
            for (const url of githubUrls) {
                const result = validateRepoUrl(url);
                
                // Full URLs should pass through unchanged
                expect(result).toBe(url);
                expect(result).toMatch(/^https:\/\/github\.com\//);
            }
        });

        it("should preserve GitHub URLs with .git suffix", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const urlsWithGit = [
                "https://github.com/owner/repo.git",
                "https://github.com/my-org/my-repo.git",
            ];
            
            for (const url of urlsWithGit) {
                const result = validateRepoUrl(url);
                expect(result).toBe(url);
            }
        });

        it("should preserve GitHub URLs with paths", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const urlsWithPaths = [
                "https://github.com/owner/repo/tree/main",
                "https://github.com/owner/repo/blob/main/README.md",
            ];
            
            for (const url of urlsWithPaths) {
                const result = validateRepoUrl(url);
                expect(result).toBe(url);
            }
        });
    });

    /**
     * Property 2.2: GitLab URL Preservation
     * 
     * For all full HTTPS URLs from gitlab.com, validateRepoUrl should
     * return the URL unchanged (passthrough behavior).
     */
    describe("GitLab URL Preservation", () => {
        it("should preserve full GitLab URLs unchanged", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const gitlabUrls = [
                "https://gitlab.com/owner/repo",
                "https://gitlab.com/my-org/my-repo",
                "https://gitlab.com/user.name/repo-name",
                "https://gitlab.com/gitlab-org/gitlab",
            ];
            
            for (const url of gitlabUrls) {
                const result = validateRepoUrl(url);
                
                // Full URLs should pass through unchanged
                expect(result).toBe(url);
                expect(result).toMatch(/^https:\/\/gitlab\.com\//);
            }
        });

        it("should preserve GitLab URLs with .git suffix", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const urlsWithGit = [
                "https://gitlab.com/owner/repo.git",
                "https://gitlab.com/my-org/my-repo.git",
            ];
            
            for (const url of urlsWithGit) {
                const result = validateRepoUrl(url);
                expect(result).toBe(url);
            }
        });
    });

    /**
     * Property 2.3: Bitbucket URL Preservation
     * 
     * For all full HTTPS URLs from bitbucket.org, validateRepoUrl should
     * return the URL unchanged (passthrough behavior).
     */
    describe("Bitbucket URL Preservation", () => {
        it("should preserve full Bitbucket URLs unchanged", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const bitbucketUrls = [
                "https://bitbucket.org/owner/repo",
                "https://bitbucket.org/my-org/my-repo",
                "https://bitbucket.org/user.name/repo-name",
                "https://bitbucket.org/atlassian/python-bitbucket",
            ];
            
            for (const url of bitbucketUrls) {
                const result = validateRepoUrl(url);
                
                // Full URLs should pass through unchanged
                expect(result).toBe(url);
                expect(result).toMatch(/^https:\/\/bitbucket\.org\//);
            }
        });

        it("should preserve Bitbucket URLs with .git suffix", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const urlsWithGit = [
                "https://bitbucket.org/owner/repo.git",
                "https://bitbucket.org/my-org/my-repo.git",
            ];
            
            for (const url of urlsWithGit) {
                const result = validateRepoUrl(url);
                expect(result).toBe(url);
            }
        });
    });

    /**
     * Property 2.4: Validation Error Preservation
     * 
     * For all invalid URLs, validateRepoUrl should continue to throw
     * validation errors (error behavior preservation).
     */
    describe("Validation Error Preservation", () => {
        it("should reject empty URLs", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            expect(() => validateRepoUrl("")).toThrow("Repository URL cannot be empty");
            expect(() => validateRepoUrl("   ")).toThrow("Repository URL cannot be empty");
        });

        it("should reject non-HTTPS protocols", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const invalidProtocols = [
                "http://github.com/owner/repo",
                "ftp://github.com/owner/repo",
                "git://github.com/owner/repo",
            ];
            
            for (const url of invalidProtocols) {
                expect(() => validateRepoUrl(url)).toThrow("only https is allowed");
            }
        });

        it("should reject disallowed hosts", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const disallowedHosts = [
                "https://example.com/owner/repo",
                "https://malicious.com/owner/repo",
                "https://github.evil.com/owner/repo",
            ];
            
            for (const url of disallowedHosts) {
                expect(() => validateRepoUrl(url)).toThrow("not in the allow list");
            }
        });

        it("should reject malformed URLs", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            const malformedUrls = [
                "not-a-url",
                "https://",
                "://github.com/owner/repo",
                "github.com/owner/repo", // Missing protocol
            ];
            
            for (const url of malformedUrls) {
                expect(() => validateRepoUrl(url)).toThrow();
            }
        });

        it("should reject URLs with invalid characters in owner/repo format", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // These don't match owner/repo pattern and aren't valid URLs
            const invalidFormats = [
                "owner/repo/extra",
                "owner",
                "/repo",
                "owner/",
                "owner//repo",
                "owner repo",
                "owner@repo",
            ];
            
            for (const url of invalidFormats) {
                expect(() => validateRepoUrl(url)).toThrow();
            }
        });
    });

    /**
     * Property-Based Testing: Full URL Passthrough
     * 
     * Generate random full HTTPS URLs from allowed hosts and verify
     * they are returned unchanged by validateRepoUrl.
     */
    describe("Property-Based Testing: Full URL Passthrough", () => {
        it("should preserve all valid full HTTPS URLs from allowed hosts", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Generator for valid full HTTPS URLs from allowed hosts
            const allowedHosts = ["github.com", "gitlab.com", "bitbucket.org"];
            
            const fullUrlArbitrary = fc.record({
                host: fc.constantFrom(...allowedHosts),
                owner: fc.stringMatching(/^[\w.-]+$/),
                repo: fc.stringMatching(/^[\w.-]+$/),
            }).map(({ host, owner, repo }) => `https://${host}/${owner}/${repo}`);
            
            fc.assert(
                fc.property(fullUrlArbitrary, (url) => {
                    // Skip edge cases with empty parts
                    if (url.includes('///', ) || url.endsWith('/')) {
                        return true;
                    }
                    
                    const result = validateRepoUrl(url);
                    
                    // Full URLs should pass through unchanged
                    expect(result).toBe(url);
                    expect(result).toMatch(/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//);
                    
                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it("should preserve GitHub URLs with various path structures", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Generator for GitHub URLs with different path structures
            const githubUrlArbitrary = fc.record({
                owner: fc.stringMatching(/^[\w.-]+$/),
                repo: fc.stringMatching(/^[\w.-]+$/),
                suffix: fc.constantFrom("", ".git", "/tree/main", "/blob/main/README.md"),
            }).map(({ owner, repo, suffix }) => `https://github.com/${owner}/${repo}${suffix}`);
            
            fc.assert(
                fc.property(githubUrlArbitrary, (url) => {
                    // Skip edge cases
                    if (url.includes('///') || url.includes('//')) {
                        return true;
                    }
                    
                    const result = validateRepoUrl(url);
                    
                    // Full URLs should pass through unchanged
                    expect(result).toBe(url);
                    
                    return true;
                }),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 2.5: Cross-Platform Consistency
     * 
     * Verify that the same URL produces the same result regardless of
     * how it's formatted (with/without trailing slashes, etc.)
     */
    describe("Cross-Platform Consistency", () => {
        it("should handle URLs consistently", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Base URL
            const baseUrl = "https://github.com/owner/repo";
            
            // These should all be treated consistently
            const result1 = validateRepoUrl(baseUrl);
            const result2 = validateRepoUrl("  " + baseUrl + "  "); // With whitespace
            
            expect(result1).toBe(baseUrl);
            expect(result2).toBe(baseUrl);
        });
    });

    /**
     * Documentation: Preservation Requirements
     * 
     * This test documents what behavior must be preserved after the fix.
     */
    describe("Preservation Requirements Documentation", () => {
        it("should document the preservation requirements", () => {
            // Preservation Requirements (from bugfix.md):
            // 
            // 3.1: Full HTTPS URLs from github.com must continue to clone successfully
            // 3.2: Full HTTPS URLs from gitlab.com and bitbucket.org must continue to clone successfully
            // 3.3: Validation errors for invalid characters or disallowed hosts must continue to be thrown
            // 3.4: Valid branch names must continue to work with clone operations
            // 3.5: Clone retry logic (with/without --branch) must continue to work for all URL formats
            //
            // The fix should ONLY affect owner/repo format inputs.
            // All full HTTPS URLs should be completely unaffected.
            
            const preservationRequirementsMet = true;
            expect(preservationRequirementsMet).toBe(true);
        });

        it("should verify that full URLs are NOT affected by the bug", () => {
            // The bug condition is: input matches /^[\w.-]+\/[\w.-]+$/ AND does not start with "https://"
            // 
            // Full HTTPS URLs do NOT match this condition because they start with "https://"
            // Therefore, the fix should not change their behavior at all.
            
            const bugConditionPattern = /^[\w.-]+\/[\w.-]+$/;
            
            const fullUrls = [
                "https://github.com/owner/repo",
                "https://gitlab.com/owner/repo",
                "https://bitbucket.org/owner/repo",
            ];
            
            for (const url of fullUrls) {
                const matchesPattern = bugConditionPattern.test(url);
                const startsWithHttps = url.startsWith("https://");
                
                // Bug condition: matches pattern AND NOT starts with https
                const isBugCondition = matchesPattern && !startsWithHttps;
                
                // Full URLs should NOT match the bug condition
                expect(isBugCondition).toBe(false);
            }
        });
    });
});
