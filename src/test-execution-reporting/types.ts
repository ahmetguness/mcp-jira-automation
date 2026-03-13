/**
 * Core TypeScript interfaces and types for Test Execution Reporting
 */

/**
 * Supported test frameworks
 */
export type TestFramework = 'jest' | 'mocha' | 'vitest' | 'node:test' | 'unknown';

/**
 * Report language codes
 */
export type ReportLanguage = 'tr' | 'en';

/**
 * Test execution status
 */
export type TestStatus = 'passed' | 'failed' | 'skipped';

/**
 * Error types for categorization
 */
export type ErrorType = 'syntax' | 'assertion' | 'timeout' | 'dependency' | 'runtime';

/**
 * Pipeline stages for error tracking
 */
export type PipelineStage = 'execution' | 'collection' | 'detection' | 'generation' | 'commit';

/**
 * Options for test execution
 */
export interface ExecutionOptions {
  /** Timeout in milliseconds, default 300000 (5 minutes) */
  timeout: number;
  /** Working directory */
  cwd: string;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Raw test execution result from Test Executor
 */
export interface RawTestResult {
  /** Process exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** Detected test framework */
  framework: TestFramework;
  /** Whether execution timed out */
  timedOut: boolean;
  /** Execution start timestamp in milliseconds */
  timestamp: number;
}

/**
 * Test error information
 */
export interface TestError {
  /** Error message */
  message: string;
  /** Stack trace (optional) */
  stack?: string;
  /** Error type for categorization */
  type: ErrorType;
}

/**
 * Individual test case result
 */
export interface TestCase {
  /** Test name */
  name: string;
  /** Test status */
  status: TestStatus;
  /** Test duration in milliseconds */
  duration: number;
  /** Error information if test failed */
  error?: TestError;
}

/**
 * Test execution summary statistics
 */
export interface TestSummary {
  /** Total number of tests */
  total: number;
  /** Number of passed tests */
  passed: number;
  /** Number of failed tests */
  failed: number;
  /** Number of skipped tests */
  skipped: number;
  /** Success rate as percentage */
  successRate: number;
}

/**
 * Structured test result from Result Collector
 */
export interface TestResult {
  /** Summary statistics */
  summary: TestSummary;
  /** Individual test cases */
  tests: TestCase[];
  /** Errors encountered */
  errors: TestError[];
  /** Total execution time in milliseconds */
  executionTime: number;
  /** Execution timestamp */
  timestamp: Date;
}

/**
 * Options for PR update
 */
export interface UpdateOptions {
  /** Maximum number of retry attempts, default 3 */
  maxRetries: number;
  /** Delay between retries in milliseconds, default 1000 */
  retryDelay: number;
}

/**
 * Complete context for test execution
 */
export interface TestExecutionContext {
  /** Path to the test file */
  testFilePath: string;
  /** Pull request URL */
  prUrl: string;
  /** Jira task key (e.g., PROJ-123) */
  jiraTaskKey: string;
  /** Jira task content for language detection */
  jiraTaskContent: string;
  /** Repository path */
  repositoryPath: string;
  /** Branch name */
  branch: string;
  /** Context creation timestamp */
  createdAt: Date;
}

/**
 * Pipeline error information
 */
export interface PipelineError {
  /** Pipeline stage where error occurred */
  stage: PipelineStage;
  /** Error message */
  message: string;
  /** Stack trace (optional) */
  stack?: string;
  /** Whether error is recoverable */
  recoverable: boolean;
}

/**
 * Complete result of the test execution pipeline
 */
export interface ExecutionResult {
  /** Execution context */
  context: TestExecutionContext;
  /** Raw execution result */
  rawResult: RawTestResult;
  /** Structured test result */
  testResult: TestResult;
  /** Detected report language */
  language: ReportLanguage;
  /** Generated markdown report */
  report: string;
  /** Whether report was successfully committed to PR */
  reportCommitted: boolean;
  /** Errors encountered during pipeline execution */
  errors: PipelineError[];
}

/**
 * Test Executor interface
 */
export interface TestExecutor {
  /**
   * Execute a test file and return raw results
   * @param testFilePath - Path to the test file
   * @param options - Execution options
   * @returns Raw execution results
   * @throws ExecutionError if execution fails
   */
  execute(testFilePath: string, options: ExecutionOptions): Promise<RawTestResult>;

  /**
   * Detect the test framework from package.json or file syntax
   * @param testFilePath - Path to the test file
   * @returns Detected framework name
   */
  detectFramework(testFilePath: string): Promise<TestFramework>;
}

/**
 * Result Collector interface
 */
export interface ResultCollector {
  /**
   * Parse raw test output into structured results
   * @param rawResult - Raw execution output
   * @returns Structured test results
   */
  collect(rawResult: RawTestResult): TestResult;
}

/**
 * Language Detector interface
 */
export interface LanguageDetector {
  /**
   * Detect language from Jira task content
   * @param taskContent - Jira task description and comments
   * @returns Detected language code
   */
  detect(taskContent: string): ReportLanguage;
}

/**
 * Report Generator interface
 */
export interface ReportGenerator {
  /**
   * Generate markdown report from test results
   * @param result - Structured test results
   * @param language - Report language
   * @param rawResult - Optional raw result for Docker metadata
   * @returns Markdown formatted report
   */
  generate(result: TestResult, language: ReportLanguage, rawResult?: RawTestResult): string;
}

/**
 * PR Updater interface
 */
export interface PRUpdater {
  /**
   * Add test report to pull request as a commit
   * @param prUrl - Pull request URL
   * @param report - Markdown report content
   * @param options - Update options
   * @returns Success status
   */
  addReport(prUrl: string, report: string, options: UpdateOptions): Promise<boolean>;
}

// ─── Docker-Specific Types ────────────────────────────────────

/**
 * Network modes for Docker containers
 */
export type NetworkMode = 'none' | 'bridge' | 'host';

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
