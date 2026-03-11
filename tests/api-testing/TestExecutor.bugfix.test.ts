/**
 * Bug Condition Exploration Test for Docker ENV Config Validation Fix
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3**
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * 
 * This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * GOAL: Surface counterexamples that demonstrate the bug exists
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TestExecutor } from '../../src/api-testing/test-executor/TestExecutor.js';
import type { ExecutionConfig } from '../../src/api-testing/models/types.js';
import { Environment } from '../../src/api-testing/models/enums.js';

// Type for accessing private methods in tests
interface TestExecutorWithPrivate {
  buildEnvironmentVariables: (config: ExecutionConfig) => string[];
}

describe('Bug Condition Exploration: NODE_ENV Missing in Docker Test Execution', () => {
  /**
   * Property 1: Bug Condition - NODE_ENV Missing in Docker Test Execution
   * 
   * This property tests that buildEnvironmentVariables includes NODE_ENV="test"
   * in the environment variable array for Docker test execution.
   * 
   * EXPECTED OUTCOME ON UNFIXED CODE: This test FAILS because NODE_ENV is not included
   * This failure confirms the bug exists and demonstrates the counterexample.
   */
  describe('Property 1: buildEnvironmentVariables includes NODE_ENV', () => {
    it('should include NODE_ENV=test in environment variables for Docker test execution', () => {
      // Create a minimal ExecutionConfig with credentials
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          API_KEY: 'test-key-123',
          API_SECRET: 'test-secret-456',
        },
      };

      // Access the private buildEnvironmentVariables method via reflection
      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // CRITICAL ASSERTION: This will FAIL on unfixed code
      // The failure demonstrates the bug - NODE_ENV is missing
      expect(envVars).toContain('NODE_ENV=test');

      // Additional verification: NODE_ENV should be present before credentials
      const nodeEnvIndex = envVars.indexOf('NODE_ENV=test');
      const firstCredentialIndex = envVars.findIndex(v => v.startsWith('API_KEY=') || v.startsWith('API_SECRET='));
      
      expect(nodeEnvIndex).toBeGreaterThanOrEqual(0);
      expect(nodeEnvIndex).toBeLessThan(firstCredentialIndex);
    });

    it('should verify NODE_ENV is NOW in implementation (confirms fix)', () => {
      // This test confirms the fix has been applied
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // Confirm fixed behavior: NODE_ENV is present
      const hasNodeEnv = envVars.some(v => v.startsWith('NODE_ENV='));
      
      // This assertion confirms the fix works
      expect(hasNodeEnv).toBe(true); // FIXED: NODE_ENV is now included
    });
  });

  /**
   * Property-Based Test: NODE_ENV included for all credential combinations
   * 
   * Tests that NODE_ENV="test" is included regardless of what credentials are provided.
   * This uses property-based testing to generate many different credential combinations.
   */
  describe('Property-Based: NODE_ENV with various credentials', () => {
    it('should include NODE_ENV for any credential configuration', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary credential objects
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Z_][A-Z0-9_]*$/.test(s)),
            fc.string({ minLength: 1, maxLength: 50 })
          ),
          (credentials) => {
            const config: ExecutionConfig = {
              environment: Environment.STAGING,
              timeoutSeconds: 300,
              retryCount: 3,
              retryBackoffSeconds: [1, 2, 4],
              allowDestructiveOps: false,
              credentials,
            };

            const executor = new TestExecutor();
            const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
            const envVars: string[] = buildEnvVars(config);

            // CRITICAL: This will fail on unfixed code for all generated inputs
            // Each failure is a counterexample demonstrating the bug
            return envVars.includes('NODE_ENV=test');
          }
        ),
        { numRuns: 100 } // Run 100 test cases with different credential combinations
      );
    });
  });

  /**
   * Test: Base environment variables are preserved
   * 
   * Verifies that existing environment variables (DEBIAN_FRONTEND, HOME, NO_COLOR, FORCE_COLOR)
   * are still present. This ensures we understand the current structure before the fix.
   */
  describe('Current behavior: Base environment variables', () => {
    it('should include base environment variables', () => {
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // Verify base environment variables are present
      expect(envVars).toContain('DEBIAN_FRONTEND=noninteractive');
      expect(envVars).toContain('HOME=/root');
      expect(envVars).toContain('NO_COLOR=1');
      expect(envVars).toContain('FORCE_COLOR=0');
    });

    it('should append credentials after base environment variables', () => {
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          TEST_KEY: 'value1',
          TEST_SECRET: 'value2',
        },
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // Verify credentials are appended
      expect(envVars).toContain('TEST_KEY=value1');
      expect(envVars).toContain('TEST_SECRET=value2');

      // Verify order: base vars come before credentials
      const forceColorIndex = envVars.indexOf('FORCE_COLOR=0');
      const testKeyIndex = envVars.indexOf('TEST_KEY=value1');
      expect(forceColorIndex).toBeLessThan(testKeyIndex);
    });
  });
});

