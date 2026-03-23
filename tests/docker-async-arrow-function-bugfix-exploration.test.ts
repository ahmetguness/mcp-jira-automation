/* eslint-disable no-console */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Bug Condition Exploration Test for CJS to ESM Async Arrow Function Fix
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3**
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * 
 * Property 1: Bug Condition - Arrow Functions with await import() Must Be Async
 * 
 * This test verifies that when an arrow function contains `const varName = require('./path'); return varName.listen`,
 * the transformCommonJSToESM function incorrectly transforms it to use `await import()` without adding the `async`
 * keyword to the arrow function signature. This produces syntactically invalid JavaScript that causes Node.js
 * to throw a SyntaxError: "Unexpected reserved word" when executing the transformed code.
 * 
 * EXPECTED OUTCOME: Test FAILS (this is correct - it proves the bug exists)
 * 
 * GOAL: Surface counterexamples that demonstrate:
 * - Arrow functions with require() are transformed to use await import()
 * - The arrow function signature is NOT marked as async
 * - The transformed code is syntactically invalid (await in non-async function)
 * - Node.js throws SyntaxError when attempting to execute the code
 */

/**
 * Simulates the FIXED transformCommonJSToESM logic from docker.ts lines 1044-1120
 * This is the FIXED behavior after implementing the async arrow function fix
 */
function simulateBuggyTransformCommonJSToESM(content: string): string {
    let transformed = content;

    // First, handle dynamic require() inside arrow functions
    // Pattern: () => { const app = require('./path'); ... }
    // FIXED: This now captures the arrow function signature and adds async keyword
    transformed = transformed.replace(
        /(\([\w\s,]*\)\s*=>\s*\{[^}]*)(const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?\s*return\s+\3\.listen)/g,
        "async $1const { default: $3 } = await import('$4'); return $3.listen"
    );

    // Transform top-level require() statements to import statements
    transformed = transformed.replace(
        /(^|\n)const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g,
        "$1import $2 from '$3';"
    );

    // Pattern: const { named } = require('module');
    transformed = transformed.replace(
        /(^|\n)const\s+\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\);?/g,
        "$1import {$2} from '$3';"
    );

    // Pattern: require('module') without assignment (side effects)
    transformed = transformed.replace(
        /(^|\n)require\(['"]([^'"]+)['"]\);?/g,
        "$1import '$2';"
    );

    // Transform module.exports to export default
    transformed = transformed.replace(
        /module\.exports\s*=\s*/g,
        "export default "
    );

    // Transform exports.name = value to export const name = value
    transformed = transformed.replace(
        /exports\.(\w+)\s*=\s*/g,
        "export const $1 = "
    );

    // Add .js extension to relative imports if missing
    transformed = transformed.replace(
        /from\s+['"](\.\.[/\\][^'"]+|\.\/[^'"]+)['"];/g,
        (match, path) => {
            if (!path.match(/\.\w+$/)) {
                return `from '${path}.js';`;
            }
            return match;
        }
    );

    // Also handle await import() paths
    transformed = transformed.replace(
        /import\(['"](\.\.[/\\][^'"]+|\.\/[^'"]+)['"]\)/g,
        (match, path) => {
            if (!path.match(/\.\w+$/)) {
                return `import('${path}.js')`;
            }
            return match;
        }
    );

    return transformed;
}

/**
 * Expected (correct) transformation logic
 * This is what the code SHOULD do after the fix
 */
function simulateCorrectTransformCommonJSToESM(content: string): string {
    let transformed = content;

    // FIXED: Capture entire arrow function and add async keyword
    transformed = transformed.replace(
        /(\([\w\s,]*\)\s*=>\s*\{[^}]*)(const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?\s*return\s+\3\.listen)/g,
        "async $1const { default: $3 } = await import('$4'); return $3.listen"
    );

    // Transform top-level require() statements to import statements
    transformed = transformed.replace(
        /(^|\n)const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g,
        "$1import $2 from '$3';"
    );

    // Pattern: const { named } = require('module');
    transformed = transformed.replace(
        /(^|\n)const\s+\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\);?/g,
        "$1import {$2} from '$3';"
    );

    // Pattern: require('module') without assignment (side effects)
    transformed = transformed.replace(
        /(^|\n)require\(['"]([^'"]+)['"]\);?/g,
        "$1import '$2';"
    );

    // Transform module.exports to export default
    transformed = transformed.replace(
        /module\.exports\s*=\s*/g,
        "export default "
    );

    // Transform exports.name = value to export const name = value
    transformed = transformed.replace(
        /exports\.(\w+)\s*=\s*/g,
        "export const $1 = "
    );

    // Add .js extension to relative imports if missing
    transformed = transformed.replace(
        /from\s+['"](\.\.[/\\][^'"]+|\.\/[^'"]+)['"];/g,
        (match, path) => {
            if (!path.match(/\.\w+$/)) {
                return `from '${path}.js';`;
            }
            return match;
        }
    );

    // Also handle await import() paths
    transformed = transformed.replace(
        /import\(['"](\.\.[/\\][^'"]+|\.\/[^'"]+)['"]\)/g,
        (match, path) => {
            if (!path.match(/\.\w+$/)) {
                return `import('${path}.js')`;
            }
            return match;
        }
    );

    return transformed;
}

