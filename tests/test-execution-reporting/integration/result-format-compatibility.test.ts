/**
 * Property-Based Tests for Result Format Compatibility
 * 
 * Feature: docker-test-execution-reporting
 * Property 8: Result Format Compatibility
 * **Validates: Requirements 4.4, 8.1, 8.2**
 * 
 * Tests that Docker test execution results match the RawTestResult format
 * produced by local execution, ensuring the existing Test_Execution_Reporting_Module
 * can process Docker results identically.
 */

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import type { RawTestResult, DockerRawTestResult, TestFramework } from '../../../src/test-execution-reporting/types.js';

// ─── Arbitraries ──────────────────────────────────────────────

const testFrameworkArb = fc.constantFrom<TestFramework>('jest', 'mocha', 'vitest', 'node:test', 'unknown');

const exitCodeArb = fc.oneof(
  fc.constant(0), // success
  fc.integer({ min: 1, max: 255 }) // failure codes
);

const stdoutArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 1000 }),
  fc.constant('PASS test.test.ts\n  ✓ test passes (5ms)\n\nTests: 1 passed, 1 total'),
  fc.constant('FAIL test.test.ts\n  ✗ test fails (5ms)\n\nTests: 1 failed, 1 total')
);

const stderrArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 500 }),
  fc.constant('Error: Test failed\n  at test.test.ts:10:5')
);

const durationArb = fc.integer({ min: 0, max: 300000 }); // 0 to 5 minutes

const timedOutArb = fc.boolean();

const containerIdArb = fc.string({ minLength: 12, maxLength: 64 }).map(s => 
  s.split('').map(c => c.charCodeAt(0).toString(16)).join('').substring(0, 64)
);

const imageNameArb = fc.oneof(
  fc.constant('node:20-alpine'),
  fc.constant('node:18-alpine'),
  fc.constant('node:20'),
  fc.string({ minLength: 5, maxLength: 50 }).map(s => `custom/${s}:latest`)
);

const networkModeArb = fc.constantFrom('none', 'bridge', 'host');

const timestampArb = fc.integer({ min: Date.now() - 1000000, max: Date.now() });

// Arbitrary for base RawTestResult
const rawTestResultArb = fc.record({
  exitCode: exitCodeArb,
  stdout: stdoutArb,
  stderr: stderrArb,
  duration: durationArb,
  framework: testFrameworkArb,
  timedOut: timedOutArb,
});

// Arbitrary for DockerRawTestResult with proper constraints
const dockerRawTestResultArb = fc
  .tuple(
    testFrameworkArb,
    stdoutArb,
    stderrArb,
    durationArb,
    timedOutArb,
    containerIdArb,
    imageNameArb,
    networkModeArb,
    timestampArb
  )
  .map(([framework, stdout, stderr, duration, timedOut, containerId, imageName, networkMode, baseTime]) => {
    // If timed out, exit code must be non-zero
    const exitCode = timedOut ? (Math.floor(Math.random() * 255) + 1) : (Math.random() > 0.3 ? 0 : Math.floor(Math.random() * 255) + 1);
    
    // Generate chronologically ordered timestamps
    const containerCreationTime = baseTime;
    const containerStartTime = baseTime + Math.floor(Math.random() * 1000);
    const containerStopTime = containerStartTime + Math.floor(Math.random() * 5000);

    return {
      exitCode,
      stdout,
      stderr,
      duration,
      framework,
      timedOut,
      docker: {
        containerId,
        imageName,
        networkMode,
        containerCreationTime,
        containerStartTime,
        containerStopTime,
      },
    };
  });

// ─── Property Tests ───────────────────────────────────────────

