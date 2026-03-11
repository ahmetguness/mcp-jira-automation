/**
 * Input sanitization module — validates and sanitizes all external inputs
 * before they reach shell or Docker commands.
 *
 * Security: These functions throw on invalid input rather than attempting
 * to "fix" it. This is intentional — malformed input should be rejected.
 */

import { createLogger } from "./logger.js";

const log = createLogger("sanitize");

// ─── Branch Name ─────────────────────────────────────────────

const BRANCH_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,254}$/;

/**
 * Validate a git branch name.
 * Only allows safe characters: alphanumeric, `/`, `_`, `.`, `-`.
 * @throws if the branch name contains unsafe characters
 */
export function validateBranchName(branch: string): string {
    const trimmed = branch.trim();
    if (!trimmed) throw new Error("Branch name cannot be empty");
    if (!BRANCH_REGEX.test(trimmed)) {
        log.error(`Invalid branch name rejected: ${trimmed.slice(0, 50)}`);
        throw new Error(`Invalid branch name: contains disallowed characters`);
    }
    return trimmed;
}

// ─── Repository URL ──────────────────────────────────────────

const ALLOWED_HOSTS = ["github.com", "gitlab.com", "bitbucket.org"];
const OWNER_REPO_REGEX = /^[\w.-]+\/[\w.-]+$/;

/**
 * Validate a git repository URL.
 * Allows: https://(github.com|gitlab.com|bitbucket.org)/... or owner/repo format.
 * Converts owner/repo format to https://github.com/owner/repo for git clone compatibility.
 * @throws if the URL does not match a known safe pattern
 */
export function validateRepoUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) throw new Error("Repository URL cannot be empty");

    // Allow owner/repo format (no URL) - convert to full GitHub URL
    if (OWNER_REPO_REGEX.test(trimmed)) {
        return `https://github.com/${trimmed}`;
    }

    // Must be https URL from an allowed host
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "https:") {
            throw new Error(`Invalid repo URL: only https is allowed`);
        }
        if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
            throw new Error(`Invalid repo URL: host '${parsed.hostname}' is not in the allow list`);
        }
        return trimmed;
    } catch (e) {
        if (e instanceof Error && e.message.startsWith("Invalid repo URL")) throw e;
        log.error(`Invalid repository URL rejected: ${trimmed.slice(0, 80)}`);
        throw new Error(`Invalid repository URL format`, { cause: e });
    }
}


// ─── Patch Path ──────────────────────────────────────────────

/**
 * Validate a patch file path — prevents path traversal and other tricks.
 * @throws if the path contains "..", starts with "/", or has null bytes
 */
export function validatePatchPath(filePath: string): string {
    const trimmed = filePath.trim();
    if (!trimmed) throw new Error("Patch path cannot be empty");

    // Null byte injection
    if (trimmed.includes("\0")) {
        throw new Error("Patch path contains null bytes");
    }

    // Absolute path
    if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
        throw new Error("Patch path must be relative, not absolute");
    }

    // Path traversal
    const normalized = trimmed.replace(/\\/g, "/");
    const segments = normalized.split("/");
    for (const seg of segments) {
        if (seg === "..") {
            throw new Error("Patch path contains path traversal (..)");
        }
    }

    // Disallow writing to dangerous locations
    const lower = normalized.toLowerCase();
    if (lower.startsWith(".git/") || lower === ".git") {
        throw new Error("Patch path cannot write to .git directory");
    }

    return normalized;
}

