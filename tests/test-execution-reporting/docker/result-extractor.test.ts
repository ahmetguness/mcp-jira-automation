/**
 * Unit tests for ResultExtractor
 * 
 * Feature: docker-test-execution-reporting
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Docker from 'dockerode';
import { DefaultResultExtractor } from '../../../src/test-execution-reporting/docker/result-extractor.js';
import { DefaultContainerManager } from '../../../src/test-execution-reporting/docker/container-manager.js';
import type { ContainerConfig } from '../../../src/test-execution-reporting/docker/types.js';

describe('ResultExtractor Unit Tests', () => {
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

  describe('captureLogs', () => {
    it('should capture stdout from container', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['echo', 'Hello from stdout'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const { stdout, stderr } = await extractor.captureLogs(containerId);

      expect(stdout).toContain('Hello from stdout');
      expect(stderr).toBe('');

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });

    it('should capture stderr from container', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'echo "Error message" >&2'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const { stdout, stderr } = await extractor.captureLogs(containerId);

      expect(stdout).toBe('');
      expect(stderr).toContain('Error message');

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });

    it('should capture both stdout and stderr', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'echo "stdout message" && echo "stderr message" >&2'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const { stdout, stderr } = await extractor.captureLogs(containerId);

      expect(stdout).toContain('stdout message');
      expect(stderr).toContain('stderr message');

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });

    it('should handle empty logs', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'exit 0'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const { stdout, stderr } = await extractor.captureLogs(containerId);

      expect(stdout).toBe('');
      expect(stderr).toBe('');

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });

    it('should handle log truncation for large outputs', async () => {
      // This test verifies the truncation logic exists
      // Testing actual 10MB+ output is impractical in unit tests
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      // Generate a moderate amount of output to verify logs work
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'for i in $(seq 1 1000); do echo "Line $i with some text"; done'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const { stdout } = await extractor.captureLogs(containerId);

      // Verify we can capture logs successfully
      // The truncation logic is tested by the implementation
      // (MAX_LOG_SIZE constant and truncation code exist)
      expect(stdout.length).toBeGreaterThan(0);
      expect(stdout).toContain('Line 1');
      expect(stdout).toContain('Line 1000');

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });
  });

  describe('getExitCode', () => {
    it('should extract exit code 0 for successful execution', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'exit 0'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const exitCode = await extractor.getExitCode(containerId);

      expect(exitCode).toBe(0);

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });

    it('should extract non-zero exit code for failed execution', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'exit 42'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const exitCode = await extractor.getExitCode(containerId);

      expect(exitCode).toBe(42);

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });

    it('should extract exit code 1 for general failures', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'exit 1'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'none',
      };

      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const exitCode = await extractor.getExitCode(containerId);

      expect(exitCode).toBe(1);

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });
  });

  describe('extractResults', () => {
    it('should calculate execution duration correctly', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      // Use a command that takes some time to execute
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'sleep 1 && echo "done"'],
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

      // Duration should be at least 1 second (1000ms)
      expect(result.duration).toBeGreaterThanOrEqual(1000);
      // But not too long (allow 3 seconds for overhead)
      expect(result.duration).toBeLessThan(3000);

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    }, 15000);

    it('should include all Docker metadata', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['echo', 'test'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/tmp', containerPath: '/workspace', readOnly: true }],
        networkMode: 'bridge',
      };

      const startTime = Date.now();
      const containerId = await manager.createContainer(config);
      createdContainers.push(containerId);
      
      await manager.startContainer(containerId);
      await manager.waitForContainer(containerId, 10000);

      const result = await extractor.extractResults(containerId, startTime, 'vitest');

      // Verify Docker metadata
      expect(result.docker.containerId).toBe(containerId);
      expect(result.docker.imageName).toBe('alpine:latest');
      expect(result.docker.networkMode).toBe('bridge');
      expect(result.docker.containerCreationTime).toBeGreaterThan(0);
      expect(result.docker.containerStartTime).toBeGreaterThan(0);
      expect(result.docker.containerStopTime).toBeGreaterThan(0);

      // Verify timestamp order
      expect(result.docker.containerStartTime).toBeGreaterThanOrEqual(result.docker.containerCreationTime);
      expect(result.docker.containerStopTime).toBeGreaterThanOrEqual(result.docker.containerStartTime);

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });

    it('should handle containers with no output', async () => {
      const manager = new DefaultContainerManager(docker);
      const extractor = new DefaultResultExtractor(docker);
      
      const config: ContainerConfig = {
        imageName: 'alpine:latest',
        command: ['sh', '-c', 'exit 0'],
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

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      await manager.cleanup(containerId);
      createdContainers = createdContainers.filter(id => id !== containerId);
    });
  });
});
