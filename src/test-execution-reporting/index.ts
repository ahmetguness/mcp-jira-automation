/**
 * Test Execution Reporting - Main Exports
 * 
 * This module provides automatic test execution and reporting for AI-generated test files.
 */

// Pipeline orchestration
export { TestExecutionPipeline } from './pipeline.js';

// Core components
export { DefaultTestExecutor } from './test-executor.js';
export { DefaultResultCollector } from './result-collector.js';
export { DefaultLanguageDetector } from './language-detector.js';
export { DefaultReportGenerator } from './report-generator.js';
export { DefaultPRUpdater } from './pr-updater.js';

// Docker components (re-export from docker module)
export {
  DockerTestExecutor,
  DefaultContainerManager,
  DefaultTestFileMounter,
  DefaultResultExtractor,
  DEFAULT_CONFIG,
  ConfigurationValidationError,
  loadConfiguration,
  validateConfiguration,
  getConfiguration,
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
} from './docker/index.js';

// Types
export type {
  TestExecutionContext,
  ExecutionResult,
  TestExecutor,
  ResultCollector,
  LanguageDetector,
  ReportGenerator,
  PRUpdater,
  RawTestResult,
  TestResult,
  TestCase,
  TestError,
  TestSummary,
  ExecutionOptions,
  UpdateOptions,
  PipelineError,
  TestFramework,
  ReportLanguage,
  TestStatus,
  ErrorType,
  PipelineStage,
} from './types.js';

// Docker types (re-export from docker module)
export type {
  NetworkMode,
  DockerConfiguration,
  DockerExecutionOptions,
  Mount,
  ContainerConfig,
  DockerExecutionContext,
  DockerRawTestResult,
  ContainerManager,
  TestFileMounter,
  ResultExtractor,
} from './docker/index.js';
