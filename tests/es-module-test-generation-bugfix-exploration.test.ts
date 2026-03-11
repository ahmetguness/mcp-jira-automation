/* eslint-disable no-console */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildUserPrompt } from "../src/ai/provider.js";
import type { TaskContext } from "../src/types.js";

/**
 * Bug Condition Exploration Test for ES Module Test Generation Fix
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * 
 * Property 1: Bug Condition - ES Module Repository Generates CommonJS Syntax
 * 
 * This test verifies that when a repository has "type": "module" in package.json,
 * the buildUserPrompt function generates a prompt that does NOT contain module
 * system information, causing the AI to generate CommonJS syntax (require statements)
 * instead of ES module syntax (import statements).
 * 
 * EXPECTED OUTCOME: Test FAILS (this is correct - it proves the bug exists)
 * 
 * GOAL: Surface counterexamples that demonstrate:
 * - TaskContext with ES module package.json → prompt lacks "module_system: esm"
 * - Prompt contains only CommonJS patterns (const http = require('http'))
 * - No ES module syntax guidance in the prompt
 */
describe("ES Module Test Generation Bug Condition Exploration", () => {
    /**
     * Property 1: Bug Condition - ES Module Repository Generates CommonJS Syntax
     * 
     * For any TaskContext where package.json contains "type": "module",
     * the buildUserPrompt function should include "module_system: esm" in the prompt
     * to guide the AI to generate ES module syntax.
     * 
     * On UNFIXED code, this test will FAIL because the prompt does not contain
     * module system information, confirming the bug exists.
     */
    it("should detect missing module system information in prompt for ES module repositories", () => {
        // Create a TaskContext with package.json containing "type": "module"
        const esModuleContext: TaskContext = {
            issue: {
                key: "TEST-1",
                summary: "Test ES module repository",
                description: "Test that ES module repositories generate correct syntax",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-repo",
            },
            repo: {
                name: "test-repo",
                defaultBranch: "main",
                description: "Test repository with ES modules",
            },
            sourceFiles: [
                {
                    path: "package.json",
                    content: JSON.stringify({
                        name: "test-repo",
                        version: "1.0.0",
                        type: "module",
                        dependencies: {
                            express: "^4.18.0",
                        },
                    }, null, 2),
                },
                {
                    path: "src/app.js",
                    content: `import express from 'express';
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));
export default app;`,
                },
            ],
            testFiles: [],
        };

        // Call buildUserPrompt with the ES module context
        const prompt = buildUserPrompt(esModuleContext);

        // Document the bug condition
        console.log("\n=== BUG CONDITION ANALYSIS ===");
        console.log("Repository Configuration:");
        console.log("  - package.json contains: \"type\": \"module\"");
        console.log("  - Source files use ES module syntax (import/export)");
        console.log("\nGenerated Prompt Analysis:");
        
        const hasModuleSystemField = prompt.includes("module_system:");
        const hasEsmIndicator = prompt.includes("module_system: esm") || 
                                 prompt.includes("module_system: module");
        const hasCommonJSPattern = prompt.includes("require('http')") || 
                                    prompt.includes("require(\"http\")");
        const hasESMPattern = prompt.includes("import http from 'http'") ||
                              prompt.includes('import http from "http"');
        
        console.log(`  - Contains "module_system:" field: ${hasModuleSystemField}`);
        console.log(`  - Contains "module_system: esm": ${hasEsmIndicator}`);
        console.log(`  - Contains CommonJS pattern (require): ${hasCommonJSPattern}`);
        console.log(`  - Contains ES module pattern (import): ${hasESMPattern}`);
        
        console.log("\nExpected Behavior (After Fix):");
        console.log("  - Prompt should contain: \"module_system: esm\"");
        console.log("  - Prompt should guide AI to use: import http from 'http'");
        console.log("  - Generated tests should use ES module syntax");
        
        console.log("\nActual Behavior (Unfixed Code):");
        if (!hasEsmIndicator) {
            console.log("  ✗ Prompt does NOT contain module system information");
            console.log("  ✗ AI will default to CommonJS syntax (require statements)");
            console.log("  ✗ Generated tests will fail with: ReferenceError: require is not defined");
        } else {
            console.log("  ✓ Prompt contains module system information (bug may be fixed)");
        }
        
        console.log("\n=== END BUG CONDITION ANALYSIS ===\n");

        // CRITICAL: This assertion SHOULD FAIL on unfixed code
        // When it fails, it confirms the bug exists (which is the goal of exploration)
        expect(hasEsmIndicator).toBe(true);
        
        // Additional assertion: prompt should NOT only contain CommonJS patterns
        // If the prompt only has CommonJS patterns and no ESM guidance, that's the bug
        if (hasCommonJSPattern && !hasESMPattern) {
            console.log("\n⚠️  WARNING: Prompt contains CommonJS patterns but no ES module guidance");
            console.log("This will cause the AI to generate incompatible test syntax\n");
        }
    });

    /**
     * Property-Based Test: ES Module Detection Across Various Configurations
     * 
     * This test uses property-based testing to generate various package.json
     * configurations and verify that ES module repositories are correctly detected.
     */
    it("should detect ES module configuration across various package.json formats", () => {
        // Arbitrary generator for package.json with "type": "module"
        const esModulePackageJsonArb = fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }),
            version: fc.string({ minLength: 1, maxLength: 20 }),
            type: fc.constant("module" as const),
            dependencies: fc.option(fc.dictionary(
                fc.string({ minLength: 1, maxLength: 30 }),
                fc.string({ minLength: 1, maxLength: 20 })
            ), { nil: undefined }),
            scripts: fc.option(fc.dictionary(
                fc.string({ minLength: 1, maxLength: 30 }),
                fc.string({ minLength: 1, maxLength: 100 })
            ), { nil: undefined }),
        });

        // Property: For all ES module package.json configurations,
        // the prompt should contain module system information
        fc.assert(
            fc.property(esModulePackageJsonArb, (packageJson) => {
                const context: TaskContext = {
                    issue: {
                        key: "TEST-PBT",
                        summary: "Property-based test",
                        description: "Testing ES module detection",
                        status: "In Progress",
                        issueType: "Task",
                        assignee: "test-user",
                        repository: "test-repo",
                    },
                    repo: {
                        name: packageJson.name,
                        defaultBranch: "main",
                    },
                    sourceFiles: [
                        {
                            path: "package.json",
                            content: JSON.stringify(packageJson, null, 2),
                        },
                    ],
                    testFiles: [],
                };

                const prompt = buildUserPrompt(context);
                
                // On unfixed code, this will fail because the prompt doesn't contain
                // module system information
                const hasEsmIndicator = prompt.includes("module_system: esm") || 
                                        prompt.includes("module_system: module");
                
                return hasEsmIndicator;
            }),
            {
                numRuns: 50, // Run 50 test cases
                verbose: true, // Show counterexamples
            }
        );
    });

    /**
     * Monorepo Test: ES Module Detection in Monorepo Structure
     * 
     * Tests that ES module detection works correctly in monorepo scenarios
     * where package.json is in a subdirectory (e.g., backend/package.json).
     */
    it("should detect ES module configuration in monorepo structure", () => {
        const monorepoContext: TaskContext = {
            issue: {
                key: "TEST-MONOREPO",
                summary: "Test monorepo ES module detection",
                description: "Verify ES module detection in monorepo",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-monorepo",
            },
            repo: {
                name: "test-monorepo",
                defaultBranch: "main",
            },
            sourceFiles: [
                {
                    path: "backend/package.json",
                    content: JSON.stringify({
                        name: "backend",
                        version: "1.0.0",
                        type: "module",
                        dependencies: {
                            express: "^4.18.0",
                        },
                    }, null, 2),
                },
                {
                    path: "backend/src/app.js",
                    content: `import express from 'express';
const app = express();
export default app;`,
                },
            ],
            testFiles: [],
            workdir: "/workspace/backend",
            workdirRelative: "backend",
        };

        const prompt = buildUserPrompt(monorepoContext);

        console.log("\n=== MONOREPO BUG CONDITION ===");
        console.log("Monorepo Structure:");
        console.log("  - Working directory: backend/");
        console.log("  - backend/package.json contains: \"type\": \"module\"");
        
        const hasEsmIndicator = prompt.includes("module_system: esm") || 
                                prompt.includes("module_system: module");
        
        console.log(`\nPrompt contains ES module indicator: ${hasEsmIndicator}`);
        
        if (!hasEsmIndicator) {
            console.log("✗ Bug detected: Monorepo ES module configuration not detected");
        }
        
        console.log("=== END MONOREPO ANALYSIS ===\n");

        // CRITICAL: This should FAIL on unfixed code
        expect(hasEsmIndicator).toBe(true);
    });
});