/**
 * Preservation Property Tests
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 * 
 * IMPORTANT: These tests verify that existing behavior is preserved after the fix.
 * They should PASS on UNFIXED code to establish the baseline behavior.
 * After the fix, they should STILL PASS to confirm no regressions.
 * 
 * Property 2: Preservation - Non-Test Execution Behavior
 */
describe('Preservation Property Tests: Existing Behavior Must Be Preserved', () => {
  /**
   * Property: For all ExecutionConfig with credentials, buildEnvironmentVariables 
   * includes all credential key-value pairs
   * 
   * **Validates: Requirement 3.2, 3.4**
   */
  describe('Property: Credentials are passed to Docker containers', () => {
    it('should include all credentials from ExecutionConfig', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary credential objects with valid environment variable names
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Z_][A-Z0-9_]*$/.test(s)),
            fc.string({ minLength: 1, maxLength: 50 })
          ).filter(creds => Object.keys(creds).length > 0), // Ensure at least one credential
          (credentials) => {
            const config: ExecutionConfig = {
              environment: Environment.STAGING,
              timeoutSeconds: 300,
              retryCount: 3,
              retryBackoffSeconds: [1, 2, 4],
              allowDestructiveOps: false,
              credentials,
            };

            const executor = new TestExecutor();
            const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
            const envVars: string[] = buildEnvVars(config);

            // Verify all credentials are included in the environment variables
            for (const [key, value] of Object.entries(credentials)) {
              const expectedEnvVar = `${key}=${value}`;
              if (!envVars.includes(expectedEnvVar)) {
                return false;
              }
            }
            return true;
          }
        ),
        { numRuns: 100 } // Run 100 test cases with different credential combinations
      );
    });

    it('should preserve credentials with special characters', () => {
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          API_KEY: 'key-with-dashes-123',
          API_SECRET: 'secret!@#$%^&*()',
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        },
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // Verify credentials with special characters are preserved exactly
      expect(envVars).toContain('API_KEY=key-with-dashes-123');
      expect(envVars).toContain('API_SECRET=secret!@#$%^&*()');
      expect(envVars).toContain('DATABASE_URL=postgresql://user:pass@localhost:5432/db');
    });
  });

  /**
   * Property: For all ExecutionConfig, buildEnvironmentVariables includes 
   * DEBIAN_FRONTEND, HOME, NO_COLOR, FORCE_COLOR
   * 
   * **Validates: Requirement 3.3**
   */
  describe('Property: Base environment variables are always included', () => {
    it('should include all base environment variables for any ExecutionConfig', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary credentials
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Z_][A-Z0-9_]*$/.test(s)),
            fc.string({ minLength: 1, maxLength: 50 })
          ),
          // Generate arbitrary timeout
          fc.integer({ min: 1, max: 3600 }),
          (credentials, timeoutSeconds) => {
            const config: ExecutionConfig = {
              environment: Environment.STAGING,
              timeoutSeconds,
              retryCount: 3,
              retryBackoffSeconds: [1, 2, 4],
              allowDestructiveOps: false,
              credentials,
            };

            const executor = new TestExecutor();
            const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
            const envVars: string[] = buildEnvVars(config);

            // Verify all base environment variables are present
            return (
              envVars.includes('DEBIAN_FRONTEND=noninteractive') &&
              envVars.includes('HOME=/root') &&
              envVars.includes('NO_COLOR=1') &&
              envVars.includes('FORCE_COLOR=0')
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include base environment variables even with empty credentials', () => {
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // Verify base environment variables are present
      expect(envVars).toContain('DEBIAN_FRONTEND=noninteractive');
      expect(envVars).toContain('HOME=/root');
      expect(envVars).toContain('NO_COLOR=1');
      expect(envVars).toContain('FORCE_COLOR=0');
      
      // Verify only base variables are present (no credentials)
      expect(envVars.length).toBe(5); // 4 base + NODE_ENV
    });
  });

  /**
   * Property: Environment variable order is preserved (base vars, then credentials)
   * 
   * **Validates: Requirement 3.3, 3.4**
   */
  describe('Property: Environment variable order is preserved', () => {
    it('should maintain order: base variables before credentials', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary credentials
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[A-Z_][A-Z0-9_]*$/.test(s)),
            fc.string({ minLength: 1, maxLength: 50 })
          ).filter(creds => Object.keys(creds).length > 0),
          (credentials) => {
            const config: ExecutionConfig = {
              environment: Environment.STAGING,
              timeoutSeconds: 300,
              retryCount: 3,
              retryBackoffSeconds: [1, 2, 4],
              allowDestructiveOps: false,
              credentials,
            };

            const executor = new TestExecutor();
            const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
            const envVars: string[] = buildEnvVars(config);

            // Find indices of base variables
            const debianIndex = envVars.indexOf('DEBIAN_FRONTEND=noninteractive');
            const homeIndex = envVars.indexOf('HOME=/root');
            const noColorIndex = envVars.indexOf('NO_COLOR=1');
            const forceColorIndex = envVars.indexOf('FORCE_COLOR=0');

            // Find index of first credential
            const firstCredentialIndex = envVars.findIndex(v => {
              const parts = v.split('=');
              const key = parts[0];
              return key !== undefined && key in credentials;
            });

            // Verify base variables come before credentials
            if (firstCredentialIndex === -1) {
              return false; // Should have found at least one credential
            }

            return (
              debianIndex < firstCredentialIndex &&
              homeIndex < firstCredentialIndex &&
              noColorIndex < firstCredentialIndex &&
              forceColorIndex < firstCredentialIndex
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain specific order of base variables', () => {
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          TEST_KEY: 'value',
        },
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // Verify the specific order of base variables
      expect(envVars[0]).toBe('DEBIAN_FRONTEND=noninteractive');
      expect(envVars[1]).toBe('HOME=/root');
      expect(envVars[2]).toBe('NO_COLOR=1');
      expect(envVars[3]).toBe('FORCE_COLOR=0');
      expect(envVars[4]).toBe('NODE_ENV=test');
      
      // Credentials should come after
      expect(envVars[5]).toBe('TEST_KEY=value');
    });
  });

  /**
   * Property: Multiple credentials are all included
   * 
   * **Validates: Requirement 3.2, 3.4**
   */
  describe('Property: All credentials are included regardless of count', () => {
    it('should include single credential', () => {
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          API_KEY: 'single-key',
        },
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      expect(envVars).toContain('API_KEY=single-key');
      expect(envVars.length).toBe(6); // 4 base + NODE_ENV + 1 credential
    });

    it('should include many credentials', () => {
      const config: ExecutionConfig = {
        environment: Environment.STAGING,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          API_KEY: 'key1',
          API_SECRET: 'secret1',
          DATABASE_URL: 'db-url',
          REDIS_URL: 'redis-url',
          AWS_ACCESS_KEY: 'aws-key',
          AWS_SECRET_KEY: 'aws-secret',
        },
      };

      const executor = new TestExecutor();
      const buildEnvVars = (executor as unknown as TestExecutorWithPrivate).buildEnvironmentVariables.bind(executor);
      const envVars: string[] = buildEnvVars(config);

      // Verify all credentials are included
      expect(envVars).toContain('API_KEY=key1');
      expect(envVars).toContain('API_SECRET=secret1');
      expect(envVars).toContain('DATABASE_URL=db-url');
      expect(envVars).toContain('REDIS_URL=redis-url');
      expect(envVars).toContain('AWS_ACCESS_KEY=aws-key');
      expect(envVars).toContain('AWS_SECRET_KEY=aws-secret');
      
      expect(envVars.length).toBe(11); // 4 base + NODE_ENV + 6 credentials
    });
  });
});


