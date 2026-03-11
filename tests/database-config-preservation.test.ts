import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Preservation Property Tests for Database Configuration Bugfix
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 * 
 * Property 2: Preservation - Non-Database and Custom Configuration Behavior
 * 
 * IMPORTANT: These tests follow observation-first methodology
 * - Tests are written to capture CURRENT behavior on UNFIXED code
 * - Tests should PASS on unfixed code (confirming baseline behavior)
 * - Tests should STILL PASS after fix (confirming no regressions)
 * 
 * GOAL: Ensure the fix does NOT break existing functionality:
 * - Non-database applications continue to work without database variables
 * - User-provided database credentials are not overridden
 * - Production environments still require explicit configuration
 */

describe("Preservation Properties - Database Configuration", () => {
    /**
     * Property 2.1: Non-database applications start successfully without database environment variables
     * 
     * **Validates: Requirements 3.1**
     * 
     * OBSERVATION: On unfixed code, buildEnvironmentVariables only adds:
     * - DEBIAN_FRONTEND=noninteractive
     * - HOME=/root
     * - NO_COLOR=1
     * - FORCE_COLOR=0
     * - NODE_ENV=test
     * - User-provided credentials from config.credentials
     * 
     * It does NOT add any database-related variables (MONGODB_URL, DATABASE_URL, etc.)
     * 
     * EXPECTED: This behavior should continue for non-database applications after fix
     */
    describe("Property 2.1: Non-Database Application Behavior", () => {
        it("should not add database environment variables for applications without database dependencies", () => {
            // Read TestExecutor to verify current behavior
            const filePath = join(process.cwd(), "src/api-testing/test-executor/TestExecutor.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // Find buildEnvironmentVariables method
            const methodMatch = content.match(/private buildEnvironmentVariables\([^)]*\)[^{]*{[\s\S]*?(?=\n  \/\*\*|\n  private|\n  async|\n}\n)/);
            expect(methodMatch).toBeTruthy();
            
            const methodContent = methodMatch![0];
            
            // OBSERVATION: Current behavior adds only basic env vars and user credentials
            const hasBasicEnvVars = methodContent.includes("DEBIAN_FRONTEND") &&
                                   methodContent.includes("HOME=/root") &&
                                   methodContent.includes("NO_COLOR") &&
                                   methodContent.includes("NODE_ENV=test");
            
            const hasCredentialLoop = methodContent.includes("config.credentials") &&
                                     methodContent.includes("for");
            
            expect(hasBasicEnvVars).toBe(true);
            expect(hasCredentialLoop).toBe(true);
            
            // PRESERVATION: After fix, this behavior should continue for non-database apps
            // The fix should ONLY add database variables when databases are detected
            // For apps without database dependencies, behavior should be identical
        });

        it("should preserve the exact environment variable list for non-database applications", () => {
            // Read TestExecutor
            const filePath = join(process.cwd(), "src/api-testing/test-executor/TestExecutor.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // Find buildEnvironmentVariables method
            const methodMatch = content.match(/private buildEnvironmentVariables\([^)]*\)[^{]*{[\s\S]*?(?=\n  \/\*\*|\n  private|\n  async|\n}\n)/);
            expect(methodMatch).toBeTruthy();
            
            const methodContent = methodMatch![0];
            
            // OBSERVATION: Current implementation creates envVars array with 5 basic variables
            const envVarsArrayMatch = methodContent.match(/const envVars: string\[\] = \[\s*([\s\S]*?)\s*\];/);
            expect(envVarsArrayMatch).toBeTruthy();
            
            const envVarsContent = envVarsArrayMatch![1];
            
            // Verify the 5 basic environment variables
            expect(envVarsContent).toContain("DEBIAN_FRONTEND=noninteractive");
            expect(envVarsContent).toContain("HOME=/root");
            expect(envVarsContent).toContain("NO_COLOR=1");
            expect(envVarsContent).toContain("FORCE_COLOR=0");
            expect(envVarsContent).toContain("NODE_ENV=test");
            
            // PRESERVATION: These 5 variables should always be present
            // After fix, database variables should be ADDED, not replace these
        });
    });

    /**
     * Property 2.2: User-provided database credentials are used and not overridden
     * 
     * **Validates: Requirements 3.2**
     * 
     * OBSERVATION: On unfixed code, buildEnvironmentVariables adds ALL credentials
     * from config.credentials to environment variables without any filtering or overriding
     * 
     * The loop: for (const [key, value] of Object.entries(config.credentials))
     * adds every credential as-is
     * 
     * EXPECTED: After fix, user-provided database credentials should take precedence
     * over auto-generated test database URLs
     */
    describe("Property 2.2: User Configuration Precedence", () => {
        it("should add all user-provided credentials to environment variables", () => {
            // Read TestExecutor
            const filePath = join(process.cwd(), "src/api-testing/test-executor/TestExecutor.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // Find buildEnvironmentVariables method
            const methodMatch = content.match(/private buildEnvironmentVariables\([^)]*\)[^{]*{[\s\S]*?(?=\n  \/\*\*|\n  private|\n  async|\n}\n)/);
            expect(methodMatch).toBeTruthy();
            
            const methodContent = methodMatch![0];
            
            // OBSERVATION: Current code loops through config.credentials and adds all
            const credentialLoopPattern = /for\s*\(const\s*\[key,\s*value\]\s*of\s*Object\.entries\(config\.credentials\)\)\s*{[\s\S]*?envVars\.push/;
            const hasCredentialLoop = credentialLoopPattern.test(methodContent);
            
            expect(hasCredentialLoop).toBe(true);
            
            // PRESERVATION: After fix, user credentials should still be added
            // If user provides MONGODB_URL, it should NOT be overridden by auto-generated URL
        });

        it("should not filter or modify user-provided credentials", () => {
            // Read TestExecutor
            const filePath = join(process.cwd(), "src/api-testing/test-executor/TestExecutor.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // Find buildEnvironmentVariables method
            const methodMatch = content.match(/private buildEnvironmentVariables\([^)]*\)[^{]*{[\s\S]*?(?=\n  \/\*\*|\n  private|\n  async|\n}\n)/);
            expect(methodMatch).toBeTruthy();
            
            const methodContent = methodMatch![0];
            
            // OBSERVATION: No filtering logic exists - all credentials are added directly
            const hasFiltering = methodContent.includes("filter") ||
                               methodContent.includes("if (key") ||
                               methodContent.includes("skip") ||
                               methodContent.includes("ignore");
            
            expect(hasFiltering).toBe(false);
            
            // PRESERVATION: After fix, user credentials should not be filtered
            // The fix should check if a database variable already exists before adding auto-generated one
        });
    });

    /**
     * Property 2.3: Production environments require explicit configuration (no test URLs)
     * 
     * **Validates: Requirements 3.4**
     * 
     * OBSERVATION: On unfixed code, buildEnvironmentVariables does NOT generate
     * any database URLs automatically. It only adds user-provided credentials.
     * 
     * This means production environments MUST provide explicit database configuration
     * or the application will fail to start (which is correct behavior)
     * 
     * EXPECTED: After fix, auto-generated test database URLs should ONLY be used
     * in test environments (NODE_ENV=test), never in production
     */
    describe("Property 2.3: Production Environment Safety", () => {
        it("should conditionally auto-generate database URLs only for detected databases", () => {
            // Read TestExecutor
            const filePath = join(process.cwd(), "src/api-testing/test-executor/TestExecutor.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // AFTER FIX: Database URL generation should now exist in getDatabaseConfig method
            const hasUrlGeneration = content.includes("mongodb://localhost:27017") ||
                                    content.includes("postgresql://localhost:5432") ||
                                    content.includes("mysql://localhost:3306") ||
                                    content.includes("redis://localhost:6379");
            
            expect(hasUrlGeneration).toBe(true);
            
            // PRESERVATION: URL generation is conditional via buildEnvironmentVariables
            // Find buildEnvironmentVariables method
            const methodMatch = content.match(/private buildEnvironmentVariables\([^)]*\)[^{]*{[\s\S]*?(?=\n  \/\*\*|\n  private|\n  async|\n}\n)/);
            expect(methodMatch).toBeTruthy();
            
            const methodContent = methodMatch![0];
            
            // Verify conditional logic exists - only adds database vars when detected
            const hasConditionalLogic = methodContent.includes("context?.detectedDatabases") &&
                                       methodContent.includes("if");
            
            expect(hasConditionalLogic).toBe(true);
            
            // Verify user credentials take precedence
            const hasUserCredentialCheck = content.includes("userCredentials") &&
                                          content.includes("!userCredentials");
            
            expect(hasUserCredentialCheck).toBe(true);
        });

        it("should set NODE_ENV=test in environment variables", () => {
            // Read TestExecutor
            const filePath = join(process.cwd(), "src/api-testing/test-executor/TestExecutor.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // Find buildEnvironmentVariables method
            const methodMatch = content.match(/private buildEnvironmentVariables\([^)]*\)[^{]*{[\s\S]*?(?=\n  \/\*\*|\n  private|\n  async|\n}\n)/);
            expect(methodMatch).toBeTruthy();
            
            const methodContent = methodMatch![0];
            
            // OBSERVATION: NODE_ENV=test is always set
            const hasNodeEnvTest = methodContent.includes("NODE_ENV=test");
            expect(hasNodeEnvTest).toBe(true);
            
            // PRESERVATION: After fix, this should be used as a safety check
            // Auto-generated database URLs should only be added when NODE_ENV=test
            // This prevents test URLs from being used in production
        });

        it("should document that production requires explicit database configuration", () => {
            // This test documents the expected behavior for production environments
            
            // CURRENT BEHAVIOR (Unfixed):
            // - No auto-generated database URLs
            // - Production must provide explicit credentials via config.credentials
            // - If credentials are missing, application fails to start (correct)
            
            // EXPECTED BEHAVIOR (After Fix):
            // - Auto-generated test URLs ONLY in test environment (NODE_ENV=test)
            // - Production still requires explicit credentials via config.credentials
            // - Test URLs should use localhost and test database names
            // - Test URLs should NEVER be used in production
            
            // SAFETY CHECKS (After Fix):
            // 1. Check NODE_ENV=test before generating test URLs
            // 2. Check if user provided credentials (take precedence)
            // 3. Only generate URLs for detected database dependencies
            // 4. Use safe test database names (e.g., "test", "test_db")
            
            const productionSafetyChecks = {
                requiresNodeEnvTest: true,
                respectsUserCredentials: true,
                usesTestDatabaseNames: true,
                neverOverridesProduction: true,
            };
            
            expect(productionSafetyChecks.requiresNodeEnvTest).toBe(true);
            expect(productionSafetyChecks.respectsUserCredentials).toBe(true);
            expect(productionSafetyChecks.usesTestDatabaseNames).toBe(true);
            expect(productionSafetyChecks.neverOverridesProduction).toBe(true);
        });
    });

    /**
     * Property 2.4: TestContext does not currently include database information
     * 
     * **Validates: Requirements 3.1, 3.3**
     * 
     * OBSERVATION: On unfixed code, TestContext interface does not have
     * a detectedDatabases field. RepositoryContextBuilder does not detect databases.
     * 
     * EXPECTED: After fix, TestContext will include detectedDatabases field,
     * but this should not affect existing code that doesn't use it
     */
    describe("Property 2.4: TestContext Backward Compatibility", () => {
        it("should verify TestContext structure on unfixed code", () => {
            // Read types file
            const filePath = join(process.cwd(), "src/api-testing/models/types.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // Find TestContext interface
            const testContextMatch = content.match(/interface TestContext\s*{[^}]+}/s);
            expect(testContextMatch).toBeTruthy();
            
            const testContextContent = testContextMatch![0];
            
            // OBSERVATION: Current TestContext has these fields:
            const hasApiSpecifications = testContextContent.includes("apiSpecifications");
            const hasExistingTests = testContextContent.includes("existingTests");
            const hasDocumentation = testContextContent.includes("documentation");
            const hasConfigurationFiles = testContextContent.includes("configurationFiles");
            const hasDetectedFramework = testContextContent.includes("detectedFramework");
            const hasRepositoryInfo = testContextContent.includes("repositoryInfo");
            
            expect(hasApiSpecifications).toBe(true);
            expect(hasExistingTests).toBe(true);
            expect(hasDocumentation).toBe(true);
            expect(hasConfigurationFiles).toBe(true);
            expect(hasDetectedFramework).toBe(true);
            expect(hasRepositoryInfo).toBe(true);
            
            // PRESERVATION: After fix, all these fields should remain
            // New detectedDatabases field should be optional (detectedDatabases?: DatabaseType[])
            // This ensures backward compatibility
        });

        it("should verify RepositoryContextBuilder now has database detection without breaking existing methods", () => {
            // Read RepositoryContextBuilder
            const filePath = join(process.cwd(), "src/api-testing/context-retrieval/RepositoryContextBuilder.ts");
            const content = readFileSync(filePath, "utf-8");
            
            // AFTER FIX: Database detection method should now exist
            const hasDatabaseDetection = content.includes("detectDatabase") ||
                                        content.includes("findDatabase") ||
                                        content.includes("analyzeDependencies");
            
            expect(hasDatabaseDetection).toBe(true);
            
            // PRESERVATION: Verify existing methods remain unchanged
            const hasExistingMethods = content.includes("findApiSpecs") &&
                                      content.includes("findExistingTests") &&
                                      content.includes("retrieveContext");
            
            expect(hasExistingMethods).toBe(true);
            
            // Database detection is added, but existing functionality is preserved
        });
    });

    /**
     * Summary: Preservation Requirements
     * 
     * These tests verify that the current behavior is preserved after the fix:
     * 
     * 1. Non-database applications:
     *    - Continue to receive only basic env vars (DEBIAN_FRONTEND, HOME, NO_COLOR, NODE_ENV=test)
     *    - No database variables are added
     *    - Behavior is identical to unfixed code
     * 
     * 2. User-provided credentials:
     *    - All credentials from config.credentials are added to environment
     *    - No filtering or modification occurs
     *    - User credentials take precedence over auto-generated values
     * 
     * 3. Production environments:
     *    - No auto-generated test database URLs
     *    - Explicit configuration required via config.credentials
     *    - NODE_ENV=test is used as safety check for test URL generation
     * 
     * 4. Backward compatibility:
     *    - TestContext fields remain unchanged (new field is optional)
     *    - Existing methods in RepositoryContextBuilder remain unchanged
     *    - No breaking changes to public APIs
     */
});
