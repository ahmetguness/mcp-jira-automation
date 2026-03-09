import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Bug Condition Exploration Test for ES Module Compatibility Fix
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * 
 * Property 1: Bug Condition - Source Directory Contains Only TypeScript Files
 * 
 * This test verifies that the bug condition exists by checking for .js files
 * with CommonJS syntax in the src/ directory. When these files exist, they
 * cause ES module compatibility errors during test execution.
 * 
 * EXPECTED OUTCOME: Test FAILS with evidence of .js files containing CommonJS
 * syntax in src/ directory (this is correct - it proves the bug exists)
 */
describe("ES Module Bug Condition Exploration", () => {
    /**
     * Property 1: Bug Condition - Source Directory Contains Only TypeScript Files
     * 
     * For any file in the src/ directory tree, if the file has a .js extension
     * and contains CommonJS syntax (exports, require), it triggers ES module
     * compatibility errors.
     * 
     * This test checks the 8 concrete failing files identified in the design.
     */
    it("should detect .js files with CommonJS syntax in src/ directory", () => {
        // List of problematic files identified in the bugfix design
        const problematicFiles = [
            "src/config.js",
            "src/logger.js",
            "src/types.js",
            "src/jira/client.js",
            "src/mcp/manager.js",
            "src/mcp/spawn.js",
            "src/validation/jira.js",
            "src/validation/mcp.js",
        ];

        const foundBugConditions: Array<{
            file: string;
            exists: boolean;
            hasCommonJS: boolean;
            evidence: string[];
        }> = [];

        // Check each file for bug condition
        for (const file of problematicFiles) {
            const filePath = join(process.cwd(), file);
            const exists = existsSync(filePath);

            if (exists) {
                const content = readFileSync(filePath, "utf-8");
                
                // Check for CommonJS syntax patterns
                const hasExports = content.includes("exports");
                const hasRequire = content.includes("require(");
                const hasCommonJS = hasExports || hasRequire;

                const evidence: string[] = [];
                if (hasExports) {
                    evidence.push("Contains 'exports' keyword");
                }
                if (hasRequire) {
                    evidence.push("Contains 'require(' pattern");
                }

                foundBugConditions.push({
                    file,
                    exists: true,
                    hasCommonJS,
                    evidence,
                });
            } else {
                foundBugConditions.push({
                    file,
                    exists: false,
                    hasCommonJS: false,
                    evidence: [],
                });
            }
        }

        // Count files that match the bug condition
        const filesWithBugCondition = foundBugConditions.filter(
            (f) => f.exists && f.hasCommonJS
        );

        // Document counterexamples (files that demonstrate the bug)
        if (filesWithBugCondition.length > 0) {
            console.log("\n=== BUG CONDITION DETECTED ===");
            console.log(`Found ${filesWithBugCondition.length} .js files with CommonJS syntax in src/:`);
            filesWithBugCondition.forEach((f) => {
                console.log(`\n  File: ${f.file}`);
                console.log(`  Evidence: ${f.evidence.join(", ")}`);
            });
            console.log("\nThese files cause ES module compatibility errors:");
            console.log("  - ReferenceError: exports is not defined in ES module scope");
            console.log("  - TypeError: Cannot read properties of undefined (reading 'randomUUID')");
            console.log("\n=== END BUG CONDITION REPORT ===\n");
        }

        // CRITICAL: This assertion SHOULD FAIL on unfixed code
        // When it fails, it confirms the bug exists (which is the goal of exploration)
        // The failure message will document the counterexamples
        expect(filesWithBugCondition.length).toBe(0);
        
        // If we reach here (test passes), it means the bug is already fixed
        // This would be unexpected for an exploration test on unfixed code
    });
});