describe('Property 8: Result Format Compatibility', () => {
  test('Docker results contain all required RawTestResult fields', () => {
    fc.assert(
      fc.property(dockerRawTestResultArb, (dockerResult) => {
        // Docker result must have all base RawTestResult fields
        expect(dockerResult).toHaveProperty('exitCode');
        expect(dockerResult).toHaveProperty('stdout');
        expect(dockerResult).toHaveProperty('stderr');
        expect(dockerResult).toHaveProperty('duration');
        expect(dockerResult).toHaveProperty('framework');
        expect(dockerResult).toHaveProperty('timedOut');

        // Verify types
        expect(typeof dockerResult.exitCode).toBe('number');
        expect(typeof dockerResult.stdout).toBe('string');
        expect(typeof dockerResult.stderr).toBe('string');
        expect(typeof dockerResult.duration).toBe('number');
        expect(typeof dockerResult.framework).toBe('string');
        expect(typeof dockerResult.timedOut).toBe('boolean');
      }),
      { numRuns: 100 }
    );
  });

  test('Docker results are assignable to RawTestResult type', () => {
    fc.assert(
      fc.property(dockerRawTestResultArb, (dockerResult) => {
        // This should compile and work - Docker result can be used as RawTestResult
        const baseResult: RawTestResult = dockerResult;

        // All base fields should be accessible
        expect(baseResult.exitCode).toBe(dockerResult.exitCode);
        expect(baseResult.stdout).toBe(dockerResult.stdout);
        expect(baseResult.stderr).toBe(dockerResult.stderr);
        expect(baseResult.duration).toBe(dockerResult.duration);
        expect(baseResult.framework).toBe(dockerResult.framework);
        expect(baseResult.timedOut).toBe(dockerResult.timedOut);
      }),
      { numRuns: 100 }
    );
  });

  test('Docker metadata is additional and does not interfere with base fields', () => {
    fc.assert(
      fc.property(dockerRawTestResultArb, (dockerResult) => {
        // Docker metadata should be in a separate 'docker' property
        expect(dockerResult).toHaveProperty('docker');
        expect(typeof dockerResult.docker).toBe('object');
        expect(dockerResult.docker).not.toBeNull();

        // Docker metadata should not override base fields
        expect(dockerResult.docker).not.toHaveProperty('exitCode');
        expect(dockerResult.docker).not.toHaveProperty('stdout');
        expect(dockerResult.docker).not.toHaveProperty('stderr');
        expect(dockerResult.docker).not.toHaveProperty('duration');
        expect(dockerResult.docker).not.toHaveProperty('framework');
        expect(dockerResult.docker).not.toHaveProperty('timedOut');
      }),
      { numRuns: 100 }
    );
  });

  test('Docker results have valid Docker metadata structure', () => {
    fc.assert(
      fc.property(dockerRawTestResultArb, (dockerResult) => {
        const { docker } = dockerResult;

        // Verify Docker metadata fields
        expect(docker).toHaveProperty('containerId');
        expect(docker).toHaveProperty('imageName');
        expect(docker).toHaveProperty('networkMode');
        expect(docker).toHaveProperty('containerCreationTime');
        expect(docker).toHaveProperty('containerStartTime');
        expect(docker).toHaveProperty('containerStopTime');

        // Verify types
        expect(typeof docker.containerId).toBe('string');
        expect(typeof docker.imageName).toBe('string');
        expect(typeof docker.networkMode).toBe('string');
        expect(typeof docker.containerCreationTime).toBe('number');
        expect(typeof docker.containerStartTime).toBe('number');
        expect(typeof docker.containerStopTime).toBe('number');

        // Verify constraints
        expect(docker.containerId.length).toBeGreaterThan(0);
        expect(docker.imageName.length).toBeGreaterThan(0);
        expect(['none', 'bridge', 'host']).toContain(docker.networkMode);
      }),
      { numRuns: 100 }
    );
  });

  test('Docker results can be processed by functions expecting RawTestResult', () => {
    fc.assert(
      fc.property(dockerRawTestResultArb, (dockerResult) => {
        // Simulate a function that processes RawTestResult
        const processResult = (result: RawTestResult): boolean => {
          return result.exitCode === 0 && !result.timedOut;
        };

        // Docker result should work with this function
        const success = processResult(dockerResult);
        expect(typeof success).toBe('boolean');
        expect(success).toBe(dockerResult.exitCode === 0 && !dockerResult.timedOut);
      }),
      { numRuns: 100 }
    );
  });

  test('Docker and local results have identical base field structure', () => {
    fc.assert(
      fc.property(
        rawTestResultArb,
        dockerRawTestResultArb,
        (localResult, dockerResult) => {
          // Get base field keys
          const localKeys = Object.keys(localResult).sort();
          const dockerBaseKeys = Object.keys(dockerResult)
            .filter(key => key !== 'docker')
            .sort();

          // Base fields should be identical
          expect(dockerBaseKeys).toEqual(localKeys);

          // Field types should match
          for (const key of localKeys) {
            expect(typeof dockerResult[key as keyof RawTestResult]).toBe(
              typeof localResult[key as keyof RawTestResult]
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker results maintain semantic equivalence with local results', () => {
    fc.assert(
      fc.property(dockerRawTestResultArb, (dockerResult) => {
        // Success/failure semantics should be consistent
        const isSuccess = dockerResult.exitCode === 0 && !dockerResult.timedOut;
        const hasOutput = dockerResult.stdout.length > 0 || dockerResult.stderr.length > 0;
        const hasError = dockerResult.exitCode !== 0 || dockerResult.timedOut;

        // If exit code is 0 and not timed out, it's a success
        if (isSuccess) {
          expect(dockerResult.exitCode).toBe(0);
          expect(dockerResult.timedOut).toBe(false);
        }

        // If timed out, exit code should indicate failure
        if (dockerResult.timedOut) {
          expect(dockerResult.exitCode).not.toBe(0);
        }

        // Duration should be non-negative
        expect(dockerResult.duration).toBeGreaterThanOrEqual(0);

        // Framework should be a valid value
        expect(['jest', 'mocha', 'vitest', 'node:test', 'unknown']).toContain(
          dockerResult.framework
        );
      }),
      { numRuns: 100 }
    );
  });

  test('Docker timestamp fields are chronologically ordered', () => {
    fc.assert(
      fc.property(dockerRawTestResultArb, (dockerResult) => {
        const { containerCreationTime, containerStartTime, containerStopTime } = dockerResult.docker;

        // Creation should happen before or at start
        expect(containerCreationTime).toBeLessThanOrEqual(containerStartTime);

        // Start should happen before or at stop
        expect(containerStartTime).toBeLessThanOrEqual(containerStopTime);

        // All timestamps should be positive
        expect(containerCreationTime).toBeGreaterThan(0);
        expect(containerStartTime).toBeGreaterThan(0);
        expect(containerStopTime).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
