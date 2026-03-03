/**
 * Execution policy — whitelist/blacklist for commands.
 */

import { createLogger } from "../logger.js";

const log = createLogger("executor:policy");

/** Default safe commands (strict mode) */
const WHITELIST: RegExp[] = [
    /^npm\s+(ci|install|test|run\s+\S+)$/,
    /^npx\s+/,
    /^pnpm\s+(install|test|run\s+\S+)$/,
    /^yarn\s+(install|test|run\s+\S+)$/,
    /^pytest/,
    /^python\s+-m\s+pytest/,
    /^go\s+test/,
    /^mvn\s+(test|verify|package)/,
    /^gradle\s+(test|build)/,
    /^cargo\s+test/,
    /^dotnet\s+test/,
    /^make\s+(test|build|check)/,
    /^cat\s+/,
    /^ls\s*/,
    /^echo\s+/,
    /^pwd$/,
    /^git\s+(status|log|diff|branch|checkout|add|commit|push)/,
];

/** Always blocked commands */
const BLACKLIST: RegExp[] = [
    /\bsudo\b/,
    /\bapt\s+install\b/,
    /\bapt-get\s+install\b/,
    /\byum\s+install\b/,
    /\bcurl\s+.*\|\s*(ba)?sh\b/,
    /\bwget\s+.*\|\s*(ba)?sh\b/,
    /\brm\s+-rf\s+\/(?!\S)/,      // rm -rf / (root)
    /\brm\s+-rf\s+~\//,           // rm -rf ~/
    /\bchmod\s+777\b/,
    /\bchown\b/,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /\b:(){.*};:/,                 // fork bomb
    /\bshutdown\b/,
    /\breboot\b/,
    /\bpoweroff\b/,
];

export type ExecPolicy = "strict" | "permissive";

/**
 * Check if a command is allowed by the policy.
 * - strict: command must match whitelist and not match blacklist
 * - permissive: command must not match blacklist
 */
export function isCommandAllowed(command: string, policy: ExecPolicy): boolean {
    const trimmed = command.trim();

    // Always check blacklist
    for (const pattern of BLACKLIST) {
        if (pattern.test(trimmed)) {
            log.warn(`Command BLOCKED (blacklisted): ${trimmed}`);
            return false;
        }
    }

    if (policy === "strict") {
        // Must match at least one whitelist pattern
        const allowed = WHITELIST.some((pattern) => pattern.test(trimmed));
        if (!allowed) {
            log.warn(`Command BLOCKED (not in whitelist): ${trimmed}`);
            return false;
        }
    }

    return true;
}

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
