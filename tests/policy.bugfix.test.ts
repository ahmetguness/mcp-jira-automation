import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isCommandAllowed, type ExecPolicy } from "../src/executor/policy.js";

/**
 * Bug Condition Exploration Tests for node-command-strict-mode-blocking-fix
 * 
 * CRITICAL: These tests are EXPECTED TO FAIL on unfixed code.
 * Failure confirms the bug exists.
 * 
 * These tests encode the EXPECTED behavior - they will validate the fix
 * when they pass after implementation.
 */

describe("Bug Condition Exploration - Standalone Commands in Strict Mode", () => {
    /**
     * Property 1: Bug Condition - Standalone Commands Respect Strict Mode
     * 
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     * 
     * For any command where the binary is marked with `standalone: true` 
     * and the command has arguments (tokens.length > 1) and the policy is "strict",
     * the isCommandAllowed function SHALL return false unless the command is
     * a utility command (cat, ls, pwd, echo, pytest).
     * 
     * EXPECTED OUTCOME ON UNFIXED CODE: This test will FAIL because the current
     * implementation returns true for "node server.js" in strict mode.
     */
    it("Property 1: Commands with standalone binaries should be blocked in strict mode (except utilities)", () => {
        // Test concrete failing cases from requirements
        
        // Requirement 2.1: node server.js should be blocked
        expect(isCommandAllowed("node server.js", "strict")).toBe(false);
        
        // Additional node command variations
        expect(isCommandAllowed("node index.js", "strict")).toBe(false);
        expect(isCommandAllowed("node app.js", "strict")).toBe(false);
        expect(isCommandAllowed("node test.js", "strict")).toBe(false);
        
        // Utility commands should still be allowed (preservation)
        expect(isCommandAllowed("cat package.json", "strict")).toBe(true);
        expect(isCommandAllowed("ls -la", "strict")).toBe(true);
        expect(isCommandAllowed("pwd", "strict")).toBe(true);
        expect(isCommandAllowed("echo hello", "strict")).toBe(true);
        expect(isCommandAllowed("pytest test.py", "strict")).toBe(true);
    });

    /**
     * Property-Based Test: Standalone binaries with arguments in strict mode
     * 
     * This property test generates various commands with the "node" binary
     * (which has standalone: true) and verifies they are blocked in strict mode.
     */
    it("Property 1 (PBT): Node commands with arguments should be blocked in strict mode", () => {
        fc.assert(
            fc.property(
                // Generate various JavaScript file names
                fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]*\.js$/),
                (filename) => {
                    const command = `node ${filename}`;
                    const result = isCommandAllowed(command, "strict");
                    
                    // In strict mode, node commands with arguments should be blocked
                    expect(result).toBe(false);
                }
            ),
            { numRuns: 50 }
        );
    });

    /**
     * Additional test cases from requirements 2.2, 2.3, 2.4
     * 
     * These test other commands that should be blocked in strict mode.
     * Note: wget and ruby are not currently in the ALLOWLIST, so they
     * are already correctly blocked. These tests serve as regression prevention.
     */
    it("should block other non-whitelisted commands in strict mode (regression prevention)", () => {
        // Requirement 2.2: wget should be blocked
        expect(isCommandAllowed("wget file", "strict")).toBe(false);
        
        // Requirement 2.3: python setup.py should be blocked
        expect(isCommandAllowed("python setup.py install", "strict")).toBe(false);
        
        // Requirement 2.4: ruby script should be blocked
        expect(isCommandAllowed("ruby script.rb", "strict")).toBe(false);
    });
});

/**
 * Preservation Property Tests for node-command-strict-mode-blocking-fix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3**
 * 
 * IMPORTANT: These tests follow observation-first methodology.
 * They capture the CURRENT behavior on UNFIXED code for non-buggy inputs.
 * 
 * EXPECTED OUTCOME ON UNFIXED CODE: These tests should PASS.
 * This confirms the baseline behavior that must be preserved after the fix.
 * 
 * After implementing the fix, these tests should STILL PASS, ensuring no regressions.
 */
