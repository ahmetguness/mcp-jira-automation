import { describe, it, expect } from "vitest";
import {
    buildSystemPrompt,
    buildUserPrompt,
    parseAiResponse,
    detectModuleSystem,
} from "../src/ai/provider.js";
import type { TaskContext } from "../src/types.js";

describe("AI Provider Utilities", () => {
    // ── buildSystemPrompt ────────────────────────────────

    describe("buildSystemPrompt", () => {
        it("should return a non-empty system prompt", () => {
            const prompt = buildSystemPrompt();
            expect(prompt.length).toBeGreaterThan(100);
        });

        it("should include JSON structure instructions", () => {
            const prompt = buildSystemPrompt();
            expect(prompt).toContain("summary");
            expect(prompt).toContain("patches");
            expect(prompt).toContain("commands");
        });

        it("should mention safety rules", () => {
            const prompt = buildSystemPrompt();
            expect(prompt).toContain("SAFE commands only");
        });

        it("should always mandate Node.js for tests", () => {
            const prompt = buildSystemPrompt();
            expect(prompt).toContain("ALL TESTS IN NODE.JS");
        });

        it("should include source code context for specified language", () => {
            const prompt = buildSystemPrompt({ primaryLanguage: "python" });
            expect(prompt).toContain("SOURCE CODE CONTEXT: Python");
        });

        it("should include unknown context by default", () => {
            const prompt = buildSystemPrompt();
            expect(prompt).toContain("SOURCE CODE CONTEXT: Unknown");
        });
    });

    // ── buildUserPrompt ──────────────────────────────────

    describe("detectModuleSystem", () => {
        const baseContext: TaskContext = {
            issue: {
                key: "TEST-1",
                summary: "Test",
                description: "",
                status: "Open",
                issueType: "Task",
                assignee: "test",
                repository: "test/repo",
            },
            repo: {
                name: "test/repo",
                defaultBranch: "main",
            },
            sourceFiles: [],
            testFiles: [],
        };

        it("should return 'esm' when package.json has type: module", () => {
            const context: TaskContext = {
                ...baseContext,
                sourceFiles: [
                    { path: "package.json", content: '{"type": "module"}' },
                ],
            };
            expect(detectModuleSystem(context)).toBe("esm");
        });

        it("should return 'commonjs' when package.json has type: commonjs", () => {
            const context: TaskContext = {
                ...baseContext,
                sourceFiles: [
                    { path: "package.json", content: '{"type": "commonjs"}' },
                ],
            };
            expect(detectModuleSystem(context)).toBe("commonjs");
        });

        it("should return 'commonjs' when package.json has no type field", () => {
            const context: TaskContext = {
                ...baseContext,
                sourceFiles: [
                    { path: "package.json", content: '{"name": "test"}' },
                ],
            };
            expect(detectModuleSystem(context)).toBe("commonjs");
        });

        it("should return 'commonjs' when no package.json exists", () => {
            const context: TaskContext = {
                ...baseContext,
                sourceFiles: [],
            };
            expect(detectModuleSystem(context)).toBe("commonjs");
        });

        it("should return 'commonjs' when package.json is malformed", () => {
            const context: TaskContext = {
                ...baseContext,
                sourceFiles: [
                    { path: "package.json", content: 'invalid json {' },
                ],
            };
            expect(detectModuleSystem(context)).toBe("commonjs");
        });

        it("should handle monorepo with workdirRelative", () => {
            const context: TaskContext = {
                ...baseContext,
                workdirRelative: "backend",
                sourceFiles: [
                    { path: "backend/package.json", content: '{"type": "module"}' },
                    { path: "package.json", content: '{"type": "commonjs"}' },
                ],
            };
            expect(detectModuleSystem(context)).toBe("esm");
        });

        it("should fallback to root package.json if workdir package.json not found", () => {
            const context: TaskContext = {
                ...baseContext,
                workdirRelative: "backend",
                sourceFiles: [
                    { path: "package.json", content: '{"type": "module"}' },
                ],
            };
            expect(detectModuleSystem(context)).toBe("esm");
        });
    });

    describe("buildUserPrompt", () => {
        const baseContext: TaskContext = {
            issue: {
                key: "CYBER-10",
                summary: "Fix login bug",
                description: "Users cannot login with special characters",
                status: "In Progress",
                issueType: "Bug",
                assignee: "AI Cyber Bot",
                repository: "org/repo",
            },
            repo: {
                name: "org/repo",
                defaultBranch: "main",
            },
            sourceFiles: [],
            testFiles: [],
        };

        it("should include issue key and summary", () => {
            const prompt = buildUserPrompt(baseContext);
            expect(prompt).toContain("CYBER-10");
            expect(prompt).toContain("Fix login bug");
        });

        it("should include issue description", () => {
            const prompt = buildUserPrompt(baseContext);
            expect(prompt).toContain("Users cannot login with special characters");
        });

        it("should include repository info", () => {
            const prompt = buildUserPrompt(baseContext);
            expect(prompt).toContain("org/repo");
            expect(prompt).toContain("main");
        });

        it("should include source files when present", () => {
            const context: TaskContext = {
                ...baseContext,
                sourceFiles: [
                    { path: "src/auth.ts", content: "export function login() {}" },
                ],
            };
            const prompt = buildUserPrompt(context);
            expect(prompt).toContain("src/auth.ts");
            expect(prompt).toContain("export function login()");
        });

        it("should include test files when present", () => {
            const context: TaskContext = {
                ...baseContext,
                testFiles: [
                    { path: "tests/auth.test.ts", content: "test('login', () => {})" },
                ],
            };
            const prompt = buildUserPrompt(context);
            expect(prompt).toContain("tests/auth.test.ts");
            expect(prompt).toContain("test('login'");
        });

        it("should handle empty description", () => {
            const context: TaskContext = {
                ...baseContext,
                issue: { ...baseContext.issue, description: "" },
            };
            const prompt = buildUserPrompt(context);
            expect(prompt).not.toContain("Description:");
        });

        it("should include Runtime Detection metadata when present", () => {
            const context: TaskContext = {
                ...baseContext,
                runtimeSelection: {
                    primary: "node",
                    isMulti: true,
                    markers: ["package.json", "requirements.txt"],
                    detected: [
                        { lang: "node", reason: "test", confidence: 0.8 },
                        { lang: "python", reason: "test", confidence: 0.5 }
                    ]
                }
            };
            const prompt = buildUserPrompt(context);
            expect(prompt).toContain("## Runtime Detection");
            expect(prompt).toContain("primary_language: node");
            expect(prompt).toContain("detected_languages: node(0.80), python(0.50)");
            expect(prompt).toContain("marker_files: package.json, requirements.txt");
            expect(prompt).toContain("multi_language_repo: true");
        });
    });

    // ── parseAiResponse ──────────────────────────────────

    describe("parseAiResponse", () => {
        it("should parse valid JSON response", () => {
            const json = JSON.stringify({
                summary: "Fixed the bug",
                plan: "Updated validation logic",
                patches: [
                    { path: "src/auth.ts", content: "new code", action: "modify" },
                ],
                commands: ["npm test"],
            });

            const result = parseAiResponse(json);
            expect(result.summary).toBe("Fixed the bug");
            expect(result.plan).toBe("Updated validation logic");
            expect(result.patches).toHaveLength(1);
            expect(result.patches[0]?.path).toBe("src/auth.ts");
            expect(result.commands).toEqual(["npm test"]);
        });

        it("should parse JSON wrapped in markdown code block", () => {
            const text = '```json\n{"summary":"test","plan":"plan","patches":[],"commands":["npm test"]}\n```';
            const result = parseAiResponse(text);
            expect(result.summary).toBe("test");
            expect(result.commands).toEqual(["npm test"]);
        });

        it("should parse JSON in code block without language specifier", () => {
            const text = '```\n{"summary":"x","plan":"y","patches":[],"commands":[]}\n```';
            const result = parseAiResponse(text);
            expect(result.summary).toBe("x");
        });

        it("should fallback gracefully on invalid JSON", () => {
            const text = "I couldn't complete the analysis because...";
            const result = parseAiResponse(text);
            expect(result.summary).toBe(text);
            expect(result.patches).toEqual([]);
            expect(result.commands).toEqual([]);
        });

        it("should handle missing fields in JSON", () => {
            const json = JSON.stringify({ summary: "only summary" });
            const result = parseAiResponse(json);
            expect(result.summary).toBe("only summary");
            expect(result.plan).toBe("");
            expect(result.patches).toEqual([]);
            expect(result.commands).toEqual([]);
        });
    });
});