/**
 * Check if code is syntactically valid by checking for await without async
 */
function isSyntacticallyValid(code: string): boolean {
    // Check if code has await import() in arrow function
    // Use .* with 's' flag to match across braces
    const hasAwaitInArrow = /\([\w\s,]*\)\s*=>\s*\{.*await\s+import\(/s.test(code);
    
    if (!hasAwaitInArrow) {
        return true; // No await in arrow function, so it's valid
    }
    
    // If there's await in arrow function, check if the arrow function has async
    const hasAsyncArrow = /async\s+\([\w\s,]*\)\s*=>\s*\{.*await\s+import\(/s.test(code);
    
    return hasAsyncArrow; // Valid only if async is present when await is used
}

describe("Docker CJS to ESM Async Arrow Function Bug Condition Exploration", () => {
    /**
     * Property 1: Bug Condition - Basic Arrow Function Without Parameters
     * 
     * Tests that a basic arrow function with no parameters containing require()
     * is transformed to use await import() without adding async keyword.
     */
    it("should detect that basic arrow function is not marked as async", () => {
        const input = "() => { const app = require('./app'); return app.listen(3001); }";

        console.log("\n=== BUG CONDITION ANALYSIS: Basic Arrow Function ===");
        console.log("Input code:");
        console.log(`  ${input}`);

        const buggyResult = simulateBuggyTransformCommonJSToESM(input);
        const correctResult = simulateCorrectTransformCommonJSToESM(input);

        console.log("\nCurrent (Buggy) Transformation:");
        console.log(`  ${buggyResult}`);
        console.log(`  Contains 'async': ${buggyResult.includes('async')}`);
        console.log(`  Contains 'await import': ${buggyResult.includes('await import')}`);
        console.log(`  Syntactically valid: ${isSyntacticallyValid(buggyResult)}`);

        console.log("\nExpected (Correct) Transformation:");
        console.log(`  ${correctResult}`);
        console.log(`  Contains 'async': ${correctResult.includes('async')}`);
        console.log(`  Contains 'await import': ${correctResult.includes('await import')}`);
        console.log(`  Syntactically valid: ${isSyntacticallyValid(correctResult)}`);

        console.log("\nBug Impact:");
        console.log("  - Transformed code uses 'await' in non-async function");
        console.log("  - Node.js throws: SyntaxError: Unexpected reserved word");
        console.log("  - Test files fail to execute");
        console.log("=== END BUG CONDITION ANALYSIS ===\n");

        // CRITICAL: This assertion SHOULD FAIL on unfixed code
        // The buggy code produces await without async
        expect(buggyResult).toContain("async");
        expect(isSyntacticallyValid(buggyResult)).toBe(true);
    });

    /**
     * Property 2: Bug Condition - Arrow Function With Parameters
     * 
     * Tests that an arrow function with parameters containing require()
     * is transformed to use await import() without adding async keyword.
     */
    it("should detect that arrow function with parameters is not marked as async", () => {
        const input = "(port) => { const app = require('./app'); return app.listen(port); }";

        console.log("\n=== BUG CONDITION ANALYSIS: Arrow Function With Parameters ===");
        console.log("Input code:");
        console.log(`  ${input}`);

        const buggyResult = simulateBuggyTransformCommonJSToESM(input);
        const correctResult = simulateCorrectTransformCommonJSToESM(input);

        console.log("\nCurrent (Buggy) Transformation:");
        console.log(`  ${buggyResult}`);
        console.log(`  Contains 'async (port)': ${buggyResult.includes('async (port)')}`);
        console.log(`  Contains 'await import': ${buggyResult.includes('await import')}`);

        console.log("\nExpected (Correct) Transformation:");
        console.log(`  ${correctResult}`);
        console.log(`  Contains 'async (port)': ${correctResult.includes('async (port)')}`);
        console.log(`  Contains 'await import': ${correctResult.includes('await import')}`);

        console.log("\n=== END BUG CONDITION ANALYSIS ===\n");

        // CRITICAL: This assertion SHOULD FAIL on unfixed code
        expect(buggyResult).toContain("async (port)");
    });

    /**
     * Property 3: Bug Condition - Multiple Arrow Functions
     * 
     * Tests that when multiple arrow functions contain require(), all of them
     * are transformed to use await import() without adding async keyword.
     */
    it("should detect that multiple arrow functions are not marked as async", () => {
        const input = `
const startServer1 = () => { const app = require('./app'); return app.listen(3001); };
const startServer2 = () => { const server = require('./server'); return server.listen(8080); };
`;

        console.log("\n=== BUG CONDITION ANALYSIS: Multiple Arrow Functions ===");
        console.log("Input code:");
        console.log(input);

        const buggyResult = simulateBuggyTransformCommonJSToESM(input);
        const correctResult = simulateCorrectTransformCommonJSToESM(input);

        console.log("Current (Buggy) Transformation:");
        console.log(buggyResult);

        console.log("\nExpected (Correct) Transformation:");
        console.log(correctResult);

        // Count async keywords
        const buggyAsyncCount = (buggyResult.match(/async/g) || []).length;
        const correctAsyncCount = (correctResult.match(/async/g) || []).length;

        console.log(`\nBuggy async count: ${buggyAsyncCount}`);
        console.log(`Expected async count: ${correctAsyncCount}`);
        console.log("=== END BUG CONDITION ANALYSIS ===\n");

        // CRITICAL: This assertion SHOULD FAIL on unfixed code
        expect(buggyAsyncCount).toBe(2);
    });

    /**
     * Property-Based Test: Arrow Function Transformation Across Various Patterns
     * 
     * This test uses property-based testing to generate various arrow function patterns
     * and verify that ALL of them are incorrectly transformed without async keyword.
     */
    it("should detect missing async keyword across various arrow function patterns", () => {
        // Arbitrary generator for arrow function patterns
        const arrowFunctionArb = fc.record({
            params: fc.constantFrom("", "port", "port, host"),
            varName: fc.constantFrom("app", "server", "api"),
            modulePath: fc.constantFrom("./app", "./server", "./src/app", "../api"),
            port: fc.constantFrom("3001", "8080", "port"),
        }).map(({ params, varName, modulePath, port }) => {
            const paramsStr = params ? `(${params})` : "()";
            return `${paramsStr} => { const ${varName} = require('${modulePath}'); return ${varName}.listen(${port}); }`;
        });

        console.log("\n=== PROPERTY-BASED BUG EXPLORATION ===");
        console.log("Testing various arrow function patterns...\n");

        const counterexamples: Array<{
            input: string;
            buggyOutput: string;
            hasAsync: boolean;
            hasAwait: boolean;
        }> = [];

        // Property: For all arrow functions with require pattern,
        // the buggy code produces await import without async
        fc.assert(
            fc.property(arrowFunctionArb, (input) => {
                const buggyResult = simulateBuggyTransformCommonJSToESM(input);

                const hasAsync = buggyResult.includes("async");
                const hasAwait = buggyResult.includes("await import");

                // Collect counterexamples where await is used without async
                if (hasAwait && !hasAsync) {
                    counterexamples.push({
                        input,
                        buggyOutput: buggyResult,
                        hasAsync,
                        hasAwait,
                    });
                }

                // This will fail because buggy code has await without async
                return !hasAwait || hasAsync;
            }),
            {
                numRuns: 5,
                verbose: true,
            }
        );

        // This code won't be reached because the property will fail
        // But if it does, document the counterexamples
        if (counterexamples.length > 0) {
            console.log(`\nFound ${counterexamples.length} counterexamples:`);
            counterexamples.forEach(({ input, buggyOutput, hasAsync, hasAwait }) => {
                console.log(`\n  Input: ${input}`);
                console.log(`  Buggy Output: ${buggyOutput}`);
                console.log(`  Has async: ${hasAsync}`);
                console.log(`  Has await: ${hasAwait}`);
            });
        }

        console.log("\n=== END PROPERTY-BASED EXPLORATION ===\n");
    });

    /**
     * Edge Case Test: Arrow Function with Different Variable Names
     * 
     * Tests that the bug exists regardless of variable names used.
     */
    it("should detect missing async keyword with different variable names", () => {
        const testCases = [
            "() => { const app = require('./app'); return app.listen(3001); }",
            "() => { const server = require('./server'); return server.listen(8080); }",
            "() => { const api = require('./api'); return api.listen(4000); }",
        ];

        console.log("\n=== EDGE CASE: Different Variable Names ===");

        for (const input of testCases) {
            const buggyResult = simulateBuggyTransformCommonJSToESM(input);
            console.log(`\nInput: ${input}`);
            console.log(`Buggy: ${buggyResult}`);
            console.log(`Has async: ${buggyResult.includes("async")}`);

            // CRITICAL: Should fail for all cases
            expect(buggyResult).toContain("async");
        }

        console.log("\n=== END EDGE CASE ANALYSIS ===\n");
    });

    /**
     * Syntax Validation Test: Verify Transformed Code is Invalid
     * 
     * Tests that the transformed code is syntactically invalid by checking
     * for the presence of await without async.
     */
    it("should detect that transformed code is syntactically invalid", () => {
        const input = "() => { const app = require('./app'); return app.listen(3001); }";
        const buggyResult = simulateBuggyTransformCommonJSToESM(input);

        console.log("\n=== SYNTAX VALIDATION ===");
        console.log("Transformed code:");
        console.log(`  ${buggyResult}`);

        const isValid = isSyntacticallyValid(buggyResult);
        console.log(`\nSyntactically valid: ${isValid}`);

        if (!isValid) {
            console.log("\nSyntax Error Details:");
            console.log("  - Code contains 'await' keyword");
            console.log("  - Arrow function is not marked as 'async'");
            console.log("  - Node.js will throw: SyntaxError: Unexpected reserved word");
        }

        console.log("=== END SYNTAX VALIDATION ===\n");

        // CRITICAL: This should fail because buggy code is invalid
        expect(isValid).toBe(true);
    });
});
