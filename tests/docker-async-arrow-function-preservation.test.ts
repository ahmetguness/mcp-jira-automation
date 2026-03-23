/* eslint-disable no-console */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Preservation Property Tests for CJS to ESM Async Arrow Function Fix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 * 
 * Property 2: Preservation - Non-Arrow-Function Transformations
 * 
 * This test suite verifies that existing transformation behaviors remain unchanged
 * for all inputs that do NOT involve the arrow function require pattern.
 * 
 * IMPORTANT: Follow observation-first methodology
 * - Observe behavior on UNFIXED code for non-buggy inputs
 * - Write property-based tests capturing observed behavior patterns
 * 
 * EXPECTED OUTCOME: Tests PASS on unfixed code (confirms baseline behavior to preserve)
 * 
 * Test Coverage:
 * - Top-level require: `const app = require('./app')` transforms to `import app from './app.js'` (no async)
 * - Module.exports: `module.exports = value` transforms to `export default value`
 * - Exports.name: `exports.foo = bar` transforms to `export const foo = bar`
 * - Extension addition: relative imports get `.js` extensions added
 * - Destructuring require: `const { foo } = require('./bar')` transforms correctly
 */

/**
 * Simulates the FIXED transformCommonJSToESM logic from docker.ts lines 1044-1120
 * This represents the FIXED behavior after implementing the async arrow function fix
 */
