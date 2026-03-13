/**
 * Unit tests for ContainerManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContainerConfig } from '../../../src/test-execution-reporting/docker/types.js';
import { ContainerCreationError } from '../../../src/test-execution-reporting/docker/errors.js';

// Mock the logger before importing ContainerManager
vi.mock('../../../src/logger.js', () => {
  const mockFunctions = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  
  return {
    createLogger: vi.fn(() => mockFunctions),
    __mockFunctions: mockFunctions, // Export for test access
  };
});

// Import after mocking
import { DefaultContainerManager } from '../../../src/test-execution-reporting/docker/container-manager.js';
import * as loggerModule from '../../../src/logger.js';

// Access the mock functions
const mockLoggerFunctions = (loggerModule as typeof loggerModule & { __mockFunctions: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> } }).__mockFunctions;

// Type for mock Docker instance
type MockDocker = {
  createContainer: ReturnType<typeof vi.fn>;
  getImage: ReturnType<typeof vi.fn>;
  getContainer?: ReturnType<typeof vi.fn>;
  pull?: ReturnType<typeof vi.fn>;
  modem?: {
    followProgress: ReturnType<typeof vi.fn>;
  };
};

// Type alias for DefaultContainerManager constructor parameter
type DockerInstance = ConstructorParameters<typeof DefaultContainerManager>[0];

// Helper function to create a mock Docker instance with all necessary methods
function createMockDocker(): MockDocker {
  return {
    createContainer: vi.fn().mockResolvedValue({ id: 'test-container-id' }),
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Id: 'image-123' }),
    }),
  };
}

describe('ContainerManager', () => {
  beforeEach(() => {
    // Clear mock calls before each test
    mockLoggerFunctions.warn.mockClear();
    mockLoggerFunctions.error.mockClear();
    mockLoggerFunctions.info.mockClear();
    mockLoggerFunctions.debug.mockClear();
  });

  describe('Configuration Validation', () => {
    it('should validate image name is required', async () => {
      const manager = new DefaultContainerManager();
      const config: ContainerConfig = {
        imageName: '',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('Image name is required');
    });

    it('should validate command is required', async () => {
      const manager = new DefaultContainerManager();
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: [],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('Command is required');
    });

    it('should validate network mode', async () => {
      const manager = new DefaultContainerManager();
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'invalid' as unknown as ContainerConfig['networkMode'],
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('Invalid network mode');
    });

    it('should validate at least one mount is required', async () => {
      const manager = new DefaultContainerManager();
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [],
        networkMode: 'none',
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('At least one mount is required');
    });

    it('should validate mount paths are not empty', async () => {
      const manager = new DefaultContainerManager();
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('Mount paths cannot be empty');
    });
  });

  describe('Memory Limit Parsing', () => {
    it('should parse memory limit with k suffix', () => {
      const manager = new DefaultContainerManager();
      // Access private method through unknown cast for testing
      const result = (manager as unknown as { parseMemoryLimit: (limit: string) => number }).parseMemoryLimit('512k');
      expect(result).toBe(512 * 1024);
    });

    it('should parse memory limit with m suffix', () => {
      const manager = new DefaultContainerManager();
      const result = (manager as unknown as { parseMemoryLimit: (limit: string) => number }).parseMemoryLimit('512m');
      expect(result).toBe(512 * 1024 * 1024);
    });

    it('should parse memory limit with g suffix', () => {
      const manager = new DefaultContainerManager();
      const result = (manager as unknown as { parseMemoryLimit: (limit: string) => number }).parseMemoryLimit('2g');
      expect(result).toBe(2 * 1024 * 1024 * 1024);
    });

    it('should parse memory limit without suffix as bytes', () => {
      const manager = new DefaultContainerManager();
      const result = (manager as unknown as { parseMemoryLimit: (limit: string) => number }).parseMemoryLimit('1024');
      expect(result).toBe(1024);
    });

    it('should throw error for invalid memory limit format', () => {
      const manager = new DefaultContainerManager();
      expect(() => (manager as unknown as { parseMemoryLimit: (limit: string) => number }).parseMemoryLimit('invalid')).toThrow(ContainerCreationError);
      expect(() => (manager as unknown as { parseMemoryLimit: (limit: string) => number }).parseMemoryLimit('invalid')).toThrow('Invalid memory limit format');
    });
  });

  describe('CPU Limit Parsing', () => {
    it('should parse CPU limit to nano CPUs', () => {
      const manager = new DefaultContainerManager();
      const result = (manager as unknown as { parseCpuLimit: (limit: string) => number }).parseCpuLimit('1.0');
      expect(result).toBe(1e9);
    });

    it('should parse fractional CPU limit', () => {
      const manager = new DefaultContainerManager();
      const result = (manager as unknown as { parseCpuLimit: (limit: string) => number }).parseCpuLimit('0.5');
      expect(result).toBe(0.5e9);
    });

    it('should throw error for invalid CPU limit', () => {
      const manager = new DefaultContainerManager();
      expect(() => (manager as unknown as { parseCpuLimit: (limit: string) => number }).parseCpuLimit('invalid')).toThrow(ContainerCreationError);
      expect(() => (manager as unknown as { parseCpuLimit: (limit: string) => number }).parseCpuLimit('invalid')).toThrow('Invalid CPU limit format');
    });

    it('should throw error for negative CPU limit', () => {
      const manager = new DefaultContainerManager();
      expect(() => (manager as unknown as { parseCpuLimit: (limit: string) => number }).parseCpuLimit('-1')).toThrow(ContainerCreationError);
    });

    it('should throw error for zero CPU limit', () => {
      const manager = new DefaultContainerManager();
      expect(() => (manager as unknown as { parseCpuLimit: (limit: string) => number }).parseCpuLimit('0')).toThrow(ContainerCreationError);
    });
  });

  describe('Network Mode Warning Logging', () => {
    it('should not log warning when network mode is none', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
      };

      await manager.createContainer(config);

      expect(mockLoggerFunctions.warn).not.toHaveBeenCalled();
    });

    it('should log warning when network mode is bridge', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'bridge',
      };

      await manager.createContainer(config);

      expect(mockLoggerFunctions.warn).toHaveBeenCalledWith(
        'Container created with network access enabled',
        {
          networkMode: 'bridge',
          imageName: 'node:20-alpine',
        }
      );
    });

    it('should log warning when network mode is host', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'host',
      };

      await manager.createContainer(config);

      expect(mockLoggerFunctions.warn).toHaveBeenCalledWith(
        'Container created with network access enabled',
        {
          networkMode: 'host',
          imageName: 'node:20-alpine',
        }
      );
    });
  });

  describe('Container Lifecycle', () => {
    it('should successfully create container with valid configuration', async () => {
      const mockContainer = { id: 'test-container-123' };
      const mockDocker = createMockDocker();
      mockDocker.createContainer = vi.fn().mockResolvedValue(mockContainer);
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [
          { hostPath: '/host/test.js', containerPath: '/workspace/test.js', readOnly: true },
          { hostPath: '/host/src', containerPath: '/workspace/src', readOnly: true },
        ],
        networkMode: 'none',
        memoryLimit: '512m',
        cpuLimit: '1.0',
        env: { NODE_ENV: 'test', FRAMEWORK: 'jest' },
      };

      const containerId = await manager.createContainer(config);

      expect(containerId).toBe('test-container-123');
      expect(mockDocker.createContainer).toHaveBeenCalledWith({
        Image: 'node:20-alpine',
        Cmd: ['node', 'test.js'],
        WorkingDir: '/workspace',
        Env: ['NODE_ENV=test', 'FRAMEWORK=jest'],
        HostConfig: {
          Binds: [
            '/host/test.js:/workspace/test.js:ro',
            '/host/src:/workspace/src:ro',
          ],
          NetworkMode: 'none',
          Memory: 512 * 1024 * 1024,
          NanoCpus: 1e9,
        },
      });
    });

    it('should start container successfully', async () => {
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await manager.startContainer('test-container-123');

      expect(mockDocker.getContainer).toHaveBeenCalledWith('test-container-123');
      expect(mockContainer.start).toHaveBeenCalled();
    });

    it('should wait for container completion and return exit code', async () => {
      const mockContainer = {
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      const exitCode = await manager.waitForContainer('test-container-123', 5000);

      expect(exitCode).toBe(0);
      expect(mockContainer.wait).toHaveBeenCalled();
    });

    it('should handle non-zero exit codes', async () => {
      const mockContainer = {
        wait: vi.fn().mockResolvedValue({ StatusCode: 1 }),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      const exitCode = await manager.waitForContainer('test-container-123', 5000);

      expect(exitCode).toBe(1);
    });

    it('should timeout and force stop container if execution exceeds timeout', async () => {
      const mockContainer = {
        wait: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ StatusCode: 0 }), 10000))),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await expect(manager.waitForContainer('test-container-123', 100)).rejects.toThrow('timed out');
      
      // Verify force stop was called
      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 0 });
    });
  });

  describe('Graceful Stop vs Force Kill', () => {
    it('should gracefully stop container with SIGTERM', async () => {
      const mockContainer = {
        stop: vi.fn().mockResolvedValue(undefined),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await manager.stopContainer('test-container-123', 10);

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
    });

    it('should force kill container if graceful stop fails', async () => {
      const mockContainer = {
        stop: vi.fn().mockRejectedValue(new Error('Stop failed')),
        kill: vi.fn().mockResolvedValue(undefined),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await manager.stopContainer('test-container-123', 10);

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
      expect(mockContainer.kill).toHaveBeenCalled();
    });

    it('should not throw error if container is already stopped', async () => {
      const mockContainer = {
        stop: vi.fn().mockRejectedValue(new Error('container is not running')),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await expect(manager.stopContainer('test-container-123', 10)).resolves.not.toThrow();
    });

    it('should remove container successfully', async () => {
      const mockContainer = {
        remove: vi.fn().mockResolvedValue(undefined),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await manager.removeContainer('test-container-123', true);

      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('should not throw error if container does not exist during removal', async () => {
      const mockContainer = {
        remove: vi.fn().mockRejectedValue(new Error('No such container')),
      };
      const mockDocker = {
        getContainer: vi.fn().mockReturnValue(mockContainer),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await expect(manager.removeContainer('test-container-123', true)).resolves.not.toThrow();
    });
  });

  describe('Network Mode Configurations', () => {
    it('should create container with none network mode', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
      };

      await manager.createContainer(config);

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: 'none',
          }),
        })
      );
    });

    it('should create container with bridge network mode', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'bridge',
      };

      await manager.createContainer(config);

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: 'bridge',
          }),
        })
      );
    });

    it('should create container with host network mode', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'host',
      };

      await manager.createContainer(config);

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: 'host',
          }),
        })
      );
    });
  });

  describe('Error Handling for Resource Limits', () => {
    it('should handle insufficient resources error', async () => {
      const mockDocker = createMockDocker();
      mockDocker.createContainer = vi.fn().mockRejectedValue(new Error('insufficient resources available'));
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
        memoryLimit: '16g',
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('Insufficient resources');
    });

    it('should handle image not found error', async () => {
      const mockDocker = createMockDocker();
      mockDocker.createContainer = vi.fn().mockRejectedValue(new Error('No such image: nonexistent:latest'));
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'nonexistent:latest',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('Image not found');
    });

    it('should handle permission denied error', async () => {
      const mockDocker = createMockDocker();
      mockDocker.createContainer = vi.fn().mockRejectedValue(new Error('permission denied'));
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
      };

      await expect(manager.createContainer(config)).rejects.toThrow(ContainerCreationError);
      await expect(manager.createContainer(config)).rejects.toThrow('Permission denied');
    });

    it('should apply memory limits correctly', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
        memoryLimit: '2g',
      };

      await manager.createContainer(config);

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Memory: 2 * 1024 * 1024 * 1024,
          }),
        })
      );
    });

    it('should apply CPU limits correctly', async () => {
      const mockDocker = createMockDocker();
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);
      
      const config: ContainerConfig = {
        imageName: 'node:20-alpine',
        command: ['node', 'test.js'],
        workingDir: '/workspace',
        mounts: [{ hostPath: '/host', containerPath: '/container', readOnly: true }],
        networkMode: 'none',
        cpuLimit: '0.5',
      };

      await manager.createContainer(config);

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            NanoCpus: 0.5e9,
          }),
        })
      );
    });
  });

  describe('Image Management', () => {
    it('should check if image exists locally', async () => {
      const mockImage = {
        inspect: vi.fn().mockResolvedValue({ Id: 'image-123' }),
      };
      const mockDocker = {
        getImage: vi.fn().mockReturnValue(mockImage),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await manager.ensureImage('node:20-alpine');

      expect(mockDocker.getImage).toHaveBeenCalledWith('node:20-alpine');
      expect(mockImage.inspect).toHaveBeenCalled();
    });

    it('should pull image when not found locally', async () => {
      const mockImage = {
        inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
      };
      const mockStream = {
        on: vi.fn(),
      };
      const mockDocker = {
        getImage: vi.fn().mockReturnValue(mockImage),
        pull: vi.fn((imageName, callback) => {
          callback(null, mockStream);
          return Promise.resolve();
        }),
        modem: {
          followProgress: vi.fn((stream, onFinished) => {
            onFinished(null);
          }),
        },
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await manager.ensureImage('alpine:latest');

      expect(mockDocker.getImage).toHaveBeenCalledWith('alpine:latest');
      expect(mockDocker.pull).toHaveBeenCalledWith('alpine:latest', expect.any(Function));
    });

    it('should throw ImageError when pull fails', async () => {
      const mockImage = {
        inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
      };
      const mockDocker = {
        getImage: vi.fn().mockReturnValue(mockImage),
        pull: vi.fn((imageName, callback) => {
          callback(new Error('Network error'), null);
          return Promise.resolve();
        }),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await expect(manager.ensureImage('nonexistent:latest')).rejects.toThrow('Failed to pull image');
    });

    it('should timeout pull operation after specified duration', async () => {
      const mockImage = {
        inspect: vi.fn().mockRejectedValue({ statusCode: 404 }),
      };
      const mockStream = {
        on: vi.fn(),
      };
      const mockDocker = {
        getImage: vi.fn().mockReturnValue(mockImage),
        pull: vi.fn((imageName, callback) => {
          callback(null, mockStream);
          // Never call followProgress callback to simulate hanging
          return Promise.resolve();
        }),
        modem: {
          followProgress: vi.fn(() => {
            // Simulate hanging - never call onFinished
          }),
        },
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      // Use short timeout for test
      await expect(manager.ensureImage('slow-image:latest', 100)).rejects.toThrow('timed out');
    }, 10000);

    it('should throw ImageError for validation failures', async () => {
      const mockImage = {
        inspect: vi.fn().mockRejectedValue(new Error('Permission denied')),
      };
      const mockDocker = {
        getImage: vi.fn().mockReturnValue(mockImage),
      };
      const manager = new DefaultContainerManager(mockDocker as unknown as DockerInstance);

      await expect(manager.ensureImage('restricted:latest')).rejects.toThrow('Failed to validate image');
    });
  });
});
