/**
 * Docker Test Execution Reporting Module
 * 
 * This module extends the test-execution-reporting module to execute
 * AI-generated test files inside Docker containers, providing:
 * - Isolation: Tests run in clean, isolated environments
 * - Consistency: Same environment across all machines
 * - Reproducibility: Identical results regardless of host configuration
 * - Safety: Network isolation prevents unexpected external calls
 */

// Export all types
export type {
  NetworkMode,
  DockerConfiguration,
  DockerExecutionOptions,
  Mount,
  ContainerConfig,
  DockerExecutionContext,
  DockerRawTestResult,
  DockerTestExecutor as IDockerTestExecutor,
  ContainerManager,
  TestFileMounter,
  ResultExtractor,
} from './types.js';

// Export all error classes
export {
  DockerError,
  DockerUnavailableError,
  ImagePullError,
  ImageError,
  ContainerCreationError,
  ContainerStartError,
  ContainerExecutionError,
  MountValidationError,
  CleanupError,
  ResultExtractionError,
  NetworkConfigurationError,
} from './errors.js';

// Export implementations
export { DefaultContainerManager } from './container-manager.js';
export { DefaultTestFileMounter } from './test-file-mounter.js';
export { DefaultResultExtractor } from './result-extractor.js';
export { DockerTestExecutor } from './docker-test-executor.js';

// Export configuration utilities
export {
  DEFAULT_CONFIG,
  ConfigurationValidationError,
  loadConfiguration,
  validateConfiguration,
  getConfiguration,
} from './config.js';
