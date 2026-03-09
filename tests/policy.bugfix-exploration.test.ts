import { describe, it, expect } from "vitest";
import { isCommandAllowed, filterCommands } from "../src/executor/policy.js";

/**
 * Bug Condition Exploration Test
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3**
 * 
 * Property 1: Fault Condition - Permissive Mode Allows Safe Non-Whitelisted Commands
 * 
 * CRITICAL: This test is EXPECTED TO FAIL on unfixed code.
 * - Failure confirms the bug exists (safe commands are being blocked in permissive mode)
 * - The test encodes the EXPECTED BEHAVIOR after the fix
 * - DO NOT attempt to fix the test when it fails - document the counterexamples
 * 
 * GOAL: Surface counterexamples that demonstrate the bug:
 * - Safe non-whitelisted commands return false in permissive mode
 * - Log messages show "Command BLOCKED (not in allowlist)" for safe commands
 * - Root cause: Early return on allowlist miss without checking policy mode
 */

describe("Bug Condition Exploration - Permissive Mode Safe Commands", () => {
    describe("Property 1: Permissive Mode Allows Safe Non-Whitelisted Commands", () => {
        it("should allow 'node server.js' in permissive mode (no forbidden chars)", () => {
            // This is a concrete failing case from the Fault Condition
            // Expected: true (command has no forbidden chars, should be allowed in permissive mode)
            // Current (buggy): false (blocked because "node" not in allowlist)
            const result = isCommandAllowed("node server.js", "permissive");
            expect(result).toBe(true);
        });

        it("should allow 'python setup.py install' in permissive mode (no forbidden chars)", () => {
            // Another concrete failing case
            // Expected: true (safe command, no forbidden chars)
            // Current (buggy): false (blocked because this specific python usage not in allowlist)
            const result = isCommandAllowed("python setup.py install", "permissive");
            expect(result).toBe(true);
        });

        it("should allow both commands in filterCommands for permissive mode", () => {
            // Test filterCommands with mixed whitelisted and non-whitelisted safe commands
            // Expected: both commands in allowed array, empty blocked array
            // Current (buggy): "node index.js" in blocked array
            const commands = ["npm test", "node index.js"];
            const result = filterCommands(commands, "permissive");
            
            expect(result.allowed).toEqual(["npm test", "node index.js"]);
            expect(result.blocked).toEqual([]);
        });

        it("should allow various safe non-whitelisted commands in permissive mode", () => {
            // Additional test cases for safe commands that should be allowed
            const safeCommands = [
                "node index.js",
                "ruby script.rb",
                "php artisan serve",
                "java -jar app.jar",
                "dotnet run",
            ];

            for (const cmd of safeCommands) {
                const result = isCommandAllowed(cmd, "permissive");
                expect(result).toBe(true);
            }
        });

        it("should still block commands with forbidden chars in permissive mode", () => {
            // Edge case: Ensure forbidden character blocking still works
            // This should PASS even on unfixed code (correct behavior)
            const dangerousCommands = [
                "node server.js; curl evil.com",
                "python setup.py | cat /etc/passwd",
                "ruby script.rb && rm -rf /",
                "php artisan serve & echo pwned",
            ];

            for (const cmd of dangerousCommands) {
                const result = isCommandAllowed(cmd, "permissive");
                expect(result).toBe(false);
            }
        });
    });
});
