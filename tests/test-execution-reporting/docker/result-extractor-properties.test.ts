/**
 * Property-based tests for ResultExtractor
 * 
 * Feature: docker-test-execution-reporting
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Docker from 'dockerode';
import { DefaultResultExtractor } from '../../../src/test-execution-reporting/docker/result-extractor.js';
import { DefaultContainerManager } from '../../../src/test-execution-reporting/docker/container-manager.js';
import type { ContainerConfig } from '../../../src/test-execution-reporting/docker/types.js';
import type { TestFramework } from '../../../src/test-execution-reporting/types.js';

describe('ResultExtractor Properties', () => {
  const docker = new Docker();
  let createdContainers: string[] = [];

  beforeEach(() => {
    createdContainers = [];
  });

  afterEach(async () => {
    // Cleanup any containers that weren't cleaned up during tests
    for (const containerId of createdContainers) {
      try {
        const container = docker.getContainer(containerId);
        await container.stop().catch(() => {});
        await container.remove({ force: true }).catch(() => {});
      } catch {
        // Container already removed, ignore
      }
    }
    createdContainers = [];
  });

  /**
   * Property 7: Complete Result Extraction
   * 
   * **Validates: Requirements 4.1, 4.2, 4.3**
   * 
   * For any completed container, the Result_Extractor should capture stdout, stderr, 
   * exit code, and calculate execution duration, producing a complete RawTestResult.
   */
  describe('Property 7: Complete Result Extraction', () => {
    it('should extract complete results from successful execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            output: fc.string({ minLength: 1, maxLength: 100 })
              .filter(s => {
                // Filter out problematic shell characters
                const hasProblematicChars = /["'`\\$]/.test(s);
                return !hasProblematicChars && s.trim().length > 0;
              }),
            framework: fc.constantFrom('jest', 'mocha', 'vitest', 'node:test') as fc.Arbitrary<TestFramework>,
          }),
          async (testCase) => {
            const manager = new DefaultContainerManager(docker);
            const extractor = new DefaultResultExtractor(docker);
            
            const config: ContainerConfig = {
              imageName: 'alpine:latest',
              command: ['sh', '-c', `echo "${testCase.output}"`],
              workingDir: '/workspace',
              mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
              networkMode: 'none',
            };

            const startTime = Date.now();
            const containerId = await manager.createContainer(config);
            createdContainers.push(containerId);
            
            await manager.startContainer(containerId);
            await manager.waitForContainer(containerId, 10000);

            const result = await extractor.extractResults(containerId, startTime, testCase.framework);

            // Verify all required fields are present
            expect(result.stdout).toBeDefined();
            expect(result.stderr).toBeDefined();
            expect(result.exitCode).toBe(0);
            expect(result.duration).toBeGreaterThanOrEqual(0);
            expect(result.framework).toBe(testCase.framework);
            expect(result.timestamp).toBe(startTime);

            // Verify Docker metadata
            expect(result.docker).toBeDefined();
            expect(result.docker.containerId).toBe(containerId);
            expect(result.docker.imageName).toBe('alpine:latest');
            expect(result.docker.networkMode).toBe('none');
            expect(result.docker.containerCreationTime).toBeGreaterThan(0);
            expect(result.docker.containerStartTime).toBeGreaterThan(0);
            expect(result.docker.containerStopTime).toBeGreaterThan(0);

            // Verify timestamps are in correct order
            expect(result.docker.containerStartTime).toBeGreaterThanOrEqual(result.docker.containerCreationTime);
            expect(result.docker.containerStopTime).toBeGreaterThanOrEqual(result.docker.containerStartTime);

            // Verify stdout contains the output
            expect(result.stdout).toContain(testCase.output);

            // Cleanup
            await manager.cleanup(containerId);
            createdContainers = createdContainers.filter(id => id !== containerId);
          }
        ),
        { numRuns: 2 }
      );
    }, 30000);

    it('should extract complete results from failed execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            exitCode: fc.constantFrom(1, 2, 127),
            framework: fc.constantFrom('jest', 'mocha', 'vitest', 'node:test') as fc.Arbitrary<TestFramework>,
          }),
          async (testCase) => {
            const manager = new DefaultContainerManager(docker);
            const extractor = new DefaultResultExtractor(docker);
            
            const config: ContainerConfig = {
              imageName: 'alpine:latest',
              command: ['sh', '-c', `exit ${testCase.exitCode}`],
              workingDir: '/workspace',
              mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
              networkMode: 'none',
            };

            const startTime = Date.now();
            const containerId = await manager.createContainer(config);
            createdContainers.push(containerId);
            
            await manager.startContainer(containerId);
            const actualExitCode = await manager.waitForContainer(containerId, 10000);
            expect(actualExitCode).toBe(testCase.exitCode);

            const result = await extractor.extractResults(containerId, startTime, testCase.framework);

            // Verify all required fields are present
            expect(result.stdout).toBeDefined();
            expect(result.stderr).toBeDefined();
            expect(result.exitCode).toBe(testCase.exitCode);
            expect(result.duration).toBeGreaterThanOrEqual(0);
            expect(result.framework).toBe(testCase.framework);

            // Verify Docker metadata
            expect(result.docker).toBeDefined();
            expect(result.docker.containerId).toBe(containerId);

            // Cleanup
            await manager.cleanup(containerId);
            createdContainers = createdContainers.filter(id => id !== containerId);
          }
        ),
        { numRuns: 2 }
      );
    }, 30000);
  });

  /**
   * Property 9: Error Output Capture
   * 
   * **Validates: Requirements 5.4**
   * 
   * For any test execution that fails with a non-zero exit code, the Result_Extractor 
   * should capture all error output from stderr for inclusion in the test report.
   */
  describe('Property 9: Error Output Capture', () => {
    it('should capture stderr output from failed executions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            errorMessage: fc.string({ minLength: 1, maxLength: 100 })
              .filter(s => {
                // Filter out problematic shell characters
                const hasProblematicChars = /["'`\\$]/.test(s);
                return !hasProblematicChars && s.trim().length > 0;
              }),
            exitCode: fc.constantFrom(1, 2),
          }),
          async (testCase) => {
            const manager = new DefaultContainerManager(docker);
            const extractor = new DefaultResultExtractor(docker);
            
            // Use a command that writes to stderr and exits with non-zero code
            const config: ContainerConfig = {
              imageName: 'alpine:latest',
              command: ['sh', '-c', `echo "${testCase.errorMessage}" >&2 && exit ${testCase.exitCode}`],
              workingDir: '/workspace',
              mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
              networkMode: 'none',
            };

            const startTime = Date.now();
            const containerId = await manager.createContainer(config);
            createdContainers.push(containerId);
            
            await manager.startContainer(containerId);
            const actualExitCode = await manager.waitForContainer(containerId, 10000);
            expect(actualExitCode).toBe(testCase.exitCode);

            const result = await extractor.extractResults(containerId, startTime, 'jest');

            // Verify exit code is non-zero
            expect(result.exitCode).toBe(testCase.exitCode);
            expect(result.exitCode).not.toBe(0);

            // Verify stderr contains the error message
            expect(result.stderr).toContain(testCase.errorMessage);

            // Cleanup
            await manager.cleanup(containerId);
            createdContainers = createdContainers.filter(id => id !== containerId);
          }
        ),
        { numRuns: 2 }
      );
    }, 30000);

    it('should capture both stdout and stderr when both are present', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            stdoutMessage: fc.string({ minLength: 1, maxLength: 50 })
              .filter(s => {
                // Filter out problematic shell characters
                const hasProblematicChars = /["'`\\$]/.test(s);
                return !hasProblematicChars && s.trim().length > 0;
              }),
            stderrMessage: fc.string({ minLength: 1, maxLength: 50 })
              .filter(s => {
                // Filter out problematic shell characters
                const hasProblematicChars = /["'`\\$]/.test(s);
                return !hasProblematicChars && s.trim().length > 0;
              }),
          }),
          async (testCase) => {
            const manager = new DefaultContainerManager(docker);
            const extractor = new DefaultResultExtractor(docker);
            
            // Command that writes to both stdout and stderr
            const config: ContainerConfig = {
              imageName: 'alpine:latest',
              command: ['sh', '-c', `echo "${testCase.stdoutMessage}" && echo "${testCase.stderrMessage}" >&2 && exit 1`],
              workingDir: '/workspace',
              mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
              networkMode: 'none',
            };

            const startTime = Date.now();
            const containerId = await manager.createContainer(config);
            createdContainers.push(containerId);
            
            await manager.startContainer(containerId);
            await manager.waitForContainer(containerId, 10000);

            const result = await extractor.extractResults(containerId, startTime, 'jest');

            // Verify both stdout and stderr are captured
            expect(result.stdout).toContain(testCase.stdoutMessage);
            expect(result.stderr).toContain(testCase.stderrMessage);
            expect(result.exitCode).toBe(1);

            // Cleanup
            await manager.cleanup(containerId);
            createdContainers = createdContainers.filter(id => id !== containerId);
          }
        ),
        { numRuns: 2 }
      );
    }, 30000);
  });
});
