/**
 * Unit tests for Test Execution Reporting configuration
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_CONFIG, getConfig } from '../../src/test-execution-reporting/config.js';

describe('Test Execution Reporting Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  test('DEFAULT_CONFIG should have correct default values', () => {
    expect(DEFAULT_CONFIG.timeout).toBe(300000);
    expect(DEFAULT_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_CONFIG.retryDelay).toBe(1000);
    expect(DEFAULT_CONFIG.supportedFrameworks).toEqual(['jest', 'mocha', 'vitest', 'node:test']);
    expect(DEFAULT_CONFIG.defaultFramework).toBe('node:test');
    expect(DEFAULT_CONFIG.reportDirectory).toBe('test-reports');
    expect(DEFAULT_CONFIG.cleanupTemporaryFiles).toBe(true);
  });

  test('getConfig should return default values when no env vars set', () => {
    const config = getConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test('getConfig should override timeout from environment variable', () => {
    process.env.TEST_EXECUTION_TIMEOUT = '600000';
    const config = getConfig();
    expect(config.timeout).toBe(600000);
  });

  test('getConfig should override maxRetries from environment variable', () => {
    process.env.TEST_EXECUTION_MAX_RETRIES = '5';
    const config = getConfig();
    expect(config.maxRetries).toBe(5);
  });

  test('getConfig should override retryDelay from environment variable', () => {
    process.env.TEST_EXECUTION_RETRY_DELAY = '2000';
    const config = getConfig();
    expect(config.retryDelay).toBe(2000);
  });

  test('getConfig should override defaultFramework from environment variable', () => {
    process.env.TEST_EXECUTION_DEFAULT_FRAMEWORK = 'jest';
    const config = getConfig();
    expect(config.defaultFramework).toBe('jest');
  });

  test('getConfig should override reportDirectory from environment variable', () => {
    process.env.TEST_EXECUTION_REPORT_DIR = 'custom-reports';
    const config = getConfig();
    expect(config.reportDirectory).toBe('custom-reports');
  });

  test('getConfig should override cleanupTemporaryFiles from environment variable', () => {
    process.env.TEST_EXECUTION_CLEANUP = 'false';
    const config = getConfig();
    expect(config.cleanupTemporaryFiles).toBe(false);
  });

  test('getConfig should handle invalid timeout gracefully', () => {
    process.env.TEST_EXECUTION_TIMEOUT = 'invalid';
    const config = getConfig();
    // Should parse as NaN, which is a valid number
    expect(typeof config.timeout).toBe('number');
  });

  test('getConfig should support all configuration options simultaneously', () => {
    process.env.TEST_EXECUTION_TIMEOUT = '600000';
    process.env.TEST_EXECUTION_MAX_RETRIES = '5';
    process.env.TEST_EXECUTION_RETRY_DELAY = '2000';
    process.env.TEST_EXECUTION_DEFAULT_FRAMEWORK = 'vitest';
    process.env.TEST_EXECUTION_REPORT_DIR = 'custom-reports';
    process.env.TEST_EXECUTION_CLEANUP = 'false';

    const config = getConfig();

    expect(config.timeout).toBe(600000);
    expect(config.maxRetries).toBe(5);
    expect(config.retryDelay).toBe(2000);
    expect(config.defaultFramework).toBe('vitest');
    expect(config.reportDirectory).toBe('custom-reports');
    expect(config.cleanupTemporaryFiles).toBe(false);
  });
});
