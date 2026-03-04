/**
 * Execution policy — allowlist + argument schema for command validation.
 *
 * Security model:
 * 1. Reject any command containing forbidden shell metacharacters
 * 2. Tokenize command into [bin, ...args]
 * 3. Match bin against allowlist
 * 4. Validate subcommand / arg pattern if defined
 * 5. Only pass if all checks pass
 */

import { createLogger } from "../logger.js";

const log = createLogger("executor:policy");

// ─── Allowlist Schema ────────────────────────────────────────

interface AllowedCommand {
    /** The executable name (first token) */
    bin: string;
    /** Allowed subcommands (second token must match one of these) */
    subcommands?: string[];
    /** If specified, second token must also match this pattern */
    argPattern?: RegExp;
    /** If true, bin alone is valid (no subcommand required) */
    standalone?: boolean;
}

const ALLOWLIST: AllowedCommand[] = [
    // Package managers
    { bin: "npm", subcommands: ["ci", "install", "test", "run"] },
    { bin: "pnpm", subcommands: ["install", "test", "run"] },
    { bin: "yarn", subcommands: ["install", "test", "run"] },
    { bin: "npx", argPattern: /^[\w@/.-]+$/ },

    // Test frameworks
    { bin: "pytest", standalone: true },
    { bin: "python", subcommands: ["-m"], argPattern: /^pytest/ },
    { bin: "go", subcommands: ["test"] },
    { bin: "mvn", subcommands: ["test", "verify", "package"] },
    { bin: "gradle", subcommands: ["test", "build"] },
    { bin: "cargo", subcommands: ["test"] },
    { bin: "dotnet", subcommands: ["test"] },
    { bin: "make", subcommands: ["test", "build", "check"] },

    // Safe read-only utilities
    { bin: "cat", standalone: true },
    { bin: "ls", standalone: true },
    { bin: "echo", standalone: true },
    { bin: "pwd", standalone: true },

    // Git (read-only only — no push/commit)
    { bin: "git", subcommands: ["status", "log", "diff", "branch"] },
];

/** Characters that MUST NEVER appear in any command — prevents shell injection */
const FORBIDDEN_CHARS = /[;&|`$(){}!><\n\r\\]/;

export type ExecPolicy = "strict" | "permissive";

// ─── Core Validation ─────────────────────────────────────────

/**
 * Check if a command is allowed by the policy.
 *
 * Both strict and permissive modes now use the same allowlist.
 * The difference: permissive mode logs warnings instead of blocking
 * for commands that don't match the allowlist (but still rejects
 * forbidden characters).
 */
export function isCommandAllowed(command: string, policy: ExecPolicy): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;

    // Step 1: Reject forbidden shell metacharacters (both modes)
    if (FORBIDDEN_CHARS.test(trimmed)) {
        log.warn(`Command BLOCKED (forbidden characters): ${trimmed}`);
        return false;
    }

    // Step 2: Tokenize
    const tokens = trimmed.split(/\s+/);
    const bin = tokens[0]!;
    const sub = tokens[1];

    // Step 3: Match against allowlist
    const match = ALLOWLIST.find((a) => a.bin === bin);

    if (!match) {
        if (policy === "permissive") {
            log.warn(`Command ALLOWED (permissive, not in allowlist): ${trimmed}`);
            return true;
        }
        log.warn(`Command BLOCKED (not in allowlist): ${trimmed}`);
        return false;
    }

    // Step 4: Standalone check
    if (match.standalone && tokens.length <= 1) return true;
    if (match.standalone && !match.subcommands) return true; // standalone with args OK

    // Step 5: Subcommand check
    if (match.subcommands) {
        if (!sub || !match.subcommands.includes(sub)) {
            if (policy === "permissive") {
                log.warn(`Command ALLOWED (permissive, invalid subcommand '${sub ?? ""}'): ${trimmed}`);
                return true;
            }
            log.warn(`Command BLOCKED (invalid subcommand '${sub ?? ""}' for ${bin}): ${trimmed}`);
            return false;
        }
    }

    // Step 6: Argument pattern check
    if (match.argPattern) {
        const argToCheck = match.subcommands ? tokens[2] : sub;
        if (argToCheck && !match.argPattern.test(argToCheck)) {
            if (policy === "permissive") {
                log.warn(`Command ALLOWED (permissive, arg pattern mismatch for ${bin}): ${trimmed}`);
                return true;
            }
            log.warn(`Command BLOCKED (argument pattern mismatch for ${bin}): ${trimmed}`);
            return false;
        }
    }

    return true;
}

// ─── Filter ──────────────────────────────────────────────────

/** Filter and partition commands into allowed and blocked */
export function filterCommands(
    commands: string[],
    policy: ExecPolicy,
): { allowed: string[]; blocked: string[] } {
    const allowed: string[] = [];
    const blocked: string[] = [];

    for (const cmd of commands) {
        if (isCommandAllowed(cmd, policy)) {
            allowed.push(cmd);
        } else {
            blocked.push(cmd);
        }
    }

    return { allowed, blocked };
}
