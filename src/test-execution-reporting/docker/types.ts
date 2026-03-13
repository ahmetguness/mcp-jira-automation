/**
 * TypeScript interfaces and types for Docker Test Execution
 * 
 * This module extends the test-execution-reporting module to execute tests
 * inside Docker containers, providing isolation, consistency, and reproducibility.
 */

import type {
  TestExecutor,
  ExecutionOptions,
  RawTestResult,
  TestFramework,
  TestExecutionContext,
} from '../types.js';

// ─── Docker Configuration ────────────────────────────────────

/**
 * Network modes for Docker containers
 */
export type NetworkMode = 'none' | 'bridge' | 'host';

/**
 * Configuration for Docker test execution
 */
export interface DockerConfiguration {
  /** Default Docker image to use (default: 'node:20-alpine') */
  defaultImage: string;
  /** Optional custom registry URL */
  imageRegistry?: string;
  /** Network mode for containers (default: 'none') */
  networkMode: NetworkMode;
  /** Resource limits */
  resourceLimits: {
    /** Memory limit (e.g., '512m', '1g') */
    memory: string;
    /** CPU limit (e.g., '0.5', '1.0') */
    cpu: string;
  };
  /** Execution timeout in milliseconds (default: 300000 - 5 minutes) */
  timeout: number;
  /** Number of cleanup retry attempts (default: 3) */
  cleanupRetries: number;
  /** Delay between cleanup retries in milliseconds (default: 1000) */
  cleanupRetryDelay: number;
  /** Image pull timeout in milliseconds (default: 120000 - 2 minutes) */
  pullTimeout: number;
}

// ─── Docker Execution Options ────────────────────────────────

/**
 * Extended execution options for Docker
 */
export interface DockerExecutionOptions extends ExecutionOptions {
  /** Docker image name (overrides default) */
  imageName?: string;
  /** Network mode (overrides default) */
  networkMode?: NetworkMode;
  /** Memory limit (overrides default) */
  memoryLimit?: string;
  /** CPU limit (overrides default) */
  cpuLimit?: string;
}

// ─── Container Configuration ──────────────────────────────────

/**
 * Mount configuration for binding host paths to container paths
 */
export interface Mount {
  /** Absolute path on host machine */
  hostPath: string;
  /** Absolute path inside container */
  containerPath: string;
  /** Whether mount is read-only */
  readOnly: boolean;
}

/**
 * Complete container configuration
 */
export interface ContainerConfig {
  /** Docker image name */
  imageName: string;
  /** Command to execute inside container */
  command: string[];
  /** Working directory inside container */
  workingDir: string;
  /** Volume mounts */
  mounts: Mount[];
  /** Network mode */
  networkMode: NetworkMode;
  /** Memory limit (optional) */
  memoryLimit?: string;
  /** CPU limit (optional) */
  cpuLimit?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

// ─── Docker Execution Context ─────────────────────────────────

/**
 * Extended execution context with Docker-specific information
 */
export interface DockerExecutionContext extends TestExecutionContext {
  /** Container ID */
  containerId: string;
  /** Docker image name used */
  imageName: string;
  /** Network mode used */
  networkMode: NetworkMode;
  /** Volume mounts */
  mounts: Mount[];
  /** Resource limits applied */
  resourceLimits: {
    memory?: string;
    cpu?: string;
  };
}

// ─── Docker Test Results ──────────────────────────────────────

/**
 * Extended raw test result with Docker metadata
 */
export interface DockerRawTestResult extends RawTestResult {
  /** Docker-specific metadata */
  docker: {
    /** Container ID */
    containerId: string;
    /** Image name used */
    imageName: string;
    /** Network mode */
    networkMode: string;
    /** Container creation time in milliseconds */
    containerCreationTime: number;
    /** Container start time in milliseconds */
    containerStartTime: number;
    /** Container stop time in milliseconds */
    containerStopTime: number;
  };
}

// ─── Docker Executor Interface ────────────────────────────────

/**
 * Docker-based test executor interface
 */
export interface DockerTestExecutor extends TestExecutor {
  /**
   * Execute a test file inside a Docker container
   * @param testFilePath - Path to the test file on host
   * @param options - Docker execution options
   * @returns Raw execution results with Docker metadata
   * @throws DockerUnavailableError if Docker is not running
   * @throws ContainerCreationError if container creation fails
   * @throws ContainerExecutionError if execution fails
   */
  execute(testFilePath: string, options: DockerExecutionOptions): Promise<DockerRawTestResult>;