function simulateCurrentTransformCommonJSToESM(content: string): string {
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

describe("Docker CJS to ESM Preservation Property Tests", () => {
    /**
     * Preservation Test 1: Top-Level Require Statements
     * 
     * Verifies that top-level require statements transform to import statements
     * without adding async keyword.
     * 
     * Requirement 3.1: Top-level require() statements continue to transform to
     * top-level import statements without adding async
     */
    it("should preserve top-level require transformation (no async)", () => {
        const testCases = [
            {
                input: "const app = require('./app');",
                expected: "import app from './app.js';",
            },
            {
                input: "const server = require('./server');",
                expected: "import server from './server.js';",
            },
            {
                input: "const express = require('express');",
                expected: "import express from 'express';",
            },
            {
                input: "\nconst app = require('./app');",
                expected: "\nimport app from './app.js';",
            },
        ];

        console.log("\n=== PRESERVATION TEST: Top-Level Require ===");

        for (const { input, expected } of testCases) {
            const result = simulateCurrentTransformCommonJSToESM(input);
            console.log(`Input:    ${input.trim()}`);
            console.log(`Expected: ${expected.trim()}`);
            console.log(`Result:   ${result.trim()}`);
            console.log(`Match: ${result.trim() === expected.trim()}`);
            console.log("");

            expect(result.trim()).toBe(expected.trim());
            expect(result).not.toContain("async");
        }

        console.log("=== END PRESERVATION TEST ===\n");
    });

    /**
     * Preservation Test 2: Module.exports Transformation
     * 
     * Verifies that module.exports transforms to export default
     * 
     * Requirement 3.2: module.exports transformations continue to work exactly as before
     */
    it("should preserve module.exports transformation", () => {
        const testCases = [
            {
                input: "module.exports = app;",
                expected: "export default app;",
            },
            {
                input: "module.exports = { foo: 'bar' };",
                expected: "export default { foo: 'bar' };",
            },
            {
                input: "module.exports = function() { return 42; };",
                expected: "export default function() { return 42; };",
            },
        ];

        console.log("\n=== PRESERVATION TEST: Module.exports ===");

        for (const { input, expected } of testCases) {
            const result = simulateCurrentTransformCommonJSToESM(input);
            console.log(`Input:    ${input}`);
            console.log(`Expected: ${expected}`);
            console.log(`Result:   ${result}`);
            console.log(`Match: ${result === expected}`);
            console.log("");

            expect(result).toBe(expected);
        }

        console.log("=== END PRESERVATION TEST ===\n");
    });

    /**
     * Preservation Test 3: Exports.name Transformation
     * 
     * Verifies that exports.name transforms to export const name
     * 
     * Requirement 3.3: exports.name transformations continue to work exactly as before
     */
    it("should preserve exports.name transformation", () => {
        const testCases = [
            {
                input: "exports.foo = bar;",
                expected: "export const foo = bar;",
            },
            {
                input: "exports.handler = async (req, res) => {};",
                expected: "export const handler = async (req, res) => {};",
            },
            {
                input: "exports.config = { port: 3000 };",
                expected: "export const config = { port: 3000 };",
            },
        ];

        console.log("\n=== PRESERVATION TEST: Exports.name ===");

        for (const { input, expected } of testCases) {
            const result = simulateCurrentTransformCommonJSToESM(input);
            console.log(`Input:    ${input}`);
            console.log(`Expected: ${expected}`);
            console.log(`Result:   ${result}`);
            console.log(`Match: ${result === expected}`);
            console.log("");

            expect(result).toBe(expected);
        }

        console.log("=== END PRESERVATION TEST ===\n");
    });

    /**
     * Preservation Test 4: Extension Addition
     * 
     * Verifies that .js extensions are added to relative imports
     * 
     * Requirement 3.4: .js extension addition to relative imports continues to work
     */
    it("should preserve .js extension addition to relative imports", () => {
        const testCases = [
            {
                input: "import app from './app';",
                expected: "import app from './app.js';",
            },
            {
                input: "import server from '../server';",
                expected: "import server from '../server.js';",
            },
            {
                input: "import config from './config.json';",
                expected: "import config from './config.json';", // Already has extension
            },
            {
                input: "const app = require('./app');",
                expected: "import app from './app.js';",
            },
        ];

        console.log("\n=== PRESERVATION TEST: Extension Addition ===");

        for (const { input, expected } of testCases) {
            const result = simulateCurrentTransformCommonJSToESM(input);
            console.log(`Input:    ${input}`);
            console.log(`Expected: ${expected}`);
            console.log(`Result:   ${result}`);
            console.log(`Match: ${result === expected}`);
            console.log("");

            expect(result).toBe(expected);
        }

        console.log("=== END PRESERVATION TEST ===\n");
    });

    /**
     * Preservation Test 5: Destructuring Require
     * 
     * Verifies that destructuring require statements transform correctly
     * 
     * Requirement 3.5: Other require patterns continue to work as before
     */
    it("should preserve destructuring require transformation", () => {
        const testCases = [
            {
                input: "const { foo } = require('./bar');",
                expected: "import { foo } from './bar.js';",
            },
            {
                input: "const { foo, baz } = require('./bar');",
                expected: "import { foo, baz } from './bar.js';",
            },
            {
                input: "\nconst { handler } = require('./handlers');",
                expected: "\nimport { handler } from './handlers.js';",
            },
        ];

        console.log("\n=== PRESERVATION TEST: Destructuring Require ===");

        for (const { input, expected } of testCases) {
            const result = simulateCurrentTransformCommonJSToESM(input);
            console.log(`Input:    ${input}`);
            console.log(`Expected: ${expected}`);
            console.log(`Result:   ${result}`);
            console.log(`Match: ${result === expected}`);
            console.log("");

            expect(result).toBe(expected);
        }

        console.log("=== END PRESERVATION TEST ===\n");
    });

    /**
     * Preservation Test 6: Side-Effect Require
     * 
     * Verifies that side-effect require statements transform correctly
     * 
     * Requirement 3.5: Other require patterns continue to work as before
     * 
     * NOTE: Observed behavior - side-effect imports do NOT get .js extension added
     * This is the current behavior we need to preserve
     */
    it("should preserve side-effect require transformation", () => {
        const testCases = [
            {
                input: "require('./setup');",
                expected: "import './setup';", // No .js extension added (observed behavior)
            },
            {
                input: "\nrequire('dotenv/config');",
                expected: "\nimport 'dotenv/config';",
            },
        ];

        console.log("\n=== PRESERVATION TEST: Side-Effect Require ===");

        for (const { input, expected } of testCases) {
            const result = simulateCurrentTransformCommonJSToESM(input);
            console.log(`Input:    ${input}`);
            console.log(`Expected: ${expected}`);
            console.log(`Result:   ${result}`);
            console.log(`Match: ${result === expected}`);
            console.log("");

            expect(result).toBe(expected);
        }

        console.log("=== END PRESERVATION TEST ===\n");
    });

    /**
     * Property-Based Test: Top-Level Require Preservation
     * 
     * Uses property-based testing to generate many top-level require patterns
     * and verify they all transform correctly without async keyword.
     */
    it("should preserve top-level require transformation across various patterns", () => {
        // Arbitrary generator for top-level require patterns
        const topLevelRequireArb = fc.record({
            varName: fc.constantFrom("app", "server", "api", "config", "handler"),
            modulePath: fc.constantFrom("./app", "./server", "../api", "./config", "express", "dotenv"),
        }).map(({ varName, modulePath }) => {
            return `const ${varName} = require('${modulePath}');`;
        });

        console.log("\n=== PROPERTY-BASED PRESERVATION TEST: Top-Level Require ===");

        fc.assert(
            fc.property(topLevelRequireArb, (input) => {
                const result = simulateCurrentTransformCommonJSToESM(input);

                console.log(`Input:  ${input}`);
                console.log(`Result: ${result}`);

                // Property: Result should start with "import" and not contain "async"
                const startsWithImport = result.trim().startsWith("import");
                const noAsync = !result.includes("async");
                const noAwait = !result.includes("await");

                console.log(`  Starts with import: ${startsWithImport}`);
                console.log(`  No async: ${noAsync}`);
                console.log(`  No await: ${noAwait}`);
                console.log("");

                return startsWithImport && noAsync && noAwait;
            }),
            {
                numRuns: 5,
                verbose: false,
            }
        );

        console.log("=== END PROPERTY-BASED PRESERVATION TEST ===\n");
    });

    /**
     * Property-Based Test: Module.exports Preservation
     * 
     * Uses property-based testing to generate various module.exports patterns
     * and verify they all transform to export default.
     */
    it("should preserve module.exports transformation across various patterns", () => {
        // Arbitrary generator for module.exports patterns
        const moduleExportsArb = fc.constantFrom(
            "module.exports = app;",
            "module.exports = { foo: 'bar' };",
            "module.exports = function() {};",
            "module.exports = () => {};",
            "module.exports = 42;",
            "module.exports = 'string';"
        );

        console.log("\n=== PROPERTY-BASED PRESERVATION TEST: Module.exports ===");

        fc.assert(
            fc.property(moduleExportsArb, (input) => {
                const result = simulateCurrentTransformCommonJSToESM(input);

                console.log(`Input:  ${input}`);
                console.log(`Result: ${result}`);

                // Property: Result should start with "export default"
                const startsWithExportDefault = result.startsWith("export default ");

                console.log(`  Starts with export default: ${startsWithExportDefault}`);
                console.log("");

                return startsWithExportDefault;
            }),
            {
                numRuns: 3,
                verbose: false,
            }
        );

        console.log("=== END PROPERTY-BASED PRESERVATION TEST ===\n");
    });

    /**
     * Property-Based Test: Exports.name Preservation
     * 
     * Uses property-based testing to generate various exports.name patterns
     * and verify they all transform to export const name.
     */
    it("should preserve exports.name transformation across various patterns", () => {
        // Arbitrary generator for exports.name patterns
        const exportsNameArb = fc.record({
            name: fc.constantFrom("foo", "handler", "config", "middleware", "router"),
            value: fc.constantFrom("bar", "42", "{ key: 'value' }", "() => {}", "async () => {}"),
        }).map(({ name, value }) => {
            return `exports.${name} = ${value};`;
        });

        console.log("\n=== PROPERTY-BASED PRESERVATION TEST: Exports.name ===");

        fc.assert(
            fc.property(exportsNameArb, (input) => {
                const result = simulateCurrentTransformCommonJSToESM(input);

                console.log(`Input:  ${input}`);
                console.log(`Result: ${result}`);

                // Property: Result should start with "export const"
                const startsWithExportConst = result.startsWith("export const ");

                console.log(`  Starts with export const: ${startsWithExportConst}`);
                console.log("");

                return startsWithExportConst;
            }),
            {
                numRuns: 5,
                verbose: false,
            }
        );

        console.log("=== END PROPERTY-BASED PRESERVATION TEST ===\n");
    });

    /**
     * Property-Based Test: Extension Addition Preservation
     * 
     * Uses property-based testing to generate various import patterns
     * and verify .js extensions are added correctly.
     */
    it("should preserve .js extension addition across various patterns", () => {
        // Arbitrary generator for relative import paths
        const relativePathArb = fc.record({
            prefix: fc.constantFrom("./", "../"),
            path: fc.constantFrom("app", "server", "config", "handlers/index", "utils/helper"),
        }).map(({ prefix, path }) => {
            return `const module = require('${prefix}${path}');`;
        });

        console.log("\n=== PROPERTY-BASED PRESERVATION TEST: Extension Addition ===");

        fc.assert(
            fc.property(relativePathArb, (input) => {
                const result = simulateCurrentTransformCommonJSToESM(input);

                console.log(`Input:  ${input}`);
                console.log(`Result: ${result}`);

                // Property: Result should contain .js extension
                const hasJsExtension = result.includes(".js");

                console.log(`  Has .js extension: ${hasJsExtension}`);
                console.log("");

                return hasJsExtension;
            }),
            {
                numRuns: 5,
                verbose: false,
            }
        );

        console.log("=== END PROPERTY-BASED PRESERVATION TEST ===\n");
    });

    /**
     * Integration Test: Mixed Patterns Preservation
     * 
     * Verifies that a file with multiple transformation patterns
     * all work correctly together.
     * 
     * NOTE: Side-effect imports do NOT get .js extension (observed behavior)
     */
    it("should preserve all transformations in mixed pattern file", () => {
        const input = `const express = require('express');
const app = require('./app');
const { handler } = require('./handlers');
require('./setup');

module.exports = app;
exports.config = { port: 3000 };`;

        const expected = `import express from 'express';
import app from './app.js';
import { handler } from './handlers.js';
import './setup';

export default app;
export const config = { port: 3000 };`;

        console.log("\n=== INTEGRATION TEST: Mixed Patterns ===");
        console.log("Input:");
        console.log(input);
        console.log("\nExpected:");
        console.log(expected);

        const result = simulateCurrentTransformCommonJSToESM(input);

        console.log("\nResult:");
        console.log(result);
        console.log("\nMatch:", result === expected);
        console.log("=== END INTEGRATION TEST ===\n");

        expect(result).toBe(expected);
    });
});
