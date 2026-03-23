import { describe, it, expect } from "vitest";
import { buildUserPrompt, detectModuleSystem } from "../src/ai/provider.js";
import type { TaskContext } from "../src/types.js";

describe("AI Prompt Module System Integration", () => {
    it("should include ES module instructions for ES module projects", () => {
        const esmContext: TaskContext = {
            issue: {
                key: "TEST-ESM-PROMPT",
                summary: "Test ES module prompt",
                description: "Verify ES module instructions in prompt",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-repo",
            },
            repo: {
                name: "test-esm-repo",
                defaultBranch: "main",
            },
            sourceFiles: [
                {
                    path: "package.json",
                    content: JSON.stringify({ type: "module", name: "test-app" }),
                },
                {
                    path: "src/app.js",
                    content: "import express from 'express';\nexport default express();",
                },
            ],
            testFiles: [],
        };

        const prompt = buildUserPrompt(esmContext);

        // Verify module system is detected
        expect(detectModuleSystem(esmContext)).toBe("esm");

        // Verify prompt includes module system section
        expect(prompt).toContain("## Module System (CRITICAL - READ THIS FIRST)");
        expect(prompt).toContain("module_system: esm");

        // Verify critical ES module instructions are present
        expect(prompt).toContain("This repository uses ES MODULES");
        expect(prompt).toContain("Use `import` statements (NOT `require()`)");
        expect(prompt).toContain("ReferenceError: require is not defined");
    });

    it("should include CommonJS instructions for CommonJS projects", () => {
        const cjsContext: TaskContext = {
            issue: {
                key: "TEST-CJS-PROMPT",
                summary: "Test CommonJS prompt",
                description: "Verify CommonJS instructions in prompt",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-repo",
            },
            repo: {
                name: "test-cjs-repo",
                defaultBranch: "main",
            },
            sourceFiles: [
                {
                    path: "package.json",
                    content: JSON.stringify({ name: "test-app" }),
                },
                {
                    path: "src/app.js",
                    content: "const express = require('express');\nmodule.exports = express();",
                },
            ],
            testFiles: [],
        };

        const prompt = buildUserPrompt(cjsContext);

        // Verify module system is detected
        expect(detectModuleSystem(cjsContext)).toBe("commonjs");

        // Verify prompt includes module system section
        expect(prompt).toContain("## Module System (CRITICAL - READ THIS FIRST)");
        expect(prompt).toContain("module_system: commonjs");

        // Verify CommonJS instructions are present
        expect(prompt).toContain("This repository uses CommonJS");
        expect(prompt).toContain("Use `require()` statements");
        expect(prompt).toContain("Use `module.exports`");
    });

    it("should default to CommonJS when package.json is missing", () => {
        const noPackageContext: TaskContext = {
            issue: {
                key: "TEST-NO-PKG-PROMPT",
                summary: "Test no package.json prompt",
                description: "Verify default to CommonJS",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-repo",
            },
            repo: {
                name: "test-no-pkg-repo",
                defaultBranch: "main",
            },
            sourceFiles: [
                {
                    path: "src/app.js",
                    content: "const express = require('express');\nmodule.exports = express();",
                },
            ],
            testFiles: [],
        };

        const prompt = buildUserPrompt(noPackageContext);

        // Verify module system defaults to commonjs
        expect(detectModuleSystem(noPackageContext)).toBe("commonjs");

        // Verify prompt includes module system section with commonjs default
        expect(prompt).toContain("## Module System (CRITICAL - READ THIS FIRST)");
        expect(prompt).toContain("module_system: commonjs");
    });

    it("should handle monorepo with ES module in subdirectory", () => {
        const monorepoContext: TaskContext = {
            issue: {
                key: "TEST-MONOREPO-PROMPT",
                summary: "Test monorepo ES module prompt",
                description: "Verify ES module detection in monorepo",
                status: "In Progress",
                issueType: "Task",
                assignee: "test-user",
                repository: "test-repo",
            },
            repo: {
                name: "test-monorepo",
                defaultBranch: "main",
            },
            workdirRelative: "backend",
            sourceFiles: [
                {
                    path: "package.json",
                    content: JSON.stringify({ name: "root" }),
                },
                {
                    path: "backend/package.json",
                    content: JSON.stringify({ type: "module", name: "backend" }),
                },
                {
                    path: "backend/src/app.js",
                    content: "import express from 'express';\nexport default express();",
                },
            ],
            testFiles: [],
        };

        const prompt = buildUserPrompt(monorepoContext);

        // Verify module system is detected from workdir package.json
        expect(detectModuleSystem(monorepoContext)).toBe("esm");

        // Verify prompt includes ES module instructions
        expect(prompt).toContain("module_system: esm");
        expect(prompt).toContain("This repository uses ES MODULES");
    });
});
