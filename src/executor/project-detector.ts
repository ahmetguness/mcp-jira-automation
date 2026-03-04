/**
 * Project detector — scans cloned repository for marker files to determine
 * the project language, appropriate Docker image, and install command.
 *
 * Detection strategy:
 * 1. Check for marker files at various depths (maxdepth=3)
 * 2. Score each hit: marker.priority + (depth * 100)
 * 3. Lowest score wins (root-level lockfiles beat deep manifests)
 * 4. AI environment hint used only as fallback when no markers found
 */

import { createLogger } from "../logger.js";

const log = createLogger("detector");

// ─── Types ───────────────────────────────────────────────────

export type ProjectLanguage = "node" | "python" | "go" | "rust" | "java" | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface Detection {
    language: ProjectLanguage;
    image: string;
    installCmd?: string[];
    workdir: string;
    confidence: Confidence;
    markers: string[];
    notes?: string[];
}

// ─── Marker Registry ─────────────────────────────────────────

interface MarkerRule {
    file: string;
    language: ProjectLanguage;
    image: string;
    priority: number;
    isLockfile: boolean;
    installCmd: string[];
}

/**
 * Ordered list of marker rules. Lower priority number = higher precedence.
 * Lockfiles are preferred over plain manifests for deterministic installs.
 */
const MARKER_REGISTRY: MarkerRule[] = [
    // Node.js — lockfiles first
    { file: "package-lock.json", language: "node", image: "node:20-slim", priority: 1, isLockfile: true, installCmd: ["npm", "ci"] },
    { file: "pnpm-lock.yaml", language: "node", image: "node:20-slim", priority: 2, isLockfile: true, installCmd: ["pnpm", "install"] },
    { file: "yarn.lock", language: "node", image: "node:20-slim", priority: 3, isLockfile: true, installCmd: ["yarn", "install", "--frozen-lockfile"] },
    { file: "bun.lockb", language: "node", image: "oven/bun:latest", priority: 4, isLockfile: true, installCmd: ["bun", "install"] },
    { file: "package.json", language: "node", image: "node:20-slim", priority: 5, isLockfile: false, installCmd: ["npm", "install"] },

    // Python
    { file: "requirements.txt", language: "python", image: "python:3.12-slim", priority: 10, isLockfile: false, installCmd: ["pip", "install", "-r", "requirements.txt"] },
    { file: "pyproject.toml", language: "python", image: "python:3.12-slim", priority: 11, isLockfile: false, installCmd: ["pip", "install", "."] },
    { file: "Pipfile", language: "python", image: "python:3.12-slim", priority: 12, isLockfile: false, installCmd: ["sh", "-c", "pip install pipenv && pipenv install"] },

    // Go
    { file: "go.mod", language: "go", image: "golang:1.22-bookworm", priority: 20, isLockfile: false, installCmd: ["go", "mod", "download"] },

    // Rust
    { file: "Cargo.toml", language: "rust", image: "rust:1.77-slim", priority: 30, isLockfile: false, installCmd: ["cargo", "fetch"] },

    // Java — wrapper preferred
    { file: "pom.xml", language: "java", image: "maven:3.9-eclipse-temurin-21", priority: 40, isLockfile: false, installCmd: ["mvn", "-q", "dependency:resolve"] },
    { file: "gradlew", language: "java", image: "gradle:8-jdk21", priority: 41, isLockfile: false, installCmd: ["./gradlew", "dependencies"] },
    { file: "build.gradle", language: "java", image: "gradle:8-jdk21", priority: 42, isLockfile: false, installCmd: ["gradle", "dependencies"] },
];

// ─── AI Hint → Image Mapping ────────────────────────────────

const HINT_IMAGE_MAP: Record<ProjectLanguage, string> = {
    node: "node:20-slim",
    python: "python:3.12-slim",
    go: "golang:1.22-bookworm",
    rust: "rust:1.77-slim",
    java: "maven:3.9-eclipse-temurin-21",
    unknown: "ubuntu:24.04",
};

// ─── Language-specific environment variables ─────────────────

export const LANGUAGE_ENV: Record<ProjectLanguage, string[]> = {
    node: ["npm_config_cache=/root/.npm"],
    python: ["PIP_DISABLE_PIP_VERSION_CHECK=1", "PIP_NO_CACHE_DIR=1", "PYTHONDONTWRITEBYTECODE=1"],
    go: ["GOPATH=/root/go", "GOCACHE=/tmp/go-cache"],
    rust: ["CARGO_HOME=/root/.cargo"],
    java: ["MAVEN_OPTS=-Dmaven.repo.local=/root/.m2"],
    unknown: [],
};

// ─── Marker Hit (internal) ───────────────────────────────────

interface MarkerHit {
    rule: MarkerRule;
    path: string;
    depth: number;
    score: number;
}

// ─── Core Detection Logic ────────────────────────────────────

/**
 * Detect project type from a list of found marker file paths.
 *
 * @param foundFiles - Marker file paths relative to workspace root
 *                     (e.g. ["package.json", "backend/pyproject.toml"])
 * @param aiHint     - Optional AI-provided environment hint
 * @param workspaceRoot - Root directory (default "/workspace")
 */
