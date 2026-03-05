import { describe, it, expect } from "vitest";
import {
    detectProject,
    getAllMarkerFiles,
    applyInstallScriptsPolicy,
    type Detection,
} from "../src/executor/project-detector.js";

// ─── Node.js Detection ──────────────────────────────────────

describe("detectProject — Node.js", () => {
    it("detects package-lock.json at root as high confidence npm ci", () => {
        const d = detectProject(["package-lock.json", "package.json"]);
        expect(d.language).toBe("node");
        expect(d.image).toBe("node:20-bookworm");
        expect(d.installCmd).toEqual(["npm", "ci"]);
        expect(d.confidence).toBe("high");
        expect(d.workdir).toBe("/workspace");
    });

    it("detects package.json without lockfile as medium confidence npm install", () => {
        const d = detectProject(["package.json"]);
        expect(d.language).toBe("node");
        expect(d.installCmd).toEqual(["npm", "install"]);
        expect(d.confidence).toBe("medium");
    });

    it("detects yarn.lock and upgrades install command", () => {
        const d = detectProject(["yarn.lock", "package.json"]);
        expect(d.language).toBe("node");
        expect(d.installCmd).toEqual(["yarn", "install", "--frozen-lockfile"]);
        expect(d.confidence).toBe("high");
    });

    it("detects pnpm-lock.yaml", () => {
        const d = detectProject(["pnpm-lock.yaml", "package.json"]);
        expect(d.language).toBe("node");
        expect(d.installCmd).toEqual(["pnpm", "install"]);
        expect(d.confidence).toBe("high");
    });

    it("detects bun.lockb", () => {
        const d = detectProject(["bun.lockb", "package.json"]);
        expect(d.language).toBe("node");
        expect(d.image).toBe("oven/bun:latest");
        expect(d.installCmd).toEqual(["bun", "install"]);
    });
});

// ─── Python Detection ────────────────────────────────────────

describe("detectProject — Python", () => {
    it("detects requirements.txt", () => {
        const d = detectProject(["requirements.txt"]);
        expect(d.language).toBe("python");
        expect(d.image).toBe("python:3.12-bookworm");
        expect(d.installCmd).toEqual(["pip", "install", "-r", "requirements.txt"]);
    });

    it("detects pyproject.toml", () => {
        const d = detectProject(["pyproject.toml"]);
        expect(d.language).toBe("python");
        expect(d.installCmd).toEqual(["pip", "install", "."]);
    });

    it("detects Pipfile", () => {
        const d = detectProject(["Pipfile"]);
        expect(d.language).toBe("python");
        expect(d.installCmd).toEqual(["sh", "-c", "pip install pipenv && pipenv install"]);
    });
});

// ─── Go Detection ────────────────────────────────────────────

describe("detectProject — Go", () => {
    it("detects go.mod", () => {
        const d = detectProject(["go.mod"]);
        expect(d.language).toBe("go");
        expect(d.image).toBe("golang:1.22-bookworm");
        expect(d.installCmd).toEqual(["go", "mod", "download"]);
    });
});

// ─── Rust Detection ──────────────────────────────────────────

describe("detectProject — Rust", () => {
    it("detects Cargo.toml", () => {
        const d = detectProject(["Cargo.toml"]);
        expect(d.language).toBe("rust");
        expect(d.image).toBe("rust:1.77");
        expect(d.installCmd).toEqual(["cargo", "fetch"]);
    });
});

// ─── Java Detection ──────────────────────────────────────────

describe("detectProject — Java", () => {
    it("detects pom.xml for Maven", () => {
        const d = detectProject(["pom.xml"]);
        expect(d.language).toBe("java");
        expect(d.image).toBe("maven:3.9-eclipse-temurin-21");
        expect(d.installCmd).toEqual(["mvn", "-q", "dependency:resolve"]);
    });

    it("detects gradlew wrapper (preferred over build.gradle)", () => {
        const d = detectProject(["gradlew", "build.gradle"]);
        expect(d.language).toBe("java");
        expect(d.installCmd).toEqual(["./gradlew", "dependencies"]);
    });

    it("detects build.gradle without wrapper", () => {
        const d = detectProject(["build.gradle"]);
        expect(d.language).toBe("java");
        expect(d.installCmd).toEqual(["gradle", "dependencies"]);
    });
});

