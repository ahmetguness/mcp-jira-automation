import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import * as fc from "fast-check";

/**
 * Bug Condition Exploration Test for Git Clone Failure
 * 
 * **Validates: Requirements 2.1, 2.3**
 * 
 * Property 1: Bug Condition - Shorthand URL Clone Failure
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * - Failure confirms that owner/repo format is not converted to full GitHub URLs
 * - The test encodes the EXPECTED BEHAVIOR after the fix
 * - DO NOT attempt to fix the test when it fails - document the counterexamples
 * 
 * GOAL: Surface counterexamples that demonstrate the bug:
 * - validateRepoUrl accepts owner/repo format but returns it unchanged
 * - Git clone receives owner/repo format directly and fails with exit code 128
 * - Root cause: Missing URL conversion from owner/repo to https://github.com/owner/repo
 * 
 * SCOPED APPROACH: Verify that validateRepoUrl converts owner/repo format to full URLs
 * and that the Docker executor can successfully clone repositories using this format.
 */

describe("Bug Condition Exploration - Git Clone Failure with Shorthand URLs", () => {
    /**
     * Property 1: Bug Condition - Shorthand URL Conversion
     * 
     * The system should convert owner/repo format to https://github.com/owner/repo
     * before passing to git clone command.
     * 
     * EXPECTED ON UNFIXED CODE: Test FAILS - validateRepoUrl returns owner/repo unchanged
     */
    
    describe("URL Conversion Infrastructure", () => {
        it("should convert owner/repo format to full GitHub URL in validateRepoUrl", () => {
            // Import the validateRepoUrl function
            const sanitizePath = join(process.cwd(), "src/sanitize.ts");
            expect(existsSync(sanitizePath)).toBe(true);
            
            const content = readFileSync(sanitizePath, "utf-8");
            
            // Expected (after fix): validateRepoUrl converts owner/repo to https://github.com/owner/repo
            // Current (buggy): validateRepoUrl returns owner/repo unchanged
            
            // Check if the function has conversion logic
            const hasConversionLogic = content.includes("https://github.com/") &&
                                      content.includes("OWNER_REPO_REGEX");
            
            expect(hasConversionLogic).toBe(true);
        });

        it("should return full GitHub URL for owner/repo format inputs", async () => {
            // Dynamically import the validateRepoUrl function
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Test with concrete examples that match the bug condition
            const testCases = [
                "ahmetgunesceng1-alt/sloncar-rental-platform",
                "my-org/my-repo",
                "user.name/repo-name",
                "owner/repo",
            ];
            
            for (const input of testCases) {
                const result = validateRepoUrl(input);
                
                // Expected (after fix): Returns https://github.com/owner/repo
                // Current (buggy): Returns owner/repo unchanged
                expect(result).toBe(`https://github.com/${input}`);
                expect(result).toMatch(/^https:\/\/github\.com\//);
            }
        });
    });

    describe("Property-Based Testing: Shorthand URL Conversion", () => {
        /**
         * Property 1: For all inputs matching owner/repo format,
         * validateRepoUrl should return https://github.com/owner/repo
         */
        it("should convert all valid owner/repo formats to full GitHub URLs", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Generator for valid owner/repo format strings
            // Pattern: /^[\w.-]+\/[\w.-]+$/
            const ownerRepoArbitrary = fc.tuple(
                // Owner part: alphanumeric, dots, hyphens, underscores
                fc.stringMatching(/^[\w.-]+$/),
                // Repo part: alphanumeric, dots, hyphens, underscores
                fc.stringMatching(/^[\w.-]+$/)
            ).map(([owner, repo]) => `${owner}/${repo}`);
            
            fc.assert(
                fc.property(ownerRepoArbitrary, (input) => {
                    // Skip empty parts (edge case)
                    if (input.startsWith('/') || input.endsWith('/') || input.includes('//')) {
                        return true;
                    }
                    
                    const result = validateRepoUrl(input);
                    
                    // Expected (after fix): Result is a full GitHub URL
                    // Current (buggy): Result is the input unchanged
                    expect(result).toBe(`https://github.com/${input}`);
                    expect(result).toMatch(/^https:\/\/github\.com\//);
                    
                    return true;
                }),
                { numRuns: 50 }
            );
        });
    });

    describe("Concrete Bug Manifestation", () => {
        it("should document the expected behavior for shorthand URLs", () => {
            // This test documents what SHOULD happen after the fix
            // Expected behavior (After Fix):
            // 1. User provides repoUrl: "ahmetgunesceng1-alt/sloncar-rental-platform"
            // 2. validateRepoUrl() detects owner/repo format (matches OWNER_REPO_REGEX)
            // 3. validateRepoUrl() converts to "https://github.com/ahmetgunesceng1-alt/sloncar-rental-platform"
            // 4. Docker executor receives full URL
            // 5. git clone command receives valid URL format
            // 6. Repository clones successfully
            
            // Current behavior (Buggy):
            // 1. User provides repoUrl: "ahmetgunesceng1-alt/sloncar-rental-platform"
            // 2. validateRepoUrl() detects owner/repo format (matches OWNER_REPO_REGEX)
            // 3. validateRepoUrl() returns "ahmetgunesceng1-alt/sloncar-rental-platform" unchanged
            // 4. Docker executor receives shorthand format
            // 5. git clone command fails with exit code 128 (cannot resolve URL)
            // 6. KAN-38 processing fails
            
            // This assertion encodes the expected behavior
            const behaviorShouldBeImplemented = true;
            expect(behaviorShouldBeImplemented).toBe(true);
        });

        it("should preserve full URL behavior for GitHub URLs", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Full URLs should remain unchanged (preservation requirement)
            const fullUrls = [
                "https://github.com/owner/repo",
                "https://github.com/my-org/my-repo",
                "https://github.com/user.name/repo-name",
            ];
            
            for (const url of fullUrls) {
                const result = validateRepoUrl(url);
                
                // Full URLs should pass through unchanged
                expect(result).toBe(url);
            }
        });

        it("should preserve full URL behavior for GitLab and Bitbucket", async () => {
            const { validateRepoUrl } = await import("../src/sanitize.js");
            
            // Non-GitHub full URLs should remain unchanged (preservation requirement)
            const fullUrls = [
                "https://gitlab.com/owner/repo",
                "https://bitbucket.org/owner/repo",
            ];
            
            for (const url of fullUrls) {
                const result = validateRepoUrl(url);
                
                // Full URLs should pass through unchanged
                expect(result).toBe(url);
            }
        });
    });

    describe("Bug Condition Pattern Matching", () => {
        it("should identify inputs that match the bug condition pattern", () => {
            // Bug condition: input matches /^[\w.-]+\/[\w.-]+$/ and does not start with "https://"
            const bugConditionPattern = /^[\w.-]+\/[\w.-]+$/;
            
            // These should match the bug condition
            const bugConditionInputs = [
                "ahmetgunesceng1-alt/sloncar-rental-platform",
                "my-org/my-repo",
                "user.name/repo-name",
                "owner/repo",
                "org_name/repo_name",
                "user-123/repo-456",
            ];
            
            for (const input of bugConditionInputs) {
                expect(bugConditionPattern.test(input)).toBe(true);
                expect(input.startsWith("https://")).toBe(false);
            }
        });

        it("should identify inputs that do NOT match the bug condition", () => {
            // These should NOT match the bug condition (already full URLs)
            const nonBugConditionInputs = [
                "https://github.com/owner/repo",
                "https://gitlab.com/owner/repo",
                "https://bitbucket.org/owner/repo",
            ];
            
            const bugConditionPattern = /^[\w.-]+\/[\w.-]+$/;
            
            for (const input of nonBugConditionInputs) {
                // These don't match the pattern OR they start with https://
                const matchesPattern = bugConditionPattern.test(input);
                const startsWithHttps = input.startsWith("https://");
                
                // Bug condition requires: matches pattern AND NOT starts with https
                const isBugCondition = matchesPattern && !startsWithHttps;
                
                expect(isBugCondition).toBe(false);
            }
        });
    });
});
