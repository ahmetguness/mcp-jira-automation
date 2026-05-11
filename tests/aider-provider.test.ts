import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateExternalAiderPath } from "../src/ai/aider.js";

describe("validateExternalAiderPath", () => {
    const projectRoot = process.cwd();

    it("allows a command name resolved from PATH", () => {
        expect(validateExternalAiderPath("aider", projectRoot)).toBe("aider");
        expect(validateExternalAiderPath("aider.cmd", projectRoot)).toBe("aider.cmd");
    });

    it("allows an absolute executable path outside the project", () => {
        const externalPath = process.platform === "win32"
            ? "C:\\Tools\\aider\\aider.exe"
            : "/opt/aider/bin/aider";

        expect(validateExternalAiderPath(externalPath, projectRoot)).toBe(externalPath);
    });

    it("rejects project-local relative executable paths", () => {
        expect(() => validateExternalAiderPath(".venv\\Scripts\\aider.exe", projectRoot))
            .toThrow("Relative project paths are not allowed");
        expect(() => validateExternalAiderPath("node_modules/.bin/aider", projectRoot))
            .toThrow("Relative project paths are not allowed");
    });

    it("rejects absolute executable paths inside the project", () => {
        const projectLocalPath = path.join(projectRoot, ".venv", "Scripts", "aider.exe");

        expect(() => validateExternalAiderPath(projectLocalPath, projectRoot))
            .toThrow("outside the project root");
    });
});
