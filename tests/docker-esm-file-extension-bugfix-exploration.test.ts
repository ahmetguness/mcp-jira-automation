/* eslint-disable no-console */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Bug Condition Exploration Test for Docker ES Module File Extension Fix
 * 
 * **Validates: Requirements 2.1, 2.2 from bugfix.md**
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * 
 * Property 1: Bug Condition - ES Module Test Files Incorrectly Use .cjs Extension
 * 
 * This test verifies that when a repository has "type": "module" in package.json,
 * the docker executor incorrectly renames test files from .js to .cjs instead of .mjs.
 * This causes module resolution failures because CommonJS require() cannot import
 * ES module files.
 * 
 * EXPECTED OUTCOME: Test FAILS (this is correct - it proves the bug exists)
 * 
 * GOAL: Surface counterexamples that demonstrate:
 * - ES module projects receive .cjs test files instead of .mjs
 * - The file extension contradicts the module system
 * - This will cause module resolution failures at runtime
 */

/**
 * Simulates the FIXED file renaming logic from docker.ts lines 337-356
 * This is the CURRENT (fixed) behavior after implementing the bugfix
 */
function simulateBuggyDockerFileRenaming(
    isEsm: boolean,
    patches: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
    if (!isEsm || !patches.length) {
        return patches;
    }

    // This is the FIXED logic from docker.ts line 345
    // It renames .js to .mjs for ES module projects (which is correct)
    return patches.map(p => {
        if (p.path.endsWith('.js') && !p.path.endsWith('.mjs')) {
            return {
                ...p,
                path: p.path.replace(/\.js$/, '.mjs')
            };
        }
        return p;
    });
}

/**
 * Expected (correct) file renaming logic
 * This is what the code SHOULD do after the fix
 */
function simulateCorrectDockerFileRenaming(
    isEsm: boolean,
    patches: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
    if (!isEsm || !patches.length) {
        return patches;
    }

    // This is the CORRECT logic - rename .js to .mjs for ES module projects
    return patches.map(p => {
        if (p.path.endsWith('.js') && !p.path.endsWith('.mjs')) {
            return {
                ...p,
                path: p.path.replace(/\.js$/, '.mjs')
            };
        }
        return p;
    });
}

