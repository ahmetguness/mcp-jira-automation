/**
 * Configuration for Test Execution Reporting
 */

import type { TestFramework } from './types.js';

/**
 * System configuration for test execution
 */
export interface TestExecutionConfig {
  /** Timeout in milliseconds, default 300000 (5 minutes) */
  timeout: number;
  /** Maximum number of retry attempts, default 3 */
  maxRetries: number;
  /** Delay between retries in milliseconds, default 1000 */
  retryDelay: number;
  /** Supported test frameworks */
  supportedFrameworks: TestFramework[];
  /** Default framework when detection fails */
  defaultFramework: TestFramework;
  /** Directory for test reports */
  reportDirectory: string;
  /** Whether to clean up temporary files after execution */
  cleanupTemporaryFiles: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: TestExecutionConfig = {
  timeout: 300000, // 5 minutes
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  supportedFrameworks: ['jest', 'mocha', 'vitest', 'node:test'],
  defaultFramework: 'node:test',
  reportDirectory: 'test-reports',
  cleanupTemporaryFiles: true,
};

/**
 * Get configuration with environment variable overrides
 */
export function getConfig(): TestExecutionConfig {
  return {
    timeout: parseInt(process.env.TEST_EXECUTION_TIMEOUT || String(DEFAULT_CONFIG.timeout), 10),
    maxRetries: parseInt(process.env.TEST_EXECUTION_MAX_RETRIES || String(DEFAULT_CONFIG.maxRetries), 10),
    retryDelay: parseInt(process.env.TEST_EXECUTION_RETRY_DELAY || String(DEFAULT_CONFIG.retryDelay), 10),
    supportedFrameworks: DEFAULT_CONFIG.supportedFrameworks,
    defaultFramework: (process.env.TEST_EXECUTION_DEFAULT_FRAMEWORK as TestFramework) || DEFAULT_CONFIG.defaultFramework,
    reportDirectory: process.env.TEST_EXECUTION_REPORT_DIR || DEFAULT_CONFIG.reportDirectory,
    cleanupTemporaryFiles: process.env.TEST_EXECUTION_CLEANUP !== 'false',
  };
}
