import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildUserPrompt } from "../src/ai/provider.js";
import type { TaskContext } from "../src/types.js";

/**
 * Preservation Property Tests for ES Module Test Generation Fix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3**
 * 
 * Property 2: Preservation - CommonJS Repository Behavior Unchanged
 * 
 * These tests verify that the fix does NOT break existing CommonJS test generation.
 * They observe behavior on UNFIXED code for non-buggy inputs (repositories without
 * "type": "module") and capture that baseline behavior.
 * 
 * EXPECTED OUTCOME: Tests PASS on unfixed code (confirms baseline to preserve)
 * 
 * GOAL: Ensure that after the fix is implemented:
 * - CommonJS repos continue to generate prompts with require() patterns
 * - Missing package.json continues to default to CommonJS
 * - Non-Node.js repos continue to get Node.js test files
 * - Test template structure remains unchanged
 */
describe("ES Module Test Generation Preservation Tests", () => {
    /**
     * Test 1: CommonJS Repository Behavior Unchanged
     * 
     * For any TaskContext where package.json does NOT contain "type": "module",
     * verify buildUserPrompt generates prompt that will produce CommonJS patterns.
     * 
     * This test should PASS on unfixed code, establishing the baseline behavior
     * that must be preserved after the fix.
     */
    it("should preserve CommonJS syntax for repositories without type: module", () => {
        // Create a TaskContext with package.json WITHOUT "type": "module"
        const commonjsContext: TaskContext = {
            issue: {
                key: "TEST-PRESERVE-1",
                summary: "Test CommonJS preservation",
                description: "Verify CommonJS repos continue to work",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-repo",
            },
            repo: {
                name: "test-commonjs-repo",
                defaultBranch: "main",
                description: "CommonJS repository",
            },
            sourceFiles: [
                {
                    path: "package.json",
                    content: JSON.stringify({
                        name: "test-commonjs-repo",
                        version: "1.0.0",
                        // No "type" field - defaults to CommonJS
                        dependencies: {
                            express: "^4.18.0",
                        },
                    }, null, 2),
                },
                {
                    path: "src/app.js",
                    content: `const express = require('express');
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));
module.exports = app;`,
                },
            ],
            testFiles: [],
        };

        const prompt = buildUserPrompt(commonjsContext);

        // On unfixed code, the prompt should NOT contain "module_system: esm"
        // because the system doesn't detect module systems yet
        const hasEsmIndicator = prompt.includes("module_system: esm");
        
        // The prompt should not force ES module syntax for CommonJS repos
        expect(hasEsmIndicator).toBe(false);
        
        // Verify the prompt contains the package.json (baseline behavior)
        expect(prompt).toContain("package.json");
        expect(prompt).toContain("test-commonjs-repo");
    });

    /**
     * Test 2: No Package.json Defaults to CommonJS
     * 
     * For any TaskContext with no package.json, verify buildUserPrompt
     * defaults to CommonJS syntax (backward compatibility).
     */
    it("should default to CommonJS when package.json is missing", () => {
        const noPackageJsonContext: TaskContext = {
            issue: {
                key: "TEST-PRESERVE-2",
                summary: "Test no package.json",
                description: "Verify default behavior without package.json",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-repo",
            },
            repo: {
                name: "test-no-package-repo",
                defaultBranch: "main",
            },
            sourceFiles: [
                {
                    path: "src/server.js",
                    content: `const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Hello World');
});
module.exports = server;`,
                },
            ],
            testFiles: [],
        };

        const prompt = buildUserPrompt(noPackageJsonContext);

        // On unfixed code, there should be no module system indicator
        const hasModuleSystemField = prompt.includes("module_system:");
        
        // Without package.json, the system should not add module system info
        expect(hasModuleSystemField).toBe(false);
        
        // Verify the prompt contains the source file
        expect(prompt).toContain("src/server.js");
    });

    /**
     * Test 3: Non-Node.js Repositories Get Node.js Test Files
     * 
     * For TaskContext with non-Node.js repositories (Python, Go, Java),
     * verify generated tests are Node.js HTTP client tests with CommonJS syntax.
     */
    it("should generate Node.js tests for Python repositories", () => {
        const pythonContext: TaskContext = {
            issue: {
                key: "TEST-PRESERVE-3",
                summary: "Test Python repository",
                description: "Verify Python repos get Node.js tests",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-python-repo",
            },
            repo: {
                name: "test-python-repo",
                defaultBranch: "main",
            },
            sourceFiles: [
                {
                    path: "app.py",
                    content: `from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}`,
                },
                {
                    path: "requirements.txt",
                    content: "fastapi==0.104.1\nuvicorn==0.24.0",
                },
            ],
            testFiles: [],
            runtimeSelection: {
                primary: "python",
                detected: [{ lang: "python", confidence: 1.0, reason: "Marker file: requirements.txt" }],
                markers: ["requirements.txt"],
                isMulti: false,
            },
        };

        const prompt = buildUserPrompt(pythonContext);

        // Verify runtime detection is included
        expect(prompt).toContain("primary_language: python");
        
        // On unfixed code, there should be no ES module indicator
        const hasEsmIndicator = prompt.includes("module_system: esm");
        expect(hasEsmIndicator).toBe(false);
        
        // Verify the prompt contains Python source files
        expect(prompt).toContain("app.py");
    });

    /**
     * Test 4: Monorepo CommonJS Preservation
     * 
     * For monorepo TaskContext with CommonJS backend, verify correct
     * CommonJS test generation with proper path handling.
     */
    it("should preserve CommonJS behavior in monorepo structure", () => {
        const monorepoCommonJSContext: TaskContext = {
            issue: {
                key: "TEST-PRESERVE-4",
                summary: "Test monorepo CommonJS",
                description: "Verify monorepo CommonJS detection",
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
                        // No "type" field - CommonJS
                        dependencies: {
                            express: "^4.18.0",
                        },
                    }, null, 2),
                },
                {
                    path: "backend/src/app.js",
                    content: `const express = require('express');
const app = express();
module.exports = app;`,
                },
            ],
            testFiles: [],
            workdir: "/workspace/backend",
            workdirRelative: "backend",
        };

        const prompt = buildUserPrompt(monorepoCommonJSContext);

        // Verify monorepo structure is documented
        expect(prompt).toContain("**Working Directory:** backend");
        expect(prompt).toContain("monorepo");
        
        // On unfixed code, there should be no ES module indicator
        const hasEsmIndicator = prompt.includes("module_system: esm");
        expect(hasEsmIndicator).toBe(false);
        
        // Verify package.json is included
        expect(prompt).toContain("backend/package.json");
    });

    /**
     * Property-Based Test: CommonJS Preservation Across Various Configurations
     * 
     * Generate random package.json configurations WITHOUT "type": "module"
     * and verify they all produce prompts without ES module indicators.
     */
    it("should preserve CommonJS behavior across various package.json configurations", () => {
        // Arbitrary generator for package.json WITHOUT "type": "module"
        const commonjsPackageJsonArb = fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }),
            version: fc.string({ minLength: 1, maxLength: 20 }),
            // Explicitly set type to "commonjs" or omit it
            type: fc.option(fc.constant("commonjs" as const), { nil: undefined }),
            dependencies: fc.option(fc.dictionary(
                fc.string({ minLength: 1, maxLength: 30 }),
                fc.string({ minLength: 1, maxLength: 20 })
            ), { nil: undefined }),
            scripts: fc.option(fc.dictionary(
                fc.string({ minLength: 1, maxLength: 30 }),
                fc.string({ minLength: 1, maxLength: 100 })
            ), { nil: undefined }),
        });

        // Property: For all CommonJS package.json configurations,
        // the prompt should NOT contain "module_system: esm"
        fc.assert(
            fc.property(commonjsPackageJsonArb, (packageJson) => {
                const context: TaskContext = {
                    issue: {
                        key: "TEST-PBT-PRESERVE",
                        summary: "Property-based preservation test",
                        description: "Testing CommonJS preservation",
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
                
                // On unfixed code, the prompt should NOT contain "module_system: esm"
                // because these are CommonJS repositories
                const hasEsmIndicator = prompt.includes("module_system: esm");
                
                // This should be false for all CommonJS configurations
                return !hasEsmIndicator;
            }),
            {
                numRuns: 50, // Run 50 test cases
            }
        );
    });

    /**
     * Property-Based Test: Repository Structures Without Package.json
     * 
     * Generate random repository structures without package.json
     * and verify they don't get ES module indicators.
     */
    it("should handle repositories without package.json consistently", () => {
        // Arbitrary generator for source files without package.json
        const sourceFileArb = fc.record({
            path: fc.constantFrom(
                "src/app.js",
                "src/server.js",
                "index.js",
                "lib/utils.js",
                "routes/api.js"
            ),
            content: fc.constant(`const express = require('express');
module.exports = express();`),
        });

        const repoWithoutPackageJsonArb = fc.array(sourceFileArb, { minLength: 1, maxLength: 5 });

        fc.assert(
            fc.property(repoWithoutPackageJsonArb, (sourceFiles) => {
                const context: TaskContext = {
                    issue: {
                        key: "TEST-PBT-NO-PKG",
                        summary: "Test without package.json",
                        description: "Testing default behavior",
                        status: "In Progress",
                        issueType: "Task",
                        assignee: "test-user",
                        repository: "test-repo",
                    },
                    repo: {
                        name: "test-repo",
                        defaultBranch: "main",
                    },
                    sourceFiles,
                    testFiles: [],
                };

                const prompt = buildUserPrompt(context);
                
                // Without package.json, there should be no module system field
                const hasModuleSystemField = prompt.includes("module_system:");
                
                // This should be false for all repos without package.json
                return !hasModuleSystemField;
            }),
            {
                numRuns: 30,
            }
        );
    });

    /**
     * Property-Based Test: Monorepo Structures with CommonJS
     * 
     * Generate random monorepo structures with CommonJS backend
     * and verify correct behavior preservation.
     */
    it("should preserve CommonJS behavior in various monorepo structures", () => {
        const monorepoArb = fc.record({
            workdirRelative: fc.constantFrom("backend", "api", "server", "packages/api"),
            packageName: fc.stringMatching(/^[a-z][a-z0-9-]{0,29}$/),
            hasTypeField: fc.boolean(),
        });

        fc.assert(
            fc.property(monorepoArb, ({ workdirRelative, packageName, hasTypeField }) => {
                const packageJsonContent = hasTypeField
                    ? { name: packageName, version: "1.0.0", type: "commonjs" }
                    : { name: packageName, version: "1.0.0" };

                const context: TaskContext = {
                    issue: {
                        key: "TEST-PBT-MONOREPO",
                        summary: "Test monorepo",
                        description: "Testing monorepo CommonJS",
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
                            path: `${workdirRelative}/package.json`,
                            content: JSON.stringify(packageJsonContent, null, 2),
                        },
                    ],
                    testFiles: [],
                    workdir: `/workspace/${workdirRelative}`,
                    workdirRelative,
                };

                const prompt = buildUserPrompt(context);
                
                // Verify monorepo structure is documented
                const hasWorkdirInfo = prompt.includes(`**Working Directory:** ${workdirRelative}`);
                
                // Should NOT have ES module indicator for CommonJS
                const hasEsmIndicator = prompt.includes("module_system: esm");
                
                return hasWorkdirInfo && !hasEsmIndicator;
            }),
            {
                numRuns: 40,
            }
        );
    });
});