// ─── Mixed/Conflict Detection ────────────────────────────────

describe("detectProject — mixed markers", () => {
    it("prefers node over python when both at root", () => {
        const d = detectProject(["package.json", "pyproject.toml"]);
        expect(d.language).toBe("node");
        expect(d.notes).toBeDefined();
        expect(d.notes!.some(n => n.includes("Multiple languages"))).toBe(true);
    });

    it("prefers root marker over subdirectory marker", () => {
        const d = detectProject(["requirements.txt", "frontend/package.json"]);
        expect(d.language).toBe("python");
        expect(d.workdir).toBe("/workspace");
    });
});

// ─── Subdirectory Detection ──────────────────────────────────

describe("detectProject — subdirectories", () => {
    it("sets workdir to subdirectory when marker is nested", () => {
        const d = detectProject(["backend/package.json"]);
        expect(d.language).toBe("node");
        expect(d.workdir).toBe("/workspace/backend");
        expect(d.confidence).toBe("low");
    });
});

// ─── No Markers / Fallback ───────────────────────────────────

describe("detectProject — fallback", () => {
    it("returns unknown when no markers found", () => {
        const d = detectProject([]);
        expect(d.language).toBe("unknown");
        expect(d.image).toBe("ubuntu:24.04");
        expect(d.confidence).toBe("low");
    });

    it("uses AI hint when no markers found", () => {
        const d = detectProject([], "go");
        expect(d.language).toBe("go");
        expect(d.image).toBe("golang:1.22-bookworm");
        expect(d.confidence).toBe("low");
        expect(d.notes).toBeDefined();
        expect(d.notes!.some(n => n.includes("AI hint"))).toBe(true);
    });

    it("ignores AI hint when it conflicts with detected markers", () => {
        const d = detectProject(["package.json"], "python");
        expect(d.language).toBe("node");
        expect(d.notes).toBeDefined();
        expect(d.notes!.some(n => n.includes("conflicts"))).toBe(true);
    });

    it("confirms AI hint when it matches detected language", () => {
        const d = detectProject(["package.json"], "node");
        expect(d.language).toBe("node");
    });

    it("ignores invalid AI hint", () => {
        const d = detectProject([], "invalid-language");
        expect(d.language).toBe("unknown");
    });
});

// ─── Install Scripts Policy ──────────────────────────────────

describe("applyInstallScriptsPolicy", () => {
    it("adds --ignore-scripts to npm install when not allowed", () => {
        const result = applyInstallScriptsPolicy(["npm", "install"], false);
        expect(result).toEqual(["npm", "install", "--ignore-scripts"]);
    });

    it("does not add --ignore-scripts when allowed", () => {
        const result = applyInstallScriptsPolicy(["npm", "install"], true);
        expect(result).toEqual(["npm", "install"]);
    });

    it("does not duplicate --ignore-scripts if already present", () => {
        const result = applyInstallScriptsPolicy(["npm", "install", "--ignore-scripts"], false);
        expect(result).toEqual(["npm", "install", "--ignore-scripts"]);
    });

    it("adds --ignore-scripts to yarn install", () => {
        const result = applyInstallScriptsPolicy(["yarn", "install", "--frozen-lockfile"], false);
        expect(result).toEqual(["yarn", "install", "--frozen-lockfile", "--ignore-scripts"]);
    });

    it("does not affect non-npm/yarn commands", () => {
        const result = applyInstallScriptsPolicy(["pip", "install", "-r", "requirements.txt"], false);
        expect(result).toEqual(["pip", "install", "-r", "requirements.txt"]);
    });
});

// ─── getAllMarkerFiles ────────────────────────────────────────

describe("getAllMarkerFiles", () => {
    it("returns unique marker filenames", () => {
        const markers = getAllMarkerFiles();
        expect(markers.length).toBe(new Set(markers).size);
        expect(markers).toContain("package.json");
        expect(markers).toContain("requirements.txt");
        expect(markers).toContain("go.mod");
        expect(markers).toContain("Cargo.toml");
        expect(markers).toContain("pom.xml");
    });
});
