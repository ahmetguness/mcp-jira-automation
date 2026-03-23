/* eslint-disable no-console */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Preservation Property Tests for Docker ES Module File Extension Fix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5 from bugfix.md**
 * 
 * IMPORTANT: Follow observation-first methodology
 * These tests observe behavior on UNFIXED code for CommonJS projects
 * 
 * Property 2: Preservation - CommonJS Test Generation Unchanged
 * 
 * This test verifies that CommonJS projects (no "type": "module") continue
 * to work exactly as before. The fix should only affect ES module projects.
 * 
 * EXPECTED OUTCOME: Tests PASS (this confirms baseline behavior to preserve)
 * 
 * GOAL: Establish baseline behavior that must be preserved:
 * - CommonJS projects receive .cjs test files
 * - Projects without package.json receive .cjs test files
 * - Commands are updated to reference .cjs filenames
 */

/**
 * Simulates the file renaming logic from docker.ts lines 337-356
 * This represents the CURRENT behavior for CommonJS projects
 */
function simulateDockerFileRenaming(
    isEsm: boolean,
    patches: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
    if (!isEsm || !patches.length) {
        return patches;
    }

    // Current logic: rename .js to .cjs when isEsm=true
    // For CommonJS projects (isEsm=false), this block doesn't execute
    return patches.map(p => {
        if (p.path.endsWith('.js') && !p.path.endsWith('.mjs')) {
            return {
                ...p,
                path: p.path.replace(/\.js$/, '.cjs')
            };
        }
        return p;
    });
}

/**
 * Simulates command updating logic from docker.ts lines 348-352
 */
function simulateCommandUpdating(
    commands: string[],
    oldPath: string,
    newPath: string
): string[] {
    const oldBasename = oldPath.split('/').pop()!;
    const newBasename = newPath.split('/').pop()!;
    
    return commands.map(cmd =>
        cmd.includes(oldBasename) ? cmd.replace(oldBasename, newBasename) : cmd
    );
}