export function detectProject(
    foundFiles: string[],
    aiHint?: string,
    workspaceRoot: string = "/workspace",
): Detection {
    const notes: string[] = [];

    // Match found files against registry
    const hits: MarkerHit[] = [];

    for (const filePath of foundFiles) {
        const basename = filePath.split("/").pop() ?? filePath;
        const depth = filePath.split("/").filter(Boolean).length - 1; // 0 = root

        for (const rule of MARKER_REGISTRY) {
            if (rule.file === basename) {
                const score = rule.priority + (Math.max(0, depth) * 100);
                hits.push({ rule, path: filePath, depth, score });
            }
        }
    }

    // Sort by score — lowest wins
    hits.sort((a, b) => a.score - b.score);

    if (hits.length > 0) {
        log.info(`markers found: ${hits.map(h => `${h.path} (depth=${h.depth})`).join(", ")}`);

        const best = hits[0]!;

        // Determine workdir from marker path
        const markerDir = best.path.split("/").slice(0, -1).join("/");
        const workdir = markerDir ? `${workspaceRoot}/${markerDir}` : workspaceRoot;

        // Determine confidence
        let confidence: Confidence = "medium";
        if (best.rule.isLockfile && best.depth === 0) confidence = "high";
        else if (best.depth > 0) confidence = "low";

        // Check for same-language lockfile to upgrade install command
        const installCmd = resolveBestInstallCmd(best.rule, hits);

        // Check AI hint conflict
        const parsedHint = parseHint(aiHint);
        if (parsedHint && parsedHint !== best.rule.language) {
            notes.push(`AI hint "${aiHint}" conflicts with detected "${best.rule.language}" — hint ignored`);
            log.warn(`AI hint "${aiHint}" conflicts with detected "${best.rule.language}" — hint ignored`);
        } else if (parsedHint) {
            log.info(`AI hint "${aiHint}" confirms detected language`);
        }

        // Log multi-language markers
        const languages = new Set(hits.map(h => h.rule.language));
        if (languages.size > 1) {
            notes.push(`Multiple languages detected: ${[...languages].join(", ")} — using "${best.rule.language}" (highest priority)`);
            log.warn(`Multiple languages detected: ${[...languages].join(", ")} — using "${best.rule.language}"`);
        }

        const detection: Detection = {
            language: best.rule.language,
            image: best.rule.image,
            installCmd,
            workdir,
            confidence,
            markers: hits.map(h => h.path),
            notes: notes.length > 0 ? notes : undefined,
        };

        log.info(`selected: ${detection.language} (confidence=${detection.confidence}, image=${detection.image})`);
        return detection;
    }

    // No markers found — try AI hint as fallback
    const parsedHint = parseHint(aiHint);
    if (parsedHint && parsedHint !== "unknown") {
        notes.push(`No markers found — using AI hint "${parsedHint}" as fallback`);
        log.info(`No markers found. Using AI hint fallback: ${parsedHint}`);
        return {
            language: parsedHint,
            image: HINT_IMAGE_MAP[parsedHint],
            workdir: workspaceRoot,
            confidence: "low",
            markers: [],
            notes,
        };
    }

    // Complete fallback
    log.warn("No markers found and no valid AI hint — using ubuntu:24.04 fallback");
    return {
        language: "unknown",
        image: "ubuntu:24.04",
        workdir: workspaceRoot,
        confidence: "low",
        markers: [],
        notes: ["No project markers found"],
    };
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * If the best marker is a manifest (e.g. package.json) but a lockfile
 * for the same language exists at the same depth, upgrade to the lockfile's
 * install command for deterministic builds.
 */
function resolveBestInstallCmd(bestRule: MarkerRule, hits: MarkerHit[]): string[] {
    if (bestRule.isLockfile) return bestRule.installCmd;

    // Look for a lockfile of the same language at the same or shallower depth
    const lockfileHit = hits.find(
        h => h.rule.language === bestRule.language && h.rule.isLockfile,
    );

    if (lockfileHit) {
        log.info(`Upgrading install command: ${lockfileHit.rule.file} found → ${lockfileHit.rule.installCmd.join(" ")}`);
        return lockfileHit.rule.installCmd;
    }

    return bestRule.installCmd;
}

/**
 * Parse and validate the AI-provided environment hint.
 */
function parseHint(hint?: string): ProjectLanguage | null {
    if (!hint) return null;
    const normalized = hint.toLowerCase().trim();
    const valid: ProjectLanguage[] = ["node", "python", "go", "rust", "java", "unknown"];
    return valid.includes(normalized as ProjectLanguage) ? (normalized as ProjectLanguage) : null;
}

/**
 * Returns the list of all marker filenames to search for.
 * Used by the scout container to run `find` commands.
 */
export function getAllMarkerFiles(): string[] {
    return [...new Set(MARKER_REGISTRY.map(r => r.file))];
}

/**
 * Apply --ignore-scripts flag to npm/yarn install commands if configured.
 */
export function applyInstallScriptsPolicy(cmd: string[], allowScripts: boolean): string[] {
    if (allowScripts) return cmd;

    const bin = cmd[0];
    if (bin === "npm" && !cmd.includes("--ignore-scripts")) {
        return [...cmd, "--ignore-scripts"];
    }
    if (bin === "yarn" && !cmd.includes("--ignore-scripts")) {
        return [...cmd, "--ignore-scripts"];
    }
    return cmd;
}