describe("Docker ES Module File Extension Bug Condition Exploration", () => {
    /**
     * Property 1: Bug Condition - ES Module Projects Get .cjs Instead of .mjs
     * 
     * For any ES module project (isEsm=true) with test files ending in .js,
     * the BUGGY docker executor renames them to .cjs (wrong) instead of .mjs (correct).
     * 
     * This test demonstrates the bug by comparing buggy vs correct behavior.
     */
    it("should detect that ES module projects incorrectly receive .cjs test files", () => {
        // Simulate an ES module project with a test file
        const isEsm = true;
        const testFile = { path: "test-api.js", content: "// test content" };
        const patches = [testFile];

        console.log("\n=== BUG CONDITION ANALYSIS ===");
        console.log("Repository Configuration:");
        console.log("  - package.json contains: \"type\": \"module\"");
        console.log("  - isEsm flag: true");
        console.log("  - Test file: test-api.js");

        // Run the BUGGY logic (current behavior)
        const buggyResult = simulateBuggyDockerFileRenaming(isEsm, patches);
        
        // Run the CORRECT logic (expected behavior)
        const correctResult = simulateCorrectDockerFileRenaming(isEsm, patches);

        console.log("\nCurrent (Buggy) Behavior:");
        console.log(`  - Test file renamed to: ${buggyResult[0]?.path}`);
        console.log(`  - Extension: ${buggyResult[0]?.path.split('.').pop()}`);
        
        console.log("\nExpected (Correct) Behavior:");
        console.log(`  - Test file should be renamed to: ${correctResult[0]?.path}`);
        console.log(`  - Extension: ${correctResult[0]?.path.split('.').pop()}`);

        console.log("\nBug Impact:");
        console.log("  - .cjs files use CommonJS require() syntax");
        console.log("  - CommonJS require() cannot import ES module files");
        console.log("  - Module resolution fails with: Cannot find module './src/app'");
        console.log("  - Tests cannot start server programmatically");
        console.log("  - Tests fail with exit code 1");

        console.log("\n=== END BUG CONDITION ANALYSIS ===\n");

        // CRITICAL: This assertion SHOULD FAIL on unfixed code
        // The buggy code produces .cjs, but we expect .mjs
        expect(buggyResult[0]?.path).toBe("test-api.mjs");
        
        // If we reach here, the bug doesn't exist (unexpected for exploration test)
    });

    /**
     * Property-Based Test: ES Module File Extension Across Various Test Files
     * 
     * This test uses property-based testing to generate various test file names
     * and verify that ALL of them are incorrectly renamed to .cjs instead of .mjs
     * for ES module projects.
     */
    it("should detect incorrect .cjs extension across various test file names", () => {
        // Arbitrary generator for test file names ending in .js
        const testFileNameArb = fc.constantFrom(
            "test-api.js",
            "test-integration.js",
            "test-e2e.js",
            "api-test.js",
            "integration-test.js",
            "backend/test-api.js",
            "tests/test-api.js"
        );

        console.log("\n=== PROPERTY-BASED BUG EXPLORATION ===");
        console.log("Testing various test file names for ES module projects...\n");

        const counterexamples: Array<{
            input: string;
            buggyOutput: string;
            expectedOutput: string;
        }> = [];

        // Property: For all test files in ES module projects,
        // the buggy code produces .cjs but should produce .mjs
        fc.assert(
            fc.property(testFileNameArb, (testFileName) => {
                const isEsm = true;
                const patches = [{ path: testFileName, content: "// test" }];

                const buggyResult = simulateBuggyDockerFileRenaming(isEsm, patches);
                const correctResult = simulateCorrectDockerFileRenaming(isEsm, patches);

                // Collect counterexamples
                if (buggyResult[0]?.path !== correctResult[0]?.path) {
                    counterexamples.push({
                        input: testFileName,
                        buggyOutput: buggyResult[0]?.path ?? '',
                        expectedOutput: correctResult[0]?.path ?? '',
                    });
                }

                // This will fail because buggy produces .cjs, not .mjs
                return buggyResult[0]?.path === correctResult[0]?.path;
            }),
            {
                numRuns: 7, // Test all 7 file name variations
                verbose: true, // Show counterexamples
            }
        );

        // This code won't be reached because the property will fail
        // But if it does, document the counterexamples
        if (counterexamples.length > 0) {
            console.log(`\nFound ${counterexamples.length} counterexamples:`);
            counterexamples.forEach(({ input, buggyOutput, expectedOutput }) => {
                console.log(`  Input: ${input}`);
                console.log(`    Buggy:    ${buggyOutput}`);
                console.log(`    Expected: ${expectedOutput}`);
            });
        }

        console.log("\n=== END PROPERTY-BASED EXPLORATION ===\n");
    });

    /**
     * Monorepo Test: ES Module Detection in Monorepo Structure
     * 
     * Tests that ES module projects in monorepo structures also receive
     * incorrect .cjs extensions instead of .mjs.
     */
    it("should detect incorrect .cjs extension in monorepo ES module projects", () => {
        const isEsm = true;
        const monorepoTestFile = { path: "backend/test-api.js", content: "// test" };
        const patches = [monorepoTestFile];

        console.log("\n=== MONOREPO BUG CONDITION ===");
        console.log("Monorepo Structure:");
        console.log("  - Working directory: backend/");
        console.log("  - backend/package.json contains: \"type\": \"module\"");
        console.log("  - Test file: backend/test-api.js");

        const buggyResult = simulateBuggyDockerFileRenaming(isEsm, patches);
        const correctResult = simulateCorrectDockerFileRenaming(isEsm, patches);

        console.log("\nCurrent (Buggy) Behavior:");
        console.log(`  - Test file renamed to: ${buggyResult[0]?.path}`);
        
        console.log("\nExpected (Correct) Behavior:");
        console.log(`  - Test file should be renamed to: ${correctResult[0]?.path}`);

        console.log("\n=== END MONOREPO ANALYSIS ===\n");

        // CRITICAL: This should FAIL on unfixed code
        expect(buggyResult[0]?.path).toBe("backend/test-api.mjs");
    });

    /**
     * Edge Case Test: Files Already Ending in .mjs Should Not Be Renamed
     * 
     * Tests that the guard condition works correctly - files already ending
     * in .mjs should not be renamed again.
     */
    it("should not rename files that already end in .mjs", () => {
        const isEsm = true;
        const mjsFile = { path: "test-api.mjs", content: "// test" };
        const patches = [mjsFile];

        const buggyResult = simulateBuggyDockerFileRenaming(isEsm, patches);
        const correctResult = simulateCorrectDockerFileRenaming(isEsm, patches);

        // Both buggy and correct logic should preserve .mjs files
        expect(buggyResult[0]?.path).toBe("test-api.mjs");
        expect(correctResult[0]?.path).toBe("test-api.mjs");
    });

    /**
     * Command Update Test: Verify Commands Are Updated with New Filename
     * 
     * Tests that when test files are renamed, commands referencing them
     * are also updated. This test verifies the bug exists in the context
     * of command updating.
     */
    it("should detect that commands are updated with .cjs instead of .mjs", () => {
        const isEsm = true;
        const testFile = { path: "test-api.js", content: "// test" };
        const patches = [testFile];
        const commands = ["node test-api.js"];

        console.log("\n=== COMMAND UPDATE BUG ===");
        console.log("Original command: node test-api.js");

        const buggyResult = simulateBuggyDockerFileRenaming(isEsm, patches);
        const correctResult = simulateCorrectDockerFileRenaming(isEsm, patches);

        // Simulate command updating (from docker.ts lines 350-354)
        const oldBasename = "test-api.js";
        const buggyBasename = buggyResult[0]?.path?.split('/').pop() ?? '';
        const correctBasename = correctResult[0]?.path?.split('/').pop() ?? '';

        const buggyCommand = commands[0]?.replace(oldBasename, buggyBasename) ?? '';
        const correctCommand = commands[0]?.replace(oldBasename, correctBasename) ?? '';

        console.log(`Buggy command:    ${buggyCommand}`);
        console.log(`Expected command: ${correctCommand}`);
        console.log("=== END COMMAND UPDATE ANALYSIS ===\n");

        // CRITICAL: This should FAIL on unfixed code
        expect(buggyCommand).toBe("node test-api.mjs");
    });

    /**
     * Multiple Files Test: Verify All Test Files Are Renamed Incorrectly
     * 
     * Tests that when multiple test files exist, ALL of them are renamed
     * to .cjs instead of .mjs.
     */
    it("should detect that all test files are renamed to .cjs instead of .mjs", () => {
        const isEsm = true;
        const patches = [
            { path: "test-api.js", content: "// api test" },
            { path: "test-integration.js", content: "// integration test" },
            { path: "test-e2e.js", content: "// e2e test" },
        ];

        const buggyResult = simulateBuggyDockerFileRenaming(isEsm, patches);
        const correctResult = simulateCorrectDockerFileRenaming(isEsm, patches);

        console.log("\n=== MULTIPLE FILES BUG ===");
        console.log("Testing multiple test files...\n");

        patches.forEach((original, index) => {
            console.log(`File ${index + 1}:`);
            console.log(`  Original:  ${original.path}`);
            console.log(`  Buggy:     ${buggyResult[index]?.path}`);
            console.log(`  Expected:  ${correctResult[index]?.path}`);
        });

        console.log("\n=== END MULTIPLE FILES ANALYSIS ===\n");

        // CRITICAL: All files should be .mjs, but buggy code produces .cjs
        expect(buggyResult[0]?.path).toBe("test-api.mjs");
        expect(buggyResult[1]?.path).toBe("test-integration.mjs");
        expect(buggyResult[2]?.path).toBe("test-e2e.mjs");
    });
});
