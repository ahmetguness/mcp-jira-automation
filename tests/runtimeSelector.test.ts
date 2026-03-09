import { describe, it, expect } from "vitest";
import { determineRuntime } from "../src/ai/runtimeSelector.js";

describe("Runtime Selector", () => {
    describe("determineRuntime", () => {
        it("detects python from issue scope files", () => {
            const result = determineRuntime(["src/main.py"], [], []);
            expect(result.primary).toBe("python");
            expect(result.isMulti).toBe(false);
            expect(result.detected[0].lang).toBe("python");
        });

        it("detects node from tests if source is ambiguous or missing", () => {
            const result = determineRuntime([], ["tests/app.test.ts"], []);
            expect(result.primary).toBe("node");
            expect(result.isMulti).toBe(false);
        });

        it("detects node from marker files with higher priority for root", () => {
            const result = determineRuntime([], [], ["package.json", "backend/requirements.txt"]);
            expect(result.primary).toBe("node");
            expect(result.isMulti).toBe(true); // both node and python detected
            expect(result.markers).toContain("package.json");
            expect(result.markers).toContain("backend/requirements.txt");
        });

        it("returns unknown for completely ambiguous repositories", () => {
            const result = determineRuntime(["docs/readme.md"], [], ["Makefile", "docker-compose.yml"]);
            expect(result.primary).toBe("unknown");
            expect(result.detected.length).toBe(0);
        });

        it("successfully identifies a multi-language repository", () => {
            const result = determineRuntime(
                ["src/app.ts"],
                ["tests/app.test.ts", "tests/test_api.py"],
                ["package.json", "requirements.txt"]
            );

            // Should be node since it has more hits (mentioned, test, marker vs test, marker)
            expect(result.primary).toBe("node");
            expect(result.isMulti).toBe(true);
        });
    });
});