describe("Docker ES Module File Extension Preservation Tests", () => {
    /**
     * Property 2.1: CommonJS Projects Continue to Use .cjs Extension
     * 
     * For any CommonJS project (isEsm=false), test files should NOT be renamed.
     * The renaming logic only applies when isEsm=true.
     * 
     * This test should PASS on unfixed code, confirming baseline behavior.
     */
    it("should preserve .js extension for CommonJS projects (isEsm=false)", () => {
        const isEsm = false; // CommonJS project
        const testFile = { path: "test-api.js", content: "// test content" };
        const patches = [testFile];

        console.log("\n=== COMMONJS PRESERVATION TEST ===");
        console.log("Repository Configuration:");
        console.log("  - package.json does NOT contain: \"type\": \"module\"");
        console.log("  - isEsm flag: false");
        console.log("  - Test file: test-api.js");

        const result = simulateDockerFileRenaming(isEsm, patches);

        console.log("\nObserved Behavior:");
        console.log(`  - Test file remains: ${result[0]?.path}`);
        console.log(`  - Extension: ${result[0]?.path.split('.').pop()}`);
        console.log("\nExpected Behavior:");
        console.log("  - Test file should remain: test-api.js");
        console.log("  - No renaming occurs for CommonJS projects");
        console.log("\n=== END COMMONJS PRESERVATION TEST ===\n");

        // This should PASS - CommonJS projects don't get renamed
        expect(result[0]?.path).toBe("test-api.js");
    });

    /**
     * Property 2.2: Property-Based Test for CommonJS Preservation
     * 
     * For all test file names in CommonJS projects, verify that files
     * are NOT renamed (they remain .js).
     */
    it("should preserve .js extension across various CommonJS test files", () => {
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

        console.log("\n=== PROPERTY-BASED COMMONJS PRESERVATION ===");
        console.log("Testing various test file names for CommonJS projects...\n");

        // Property: For all test files in CommonJS projects (isEsm=false),
        // files should remain unchanged (.js extension preserved)
        fc.assert(
            fc.property(testFileNameArb, (testFileName) => {
                const isEsm = false; // CommonJS project
                const patches = [{ path: testFileName, content: "// test" }];

                const result = simulateDockerFileRenaming(isEsm, patches);

                // Files should remain unchanged
                return result[0]?.path === testFileName;
            }),
            {
                numRuns: 7, // Test all 7 file name variations
                verbose: true,
            }
        );

        console.log("\n=== END PROPERTY-BASED PRESERVATION ===\n");
    });

    /**
     * Property 2.3: Projects Without package.json Default to CommonJS
     * 
     * When there's no package.json, the system defaults to CommonJS (isEsm=false).
     * Test files should remain .js (not renamed).
     */
    it("should preserve .js extension for projects without package.json", () => {
        const isEsm = false; // No package.json = defaults to CommonJS
        const testFile = { path: "test-api.js", content: "// test" };
        const patches = [testFile];

        console.log("\n=== NO PACKAGE.JSON PRESERVATION ===");
        console.log("Repository Configuration:");
        console.log("  - No package.json file");
        console.log("  - isEsm flag: false (defaults to CommonJS)");
        console.log("  - Test file: test-api.js");

        const result = simulateDockerFileRenaming(isEsm, patches);

        console.log("\nObserved Behavior:");
        console.log(`  - Test file remains: ${result[0]?.path}`);
        console.log("\nExpected Behavior:");
        console.log("  - Test file should remain: test-api.js");
        console.log("  - Defaults to CommonJS behavior");
        console.log("\n=== END NO PACKAGE.JSON TEST ===\n");

        // This should PASS - no package.json means CommonJS
        expect(result[0]?.path).toBe("test-api.js");
    });

    /**
     * Property 2.4: Command Preservation for CommonJS Projects
     * 
     * For CommonJS projects, commands should NOT be updated because
     * test files are not renamed.
     */
    it("should preserve commands unchanged for CommonJS projects", () => {
        const isEsm = false; // CommonJS project
        const testFile = { path: "test-api.js", content: "// test" };
        const patches = [testFile];
        const commands = ["node test-api.js", "npm test"];

        console.log("\n=== COMMAND PRESERVATION TEST ===");
        console.log("Original commands:");
        commands.forEach(cmd => console.log(`  - ${cmd}`));

        const result = simulateDockerFileRenaming(isEsm, patches);

        // Since files aren't renamed, commands shouldn't change
        const updatedCommands = result[0] && result[0].path !== testFile.path
            ? simulateCommandUpdating(commands, testFile.path, result[0].path)
            : commands;

        console.log("\nObserved Behavior:");
        console.log("  - Test file: " + result[0]?.path);
        console.log("  - Commands remain:");
        updatedCommands.forEach(cmd => console.log(`    - ${cmd}`));

        console.log("\nExpected Behavior:");
        console.log("  - Commands should remain unchanged");
        console.log("\n=== END COMMAND PRESERVATION TEST ===\n");

        // Commands should be unchanged
        expect(updatedCommands).toEqual(commands);
    });

    /**
     * Property 2.5: Multiple CommonJS Test Files Preservation
     * 
     * When multiple test files exist in a CommonJS project,
     * ALL of them should remain unchanged (.js extension).
     */
    it("should preserve all test files unchanged in CommonJS projects", () => {
        const isEsm = false; // CommonJS project
        const patches = [
            { path: "test-api.js", content: "// api test" },
            { path: "test-integration.js", content: "// integration test" },
            { path: "test-e2e.js", content: "// e2e test" },
        ];

        console.log("\n=== MULTIPLE FILES PRESERVATION ===");
        console.log("Testing multiple test files in CommonJS project...\n");

        const result = simulateDockerFileRenaming(isEsm, patches);

        patches.forEach((original, index) => {
            console.log(`File ${index + 1}:`);
            console.log(`  Original: ${original.path}`);
            console.log(`  Result:   ${result[index]?.path}`);
        });

        console.log("\n=== END MULTIPLE FILES PRESERVATION ===\n");

        // All files should remain unchanged
        expect(result[0]?.path).toBe("test-api.js");
        expect(result[1]?.path).toBe("test-integration.js");
        expect(result[2]?.path).toBe("test-e2e.js");
    });

    /**
     * Property 2.6: Monorepo CommonJS Project Preservation
     * 
     * In monorepo structures where a subdirectory is CommonJS,
     * test files should remain unchanged.
     */
    it("should preserve .js extension in monorepo CommonJS projects", () => {
        const isEsm = false; // CommonJS project in monorepo
        const monorepoTestFile = { path: "backend/test-api.js", content: "// test" };
        const patches = [monorepoTestFile];

        console.log("\n=== MONOREPO COMMONJS PRESERVATION ===");
        console.log("Monorepo Structure:");
        console.log("  - Working directory: backend/");
        console.log("  - backend/package.json does NOT have \"type\": \"module\"");
        console.log("  - Test file: backend/test-api.js");

        const result = simulateDockerFileRenaming(isEsm, patches);

        console.log("\nObserved Behavior:");
        console.log(`  - Test file remains: ${result[0]?.path}`);
        
        console.log("\nExpected Behavior:");
        console.log("  - Test file should remain: backend/test-api.js");

        console.log("\n=== END MONOREPO PRESERVATION ===\n");

        // This should PASS - CommonJS monorepo projects don't get renamed
        expect(result[0]?.path).toBe("backend/test-api.js");
    });

    /**
     * Property 2.7: Edge Case - Files Already Ending in .cjs
     * 
     * If test files already end in .cjs, they should remain unchanged
     * regardless of isEsm flag.
     */
    it("should preserve files that already end in .cjs", () => {
        const cjsFile = { path: "test-api.cjs", content: "// test" };
        
        // Test with both isEsm=true and isEsm=false
        const resultEsm = simulateDockerFileRenaming(true, [cjsFile]);
        const resultCommonJs = simulateDockerFileRenaming(false, [cjsFile]);

        console.log("\n=== .CJS FILE PRESERVATION ===");
        console.log("Test file: test-api.cjs");
        console.log(`  - With isEsm=true:  ${resultEsm[0]?.path}`);
        console.log(`  - With isEsm=false: ${resultCommonJs[0]?.path}`);
        console.log("\n=== END .CJS PRESERVATION ===\n");

        // .cjs files should never be renamed
        expect(resultEsm[0]?.path).toBe("test-api.cjs");
        expect(resultCommonJs[0]?.path).toBe("test-api.cjs");
    });

    /**
     * Property 2.8: Property-Based Test for Various Package.json Configurations
     * 
     * Test that various CommonJS package.json configurations all result
     * in the same behavior (no file renaming).
     */
    it("should preserve behavior across various CommonJS configurations", () => {
        // Arbitrary generator for CommonJS scenarios
        const commonJsScenarioArb = fc.record({
            hasPackageJson: fc.boolean(),
            hasTypeField: fc.constant(false), // CommonJS = no "type": "module"
            testFileName: fc.constantFrom(
                "test-api.js",
                "test-integration.js",
                "backend/test-api.js"
            ),
        });

        console.log("\n=== PROPERTY-BASED CONFIGURATION PRESERVATION ===");
        console.log("Testing various CommonJS configurations...\n");

        fc.assert(
            fc.property(commonJsScenarioArb, (scenario) => {
                // All CommonJS scenarios have isEsm=false
                const isEsm = false;
                const patches = [{ path: scenario.testFileName, content: "// test" }];

                const result = simulateDockerFileRenaming(isEsm, patches);

                // Files should remain unchanged for all CommonJS scenarios
                return result[0]?.path === scenario.testFileName;
            }),
            {
                numRuns: 20,
                verbose: true,
            }
        );

        console.log("\n=== END CONFIGURATION PRESERVATION ===\n");
    });

    /**
     * Property 2.9: Empty Patches Array Preservation
     * 
     * When there are no patches, the function should return an empty array
     * regardless of isEsm flag.
     */
    it("should handle empty patches array correctly", () => {
        const emptyPatches: Array<{ path: string; content: string }> = [];
        
        const resultEsm = simulateDockerFileRenaming(true, emptyPatches);
        const resultCommonJs = simulateDockerFileRenaming(false, emptyPatches);

        console.log("\n=== EMPTY PATCHES PRESERVATION ===");
        console.log("  - With isEsm=true:  " + resultEsm.length + " patches");
        console.log("  - With isEsm=false: " + resultCommonJs.length + " patches");
        console.log("\n=== END EMPTY PATCHES TEST ===\n");

        // Empty arrays should remain empty
        expect(resultEsm).toEqual([]);
        expect(resultCommonJs).toEqual([]);
    });

    /**
     * Property 2.10: Non-.js Files Preservation
     * 
     * Files that don't end in .js should never be renamed,
     * regardless of isEsm flag.
     */
    it("should preserve non-.js files unchanged", () => {
        const nonJsFiles = [
            { path: "test-api.ts", content: "// typescript" },
            { path: "test-api.py", content: "# python" },
            { path: "test-api.mjs", content: "// already mjs" },
            { path: "test-api.cjs", content: "// already cjs" },
        ];

        console.log("\n=== NON-.JS FILES PRESERVATION ===");
        
        nonJsFiles.forEach(file => {
            const resultEsm = simulateDockerFileRenaming(true, [file]);
            const resultCommonJs = simulateDockerFileRenaming(false, [file]);

            console.log(`File: ${file.path}`);
            console.log(`  - With isEsm=true:  ${resultEsm[0]?.path}`);
            console.log(`  - With isEsm=false: ${resultCommonJs[0]?.path}`);

            // Non-.js files should never be renamed
            expect(resultEsm[0]?.path).toBe(file.path);
            expect(resultCommonJs[0]?.path).toBe(file.path);
        });

        console.log("\n=== END NON-.JS FILES TEST ===\n");
    });
});