describe("Preservation Property Tests - Permissive Mode and Whitelisted Commands", () => {
    /**
     * Property 2: Preservation - Permissive Mode
     * 
     * **Validates: Requirement 3.2**
     * 
     * In permissive mode, commands without forbidden characters should be allowed,
     * regardless of whether they're in the allowlist. This includes commands that
     * would be blocked in strict mode (like "node server.js").
     */
    describe("Permissive Mode Preservation", () => {
        it("should allow node commands in permissive mode", () => {
            // These commands are blocked in strict mode but allowed in permissive mode
            expect(isCommandAllowed("node server.js", "permissive")).toBe(true);
            expect(isCommandAllowed("node index.js", "permissive")).toBe(true);
            expect(isCommandAllowed("node app.js", "permissive")).toBe(true);
        });

        it("should allow non-allowlisted safe commands in permissive mode", () => {
            // Commands not in allowlist but safe (no forbidden chars)
            expect(isCommandAllowed("wget file", "permissive")).toBe(true);
            expect(isCommandAllowed("curl https://example.com", "permissive")).toBe(true);
            expect(isCommandAllowed("ruby script.rb", "permissive")).toBe(true);
        });

        it("Property 2 (PBT): Permissive mode allows commands without forbidden characters", () => {
            fc.assert(
                fc.property(
                    // Generate safe command strings (alphanumeric, spaces, dots, hyphens, slashes)
                    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ./_-]{1,50}$/),
                    (command) => {
                        // Skip empty or whitespace-only commands
                        if (!command.trim()) return;
                        
                        const result = isCommandAllowed(command, "permissive");
                        
                        // In permissive mode, commands without forbidden chars should be allowed
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("should still block commands with forbidden characters in permissive mode", () => {
            // Forbidden characters should be blocked in both modes
            expect(isCommandAllowed("node server.js; rm -rf /", "permissive")).toBe(false);
            expect(isCommandAllowed("node server.js | grep test", "permissive")).toBe(false);
            expect(isCommandAllowed("node server.js && echo done", "permissive")).toBe(false);
            expect(isCommandAllowed("node $(whoami)", "permissive")).toBe(false);
        });
    });

    /**
     * Property 2: Preservation - Whitelisted Commands in Strict Mode
     * 
     * **Validates: Requirement 3.1**
     * 
     * Whitelisted commands with proper validation should continue to work
     * in strict mode after the fix is implemented.
     */
    describe("Whitelisted Commands Preservation", () => {
        it("should allow npm commands in strict mode", () => {
            expect(isCommandAllowed("npm ci", "strict")).toBe(true);
            expect(isCommandAllowed("npm test", "strict")).toBe(true);
            expect(isCommandAllowed("npm run build", "strict")).toBe(true);
            expect(isCommandAllowed("npm install", "strict")).toBe(true);
        });

        it("should allow yarn/pnpm/bun commands in strict mode", () => {
            expect(isCommandAllowed("yarn install", "strict")).toBe(true);
            expect(isCommandAllowed("yarn test", "strict")).toBe(true);
            expect(isCommandAllowed("pnpm install", "strict")).toBe(true);
            expect(isCommandAllowed("bun test", "strict")).toBe(true);
        });

        it("should allow python test commands in strict mode", () => {
            expect(isCommandAllowed("python -m pytest", "strict")).toBe(true);
            expect(isCommandAllowed("python3 -m pytest", "strict")).toBe(true);
            expect(isCommandAllowed("python -m pip install .", "strict")).toBe(true);
        });

        it("should allow other language test commands in strict mode", () => {
            expect(isCommandAllowed("go test", "strict")).toBe(true);
            expect(isCommandAllowed("cargo test", "strict")).toBe(true);
            expect(isCommandAllowed("mvn test", "strict")).toBe(true);
            expect(isCommandAllowed("gradle test", "strict")).toBe(true);
            expect(isCommandAllowed("dotnet test", "strict")).toBe(true);
        });

        it("Property 2 (PBT): Whitelisted npm scripts should work in strict mode", () => {
            fc.assert(
                fc.property(
                    // Generate safe script names (alphanumeric, colons, underscores, hyphens)
                    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9:_-]{1,30}$/),
                    (scriptName) => {
                        const command = `npm run ${scriptName}`;
                        const result = isCommandAllowed(command, "strict");
                        
                        // npm run with safe script names should be allowed in strict mode
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 2: Preservation - Utility Commands in Strict Mode
     * 
     * **Validates: Requirement 3.1**
     * 
     * Simple utility commands (cat, ls, pwd, echo, pytest) should continue
     * to work in strict mode with the standalone flag.
     */
    describe("Utility Commands Preservation", () => {
        it("should allow utility commands in strict mode", () => {
            expect(isCommandAllowed("cat package.json", "strict")).toBe(true);
            expect(isCommandAllowed("cat README.md", "strict")).toBe(true);
            expect(isCommandAllowed("ls", "strict")).toBe(true);
            expect(isCommandAllowed("ls -la", "strict")).toBe(true);
            expect(isCommandAllowed("pwd", "strict")).toBe(true);
            expect(isCommandAllowed("echo hello", "strict")).toBe(true);
            expect(isCommandAllowed("echo test message", "strict")).toBe(true);
        });

        it("should allow pytest standalone in strict mode", () => {
            expect(isCommandAllowed("pytest", "strict")).toBe(true);
            expect(isCommandAllowed("pytest test.py", "strict")).toBe(true);
            expect(isCommandAllowed("pytest tests/", "strict")).toBe(true);
        });

        it("Property 2 (PBT): cat with various file paths should work in strict mode", () => {
            fc.assert(
                fc.property(
                    // Generate safe file paths
                    fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{1,50}$/),
                    (filepath) => {
                        const command = `cat ${filepath}`;
                        const result = isCommandAllowed(command, "strict");
                        
                        // cat with safe file paths should be allowed in strict mode
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it("Property 2 (PBT): ls with various flags should work in strict mode", () => {
            fc.assert(
                fc.property(
                    // Generate common ls flags
                    fc.constantFrom("", "-l", "-a", "-la", "-lh", "-R", "-t"),
                    (flags) => {
                        const command = flags ? `ls ${flags}` : "ls";
                        const result = isCommandAllowed(command, "strict");
                        
                        // ls with common flags should be allowed in strict mode
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 2: Preservation - Forbidden Character Blocking
     * 
     * **Validates: Requirement 3.3**
     * 
     * Commands with shell metacharacters should be blocked in both modes.
     * This security policy must remain unchanged.
     */
    describe("Forbidden Character Blocking Preservation", () => {
        it("should block commands with shell metacharacters in strict mode", () => {
            expect(isCommandAllowed("npm test; rm -rf /", "strict")).toBe(false);
            expect(isCommandAllowed("npm test && echo done", "strict")).toBe(false);
            expect(isCommandAllowed("npm test | grep error", "strict")).toBe(false);
            expect(isCommandAllowed("npm test > output.txt", "strict")).toBe(false);
            expect(isCommandAllowed("npm test < input.txt", "strict")).toBe(false);
            expect(isCommandAllowed("npm $(whoami)", "strict")).toBe(false);
            expect(isCommandAllowed("npm `whoami`", "strict")).toBe(false);
        });

        it("should block commands with shell metacharacters in permissive mode", () => {
            expect(isCommandAllowed("node server.js; rm -rf /", "permissive")).toBe(false);
            expect(isCommandAllowed("node server.js && echo done", "permissive")).toBe(false);
            expect(isCommandAllowed("node server.js | grep test", "permissive")).toBe(false);
            expect(isCommandAllowed("wget file > output", "permissive")).toBe(false);
        });

        it("Property 2 (PBT): Commands with forbidden characters should be blocked in both modes", () => {
            const forbiddenChars = [";", "&", "|", "`", "$", "<", ">", "(", ")", "[", "]", "{", "}", "!"];
            
            fc.assert(
                fc.property(
                    fc.constantFrom(...forbiddenChars),
                    fc.constantFrom("strict", "permissive"),
                    (forbiddenChar, policy) => {
                        const command = `npm test ${forbiddenChar} echo done`;
                        const result = isCommandAllowed(command, policy as ExecPolicy);
                        
                        // Commands with forbidden characters should always be blocked
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
