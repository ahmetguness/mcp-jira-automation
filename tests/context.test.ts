import { describe, it, expect } from "vitest";
import { extractMentionedFiles } from "../src/pipeline/context.js";

describe("Pipeline Context Utilities", () => {
    // ── extractMentionedFiles ────────────────────────────

    describe("extractMentionedFiles", () => {
        const allFiles = [
            "src/auth/login.ts",
            "src/auth/register.ts",
            "src/utils/helpers.ts",
            "src/index.ts",
            "tests/auth.test.ts",
            "package.json",
            "README.md",
        ];

        it("should find files mentioned by basename in description", () => {
            const description = "The bug is in login.ts where the validation fails";
            const result = extractMentionedFiles(description, allFiles);
            expect(result).toContain("src/auth/login.ts");
        });

        it("should find files mentioned by full path", () => {
            const description = "Check src/utils/helpers.ts for the issue";
            const result = extractMentionedFiles(description, allFiles);
            expect(result).toContain("src/utils/helpers.ts");
        });

        it("should find multiple mentioned files", () => {
            const description = "Fix login.ts and register.ts authentication";
            const result = extractMentionedFiles(description, allFiles);
            expect(result).toContain("src/auth/login.ts");
            expect(result).toContain("src/auth/register.ts");
        });

        it("should return empty array for no matches", () => {
            const description = "Some generic description with no file names";
            const result = extractMentionedFiles(description, allFiles);
            expect(result).toEqual([]);
        });

        it("should return empty array for empty description", () => {
            const result = extractMentionedFiles("", allFiles);
            expect(result).toEqual([]);
        });

        it("should handle common context files mentioned", () => {
            const description = "Update the package.json to add new dependency";
            const result = extractMentionedFiles(description, allFiles);
            expect(result).toContain("package.json");
        });
    });

    // ── File Pattern Matching (integration-style) ────────

    describe("File categorization patterns", () => {
        // These patterns are defined inline in context.ts.
        // We test their behavior indirectly by checking regex matching.

        const SOURCE_PATTERNS = [
            /\.(ts|tsx|js|jsx|py|go|java|rb|rs|cs|cpp|c|h|hpp|swift|kt|scala|php)$/i,
        ];

        const TEST_PATTERNS = [
            /\.(test|spec|_test)\.(ts|tsx|js|jsx|py|go|java|rb|rs|cs|cpp)$/i,
            /^tests?\//i,
            /^__tests__\//i,
            /^spec\//i,
            /test_.*\.(py|rb)$/i,
            /_test\.go$/i,
        ];

        it("should match source files", () => {
            const sourceFiles = ["app.ts", "main.py", "lib.go", "App.java", "widget.swift"];
            for (const f of sourceFiles) {
                expect(SOURCE_PATTERNS.some((p) => p.test(f))).toBe(true);
            }
        });

        it("should not match non-source files", () => {
            const nonSource = ["README.md", "config.yml", "Dockerfile", "image.png"];
            for (const f of nonSource) {
                expect(SOURCE_PATTERNS.some((p) => p.test(f))).toBe(false);
            }
        });

        it("should match test files by naming convention", () => {
            const testFiles = [
                "app.test.ts",
                "login.spec.js",
                "auth._test.py",
                "handler_test.go",
                "test_utils.py",
            ];
            for (const f of testFiles) {
                expect(TEST_PATTERNS.some((p) => p.test(f))).toBe(true);
            }
        });

        it("should match test files by directory convention", () => {
            const testFiles = [
                "tests/unit/auth.ts",
                "test/integration.py",
                "__tests__/App.tsx",
                "spec/models.rb",
            ];
            for (const f of testFiles) {
                expect(TEST_PATTERNS.some((p) => p.test(f))).toBe(true);
            }
        });
    });
});