  /**
   * Detect test framework (delegates to existing logic)
   * @param testFilePath - Path to the test file
   * @returns Detected framework name
   */
  detectFramework(testFilePath: string): Promise<TestFramework>;

  /**
   * Check if Docker is available and running
   * @returns True if Docker is available
   */
  isDockerAvailable(): Promise<boolean>;
}

// ─── Container Manager Interface ──────────────────────────────

/**
 * Manages Docker container lifecycle
 */
export interface ContainerManager {
  /**
   * Create a Docker container for test execution
   * @param config - Container configuration
   * @returns Container ID
   * @throws ContainerCreationError if creation fails
   */
  createContainer(config: ContainerConfig): Promise<string>;

  /**
   * Start a Docker container
   * @param containerId - Container ID
   * @throws ContainerStartError if start fails
   */
  startContainer(containerId: string): Promise<void>;

  /**
   * Stop a Docker container
   * @param containerId - Container ID
   * @param timeout - Timeout in seconds before force kill (default: 10)
   */
  stopContainer(containerId: string, timeout?: number): Promise<void>;

  /**
   * Remove a Docker container
   * @param containerId - Container ID
   * @param force - Force removal even if running (default: true)
   */
  removeContainer(containerId: string, force?: boolean): Promise<void>;

  /**
   * Clean up container (stop + remove with retry)
   * @param containerId - Container ID
   * @param maxRetries - Maximum retry attempts (default: 3)
   */
  cleanup(containerId: string, maxRetries?: number): Promise<void>;

  /**
   * Wait for container to complete execution
   * @param containerId - Container ID
   * @param timeout - Timeout in milliseconds
   * @returns Exit code
   */
  waitForContainer(containerId: string, timeout: number): Promise<number>;

  /**
   * Ensure Docker image exists locally, pull if not found
   * @param imageName - Docker image name
   * @param pullTimeout - Timeout for pull operation in milliseconds (default: 2 minutes)
   * @throws ImageError if image validation or pull fails
   */
  ensureImage(imageName: string, pullTimeout?: number): Promise<void>;
}

// ─── Test File Mounter Interface ──────────────────────────────

/**
 * Manages mounting test files and dependencies into containers
 */
export interface TestFileMounter {
  /**
   * Generate mount configurations for test execution
   * @param testFilePath - Path to test file on host
   * @param projectRoot - Project root directory
   * @returns Array of mount configurations
   */
  generateMounts(testFilePath: string, projectRoot: string): Promise<Mount[]>;

  /**
   * Validate all mount paths exist and are accessible
   * @param mounts - Mount configurations to validate
   * @throws MountValidationError if any path is invalid
   */
  validateMounts(mounts: Mount[]): Promise<void>;
}

// ─── Result Extractor Interface ───────────────────────────────

/**
 * Extracts test results from Docker containers
 */
export interface ResultExtractor {
  /**
   * Extract test results from a completed container
   * @param containerId - Container ID
   * @param startTime - Execution start timestamp
   * @param framework - Detected test framework
   * @returns Raw test result with Docker metadata
   */
  extractResults(
    containerId: string,
    startTime: number,
    framework: TestFramework
  ): Promise<DockerRawTestResult>;

  /**
   * Capture container logs (stdout and stderr)
   * @param containerId - Container ID
   * @returns Container logs
   */
  captureLogs(containerId: string): Promise<{ stdout: string; stderr: string }>;

  /**
   * Get container exit code
   * @param containerId - Container ID
   * @returns Exit code
   */
  getExitCode(containerId: string): Promise<number>;
}
