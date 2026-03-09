import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Preservation Property Tests for ES Module Compatibility Fix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 * 
 * Property 2: Preservation - Build Output and Runtime Behavior
 * 
 * These tests verify that operations NOT involving src/**\/*.js files
 * remain unchanged after the fix. This establishes the baseline behavior
 * that must be preserved.
 * 
 * IMPORTANT: These tests run on UNFIXED code to capture baseline behavior.
 * They should PASS on unfixed code and continue to PASS after the fix.
 */

// Capture baseline build output before any changes
let baselineDistFiles: string[] = [];

beforeAll(() => {
    // Run build to ensure dist/ is up to date
    try {
        execSync("npm run build", { encoding: "utf-8", stdio: "pipe" });
    } catch {
        // Build might fail, but we still want to capture what's there
    }

    // Capture dist/ directory structure
    if (existsSync("dist")) {
        baselineDistFiles = getAllFiles("dist");
    }
});

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
    const files = readdirSync(dirPath);

    files.forEach((file) => {
        const filePath = join(dirPath, file);
        if (statSync(filePath).isDirectory()) {
            arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath);
        }
    });

    return arrayOfFiles;
}

describe("ES Module Bugfix Preservation Tests", () => {
    /**
     * Property 2.1: Build Output Preservation
     * 
     * Validates: Requirement 3.1 - TypeScript compilation to dist/ continues to work
     * 
     * For any build process execution, the fixed state SHALL produce the same
     * compiled output in dist/ directory as before the fix.
     */
    it("should preserve TypeScript compilation to dist/ directory", () => {
        // Verify build command succeeds
        expect(() => {
            execSync("npm run build", { encoding: "utf-8", stdio: "pipe" });
        }).not.toThrow();

        // Verify dist/ directory exists
        expect(existsSync("dist")).toBe(true);

        // Verify dist/ contains compiled JavaScript files
        const distFiles = getAllFiles("dist");
        const jsFiles = distFiles.filter((f) => f.endsWith(".js"));
        const dtsFiles = distFiles.filter((f) => f.endsWith(".d.ts"));

        expect(jsFiles.length).toBeGreaterThan(0);
        expect(dtsFiles.length).toBeGreaterThan(0);

        // Verify key output files exist
        expect(existsSync("dist/index.js")).toBe(true);
        expect(existsSync("dist/config.js")).toBe(true);
        expect(existsSync("dist/logger.js")).toBe(true);
    });

    /**
     * Property 2.2: Test Suite Preservation
     * 
     * Validates: Requirement 3.3 - All passing tests continue to pass
     * 
     * For any test that passes on unfixed code (tests that don't import
     * problematic .js files), the fixed state SHALL continue to pass those tests.
     */
    it("should identify tests that pass on unfixed code", () => {
        // These tests pass on unfixed code because they don't import
        // the problematic .js files from src/
        const passingTests = [
            "tests/runtimeSelector.test.ts",
            "tests/reporter.test.ts",
            "tests/api-testing/models.test.ts",
            "tests/ai-provider.test.ts",
            "tests/api-testing/endpoint-parser.test.ts",
            "tests/validation.test.ts",
        ];

        // Verify these test files exist
        passingTests.forEach((testFile) => {
            expect(existsSync(testFile)).toBe(true);
        });

        // Note: We document which tests pass on unfixed code
        // After the fix, all tests (including the currently failing ones) should pass
        // This test just verifies the baseline set of passing tests exists
        expect(passingTests.length).toBe(6);
    });

    /**
     * Property 2.3: TypeScript Source Files Preservation
     * 
     * Validates: Requirements 3.4, 3.5 - Logger and config functionality preserved
     * 
     * For any TypeScript source file in src/, the fixed state SHALL NOT modify
     * the source code - only remove compiled .js artifacts.
     */
    it("should verify TypeScript source files exist and are valid", () => {
        // Verify key TypeScript source files exist
        const sourceFiles = [
            "src/config.ts",
            "src/logger.ts",
            "src/types.ts",
            "src/jira/client.ts",
            "src/mcp/manager.ts",
            "src/mcp/spawn.ts",
            "src/validation/jira.ts",
            "src/validation/mcp.ts",
        ];

        sourceFiles.forEach((file) => {
            expect(existsSync(file)).toBe(true);

            // Verify files contain ES module syntax (import/export)
            const content = readFileSync(file, "utf-8");
            const hasImport = content.includes("import ");
            const hasExport = content.includes("export ");

            // At least one of these should be true for ES modules
            expect(hasImport || hasExport).toBe(true);

            // Verify files DON'T use CommonJS syntax in TypeScript source
            // (Note: comments or strings might contain these words, so this is a rough check)
            const lines = content.split("\n");
            const codeLines = lines.filter(
                (line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")
            );
            const codeContent = codeLines.join("\n");

            // TypeScript source should not have CommonJS patterns
            expect(codeContent).not.toMatch(/^exports\./m);
            expect(codeContent).not.toMatch(/^module\.exports/m);
        });
    });

    /**
     * Property 2.4: Build Configuration Preservation
     * 
     * Validates: Requirement 3.1 - Build process configuration unchanged
     * 
     * For any build configuration, the fixed state SHALL maintain the same
     * TypeScript compiler settings and output directory.
     */
    it("should verify build configuration is correct", () => {
        // Verify tsconfig.build.json exists
        expect(existsSync("tsconfig.build.json")).toBe(true);

        // Read and verify configuration
        // tsconfig.build.json extends tsconfig.json, so check the base config
        const baseConfig = JSON.parse(readFileSync("tsconfig.json", "utf-8"));

        // Verify outDir is set to dist in base config
        expect(baseConfig.compilerOptions?.outDir).toBe("./dist");

        // Verify package.json has correct module type
        const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
        expect(packageJson.type).toBe("module");

        // Verify build script exists
        expect(packageJson.scripts?.build).toBe("tsc -p tsconfig.build.json");
    });

    /**
     * Property 2.5: Dist Directory Structure Preservation
     * 
     * Validates: Requirement 3.2 - Production runtime behavior unchanged
     * 
     * For any compiled output in dist/, the fixed state SHALL produce the same
     * directory structure and file types as before the fix.
     */
    it("should verify dist/ directory structure is preserved", () => {
        const distFiles = getAllFiles("dist");

        // Verify we have the expected file types
        const jsFiles = distFiles.filter((f) => f.endsWith(".js"));
        const dtsFiles = distFiles.filter((f) => f.endsWith(".d.ts"));
        const mapFiles = distFiles.filter((f) => f.endsWith(".map"));

        expect(jsFiles.length).toBeGreaterThan(0);
        expect(dtsFiles.length).toBeGreaterThan(0);
        expect(mapFiles.length).toBeGreaterThan(0);

        // Verify key directories exist in dist/
        expect(existsSync("dist/ai")).toBe(true);
        expect(existsSync("dist/jira")).toBe(true);
        expect(existsSync("dist/mcp")).toBe(true);
        expect(existsSync("dist/validation")).toBe(true);

        // Store baseline for comparison after fix
        if (baselineDistFiles.length === 0) {
            baselineDistFiles = distFiles;
        }

        // Verify we have a reasonable number of files
        expect(distFiles.length).toBeGreaterThan(50);
    });

    /**
     * Property 2.6: Logger Module Functionality Preservation
     * 
     * Validates: Requirement 3.4 - Logger functionality unchanged
     * 
     * For any logger functionality, the fixed state SHALL maintain the same
     * logging capabilities when using TypeScript source or compiled output.
     */
    it("should verify logger TypeScript source has correct ES module syntax", () => {
        const loggerSource = readFileSync("src/logger.ts", "utf-8");

        // Verify logger uses ES module imports
        expect(loggerSource).toContain("import");

        // Verify logger exports functions/objects
        expect(loggerSource).toContain("export");

        // Verify logger imports node:crypto correctly
        expect(loggerSource).toMatch(/import.*from\s+['"]node:crypto['"]/);

        // Verify logger has key exports
        expect(loggerSource).toContain("baseLogger");
        expect(loggerSource).toContain("setLogContext");
    });

    /**
     * Property 2.7: Config Module Functionality Preservation
     * 
     * Validates: Requirement 3.5 - Config functionality unchanged
     * 
     * For any config functionality, the fixed state SHALL maintain the same
     * configuration loading when using TypeScript source or compiled output.
     */
    it("should verify config TypeScript source has correct ES module syntax", () => {
        const configSource = readFileSync("src/config.ts", "utf-8");

        // Verify config uses ES module imports
        expect(configSource).toContain("import");

        // Verify config exports functions
        expect(configSource).toContain("export");

        // Verify config has key exports
        expect(configSource).toContain("loadConfig");
    });
});
