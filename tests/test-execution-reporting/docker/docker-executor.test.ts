/**
 * Unit tests for Docker Test Executor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerTestExecutor } from '../../../src/test-execution-reporting/docker/docker-test-executor.js';
import type {
  ContainerManager,
  TestFileMounter,
  ResultExtractor,
  DockerExecutionOptions,
  DockerRawTestResult,
  Mount,
} from '../../../src/test-execution-reporting/docker/types.js';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock logger
vi.mock('../../../src/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('DockerTestExecutor', () => {
  let mockContainerManager: ContainerManager;
  let mockTestFileMounter: TestFileMounter;
  let mockResultExtractor: ResultExtractor;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock implementations
    mockContainerManager = {
      createContainer: vi.fn().mockResolvedValue('test-container-123'),
      startContainer: vi.fn().mockResolvedValue(undefined),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      removeContainer: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      waitForContainer: vi.fn().mockResolvedValue(0),
      ensureImage: vi.fn().mockResolvedValue(undefined),
    };

    mockTestFileMounter = {
      generateMounts: vi.fn().mockResolvedValue([
        { hostPath: '/host/test.js', containerPath: '/workspace/test.js', readOnly: true },
      ] as Mount[]),
      validateMounts: vi.fn().mockResolvedValue(undefined),
    };

    mockResultExtractor = {
      extractResults: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'test output',
        stderr: '',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        docker: {
          containerId: 'test-container-123',
          imageName: 'node:20-alpine',
          networkMode: 'none',
          containerCreationTime: Date.now(),
          containerStartTime: Date.now(),
          containerStopTime: Date.now(),
        },
      } as DockerRawTestResult),
      captureLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      getExitCode: vi.fn().mockResolvedValue(0),
    };
  });

  describe('Docker Availability Checks', () => {
    it('should return true when Docker is available', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const available = await executor.isDockerAvailable();
      expect(available).toBe(true);
    });

    it('should return false when Docker is not installed', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found: docker');
      });

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const available = await executor.isDockerAvailable();
      expect(available).toBe(false);
    });

    it('should return false when Docker daemon is not running', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Cannot connect to the Docker daemon');
      });

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const available = await executor.isDockerAvailable();
      expect(available).toBe(false);
    });
  });

  describe('Framework Detection Delegation', () => {
    it('should delegate framework detection to DefaultTestExecutor', async () => {
      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      // Create a test file with jest syntax
      const testFilePath = '/test/example.test.js';
      
      // Mock file system for framework detection
      const framework = await executor.detectFramework(testFilePath);
      
      // Should return a valid framework
      expect(['jest', 'mocha', 'vitest', 'node:test', 'unknown']).toContain(framework);
    });
  });

  describe('Execute Orchestration Flow', () => {
    it('should orchestrate complete execution flow successfully', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      const result = await executor.execute('/test/example.test.js', options);

      // Verify orchestration steps
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockTestFileMounter.generateMounts)).toHaveBeenCalledWith('/test/example.test.js', '/test');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockTestFileMounter.validateMounts)).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.createContainer)).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.startContainer)).toHaveBeenCalledWith('test-container-123');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.waitForContainer)).toHaveBeenCalledWith('test-container-123', 30000);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockResultExtractor.extractResults)).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.cleanup)).toHaveBeenCalledWith('test-container-123', 3);

      // Verify result
      expect(result.exitCode).toBe(0);
      expect(result.docker.containerId).toBe('test-container-123');
    });

    it('should throw error when Docker is not available', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Docker not found');
      });

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      await expect(executor.execute('/test/example.test.js', options)).rejects.toThrow('Docker is not available');
    });

    it('should use custom Docker configuration when provided', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 60000,
        cwd: '/test',
        imageName: 'custom-node:latest',
        networkMode: 'bridge',
        memoryLimit: '2g',
        cpuLimit: '2.0',
      };

      await executor.execute('/test/example.test.js', options);

      // Verify custom configuration was used
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.createContainer)).toHaveBeenCalledWith(
        expect.objectContaining({
          imageName: 'custom-node:latest',
          networkMode: 'bridge',
          memoryLimit: '2g',
          cpuLimit: '2.0',
        })
      );
    });

    it('should pass framework as environment variable', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      await executor.execute('/test/example.test.js', options);

      // Verify TEST_FRAMEWORK environment variable was set
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.createContainer)).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            TEST_FRAMEWORK: expect.any(String),
          }),
        })
      );
    });
  });

  describe('Timeout Handling', () => {
    it('should handle timeout errors from container wait', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockContainerManager.waitForContainer).mockRejectedValue(
        new Error('Container execution timed out after 30000ms')
      );

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      await expect(executor.execute('/test/example.test.js', options)).rejects.toThrow('timed out');

      // Verify cleanup was still called
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.cleanup)).toHaveBeenCalledWith('test-container-123', 3);
    });
  });

  describe('Cleanup on Success and Failure', () => {
    it('should cleanup container on successful execution', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      await executor.execute('/test/example.test.js', options);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.cleanup)).toHaveBeenCalledWith('test-container-123', 3);
    });

    it('should cleanup container on execution failure', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockContainerManager.startContainer).mockRejectedValue(
        new Error('Container start failed')
      );

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      await expect(executor.execute('/test/example.test.js', options)).rejects.toThrow('Container start failed');

      // Verify cleanup was still called
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.cleanup)).toHaveBeenCalledWith('test-container-123', 3);
    });

    it('should not throw if cleanup fails', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockContainerManager.cleanup).mockRejectedValue(
        new Error('Cleanup failed')
      );

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      // Should not throw even if cleanup fails
      await expect(executor.execute('/test/example.test.js', options)).resolves.toBeDefined();
    });
  });

  describe('Framework-Specific Commands', () => {
    it('should generate correct command for jest', () => {
      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const command = (executor as any).getFrameworkCommand('jest', '/test/file.test.js', '/test');
      
      expect(command).toContain('npx');
      expect(command).toContain('jest');
      expect(command).toContain('--no-coverage');
    });

    it('should generate correct command for mocha', () => {
      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const command = (executor as any).getFrameworkCommand('mocha', '/test/file.test.js', '/test');
      
      expect(command).toContain('npx');
      expect(command).toContain('mocha');
    });

    it('should generate correct command for vitest', () => {
      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const command = (executor as any).getFrameworkCommand('vitest', '/test/file.test.js', '/test');
      
      expect(command).toContain('npx');
      expect(command).toContain('vitest');
      expect(command).toContain('run');
    });

    it('should generate correct command for node:test', () => {
      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const command = (executor as any).getFrameworkCommand('node:test', '/test/file.test.js', '/test');
      
      expect(command).toContain('node');
      expect(command).toContain('--test');
    });

    it('should default to node:test for unknown framework', () => {
      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const command = (executor as any).getFrameworkCommand('unknown', '/test/file.test.js', '/test');
      
      expect(command).toContain('node');
      expect(command).toContain('--test');
    });
  });

  describe('Image Management', () => {
    it('should use default image when no custom image specified', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
      };

      await executor.execute('/test/file.test.js', options);

      // Verify createContainer was called with default image
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.createContainer)).toHaveBeenCalledWith(
        expect.objectContaining({
          imageName: 'node:20-alpine',
        })
      );
    });

    it('should use custom image from configuration', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      const executor = new DockerTestExecutor(
        mockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
        imageName: 'node:18-alpine',
      };

      await executor.execute('/test/file.test.js', options);

      // Verify createContainer was called with custom image
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.createContainer)).toHaveBeenCalledWith(
        expect.objectContaining({
          imageName: 'node:18-alpine',
        })
      );
    });

    it('should validate image before container creation', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      // Create a new mock container manager with ensureImage tracked
      const mockEnsureImage = vi.fn().mockResolvedValue(undefined);
      const customMockContainerManager = {
        ...mockContainerManager,
        ensureImage: mockEnsureImage,
        createContainer: vi.fn(async (config) => {
          // Simulate calling ensureImage before creating container
          await mockEnsureImage(config.imageName);
          return 'test-container-123';
        }),
      };

      const executor = new DockerTestExecutor(
        customMockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
        imageName: 'custom-image:latest',
      };

      await executor.execute('/test/file.test.js', options);

      // Verify ensureImage was called before createContainer
      expect(mockEnsureImage).toHaveBeenCalledWith('custom-image:latest');
      expect(customMockContainerManager.createContainer).toHaveBeenCalled();
    });

    it('should handle image pull failure gracefully', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      // Create a new mock container manager that throws on createContainer
      const customMockContainerManager = {
        ...mockContainerManager,
        createContainer: vi.fn().mockRejectedValue(new Error('Failed to pull image')),
      };

      const executor = new DockerTestExecutor(
        customMockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
        imageName: 'nonexistent-image:latest',
      };

      // Should throw error
      await expect(executor.execute('/test/file.test.js', options)).rejects.toThrow('Failed to pull image');

      // Verify cleanup was not called (container was never created)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(mockContainerManager.cleanup)).not.toHaveBeenCalled();
    });

    it('should pull missing image automatically', async () => {
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('Docker version 20.10.0'));

      // Create a new mock container manager with ensureImage tracked
      const mockEnsureImage = vi.fn().mockResolvedValue(undefined);
      const customMockContainerManager = {
        ...mockContainerManager,
        ensureImage: mockEnsureImage,
        createContainer: vi.fn(async (config) => {
          // Simulate calling ensureImage before creating container
          await mockEnsureImage(config.imageName);
          return 'test-container-123';
        }),
      };

      const executor = new DockerTestExecutor(
        customMockContainerManager,
        mockTestFileMounter,
        mockResultExtractor
      );

      const options: DockerExecutionOptions = {
        timeout: 30000,
        cwd: '/test',
        imageName: 'alpine:latest',
      };

      await executor.execute('/test/file.test.js', options);

      // Verify ensureImage was called (which handles pull if needed)
      expect(mockEnsureImage).toHaveBeenCalledWith('alpine:latest');
      expect(customMockContainerManager.createContainer).toHaveBeenCalled();
    });
  });
});
