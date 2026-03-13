/**
 * Unit tests for Test Execution Reporting types
 */

import { describe, test, expect } from 'vitest';
import type {
  TestFramework,
  ReportLanguage,
  TestStatus,
  ErrorType,
  PipelineStage,
  ExecutionOptions,
  RawTestResult,
  TestError,
  TestCase,
  TestSummary,
  TestResult,
  UpdateOptions,
  TestExecutionContext,
  PipelineError,
  ExecutionResult,
} from '../../src/test-execution-reporting/types.js';

describe('Test Execution Reporting Types', () => {
  test('TestFramework type should accept valid framework names', () => {
    const frameworks: TestFramework[] = ['jest', 'mocha', 'vitest', 'node:test', 'unknown'];
    expect(frameworks).toHaveLength(5);
  });

  test('ReportLanguage type should accept valid language codes', () => {
    const languages: ReportLanguage[] = ['tr', 'en'];
    expect(languages).toHaveLength(2);
  });

  test('TestStatus type should accept valid status values', () => {
    const statuses: TestStatus[] = ['passed', 'failed', 'skipped'];
    expect(statuses).toHaveLength(3);
  });

  test('ErrorType type should accept valid error types', () => {
    const errorTypes: ErrorType[] = ['syntax', 'assertion', 'timeout', 'dependency', 'runtime'];
    expect(errorTypes).toHaveLength(5);
  });

  test('PipelineStage type should accept valid stage names', () => {
    const stages: PipelineStage[] = ['execution', 'collection', 'detection', 'generation', 'commit'];
    expect(stages).toHaveLength(5);
  });

  test('ExecutionOptions should have required fields', () => {
    const options: ExecutionOptions = {
      timeout: 300000,
      cwd: '/path/to/project',
      env: { NODE_ENV: 'test' },
    };
    expect(options.timeout).toBe(300000);
    expect(options.cwd).toBe('/path/to/project');
    expect(options.env).toEqual({ NODE_ENV: 'test' });
  });

  test('RawTestResult should have required fields', () => {
    const result: RawTestResult = {
      exitCode: 0,
      stdout: 'test output',
      stderr: '',
      duration: 1000,
      framework: 'jest',
      timedOut: false,
      timestamp: Date.now(),
    };
    expect(result.exitCode).toBe(0);
    expect(result.framework).toBe('jest');
    expect(result.timedOut).toBe(false);
  });

  test('TestError should have required fields', () => {
    const error: TestError = {
      message: 'Test failed',
      stack: 'Error: Test failed\n    at test.ts:10:5',
      type: 'assertion',
    };
    expect(error.message).toBe('Test failed');
    expect(error.type).toBe('assertion');
  });

  test('TestCase should have required fields', () => {
    const testCase: TestCase = {
      name: 'should add two numbers',
      status: 'passed',
      duration: 5,
    };
    expect(testCase.name).toBe('should add two numbers');
    expect(testCase.status).toBe('passed');
    expect(testCase.duration).toBe(5);
  });

  test('TestSummary should have required fields', () => {
    const summary: TestSummary = {
      total: 10,
      passed: 8,
      failed: 1,
      skipped: 1,
      successRate: 80,
    };
    expect(summary.total).toBe(10);
    expect(summary.passed).toBe(8);
    expect(summary.successRate).toBe(80);
  });

  test('TestResult should have required fields', () => {
    const result: TestResult = {
      summary: {
        total: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        successRate: 100,
      },
      tests: [],
      errors: [],
      executionTime: 1000,
      timestamp: new Date(),
    };
    expect(result.summary.total).toBe(3);
    expect(result.executionTime).toBe(1000);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  test('UpdateOptions should have required fields', () => {
    const options: UpdateOptions = {
      maxRetries: 3,
      retryDelay: 1000,
    };
    expect(options.maxRetries).toBe(3);
    expect(options.retryDelay).toBe(1000);
  });

  test('TestExecutionContext should have required fields', () => {
    const context: TestExecutionContext = {
      testFilePath: '/path/to/test.ts',
      prUrl: 'https://github.com/org/repo/pull/123',
      jiraTaskKey: 'PROJ-123',
      jiraTaskContent: 'Test task content',
      repositoryPath: '/path/to/repo',
      branch: 'feature/test',
      createdAt: new Date(),
    };
    expect(context.testFilePath).toBe('/path/to/test.ts');
    expect(context.jiraTaskKey).toBe('PROJ-123');
    expect(context.createdAt).toBeInstanceOf(Date);
  });

  test('PipelineError should have required fields', () => {
    const error: PipelineError = {
      stage: 'execution',
      message: 'Execution failed',
      stack: 'Error: Execution failed\n    at executor.ts:50:10',
      recoverable: false,
    };
    expect(error.stage).toBe('execution');
    expect(error.message).toBe('Execution failed');
    expect(error.recoverable).toBe(false);
  });

  test('ExecutionResult should have required fields', () => {
    const result: ExecutionResult = {
      context: {
        testFilePath: '/path/to/test.ts',
        prUrl: 'https://github.com/org/repo/pull/123',
        jiraTaskKey: 'PROJ-123',
        jiraTaskContent: 'Test task',
        repositoryPath: '/path/to/repo',
        branch: 'main',
        createdAt: new Date(),
      },
      rawResult: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      },
      testResult: {
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          successRate: 0,
        },
        tests: [],
        errors: [],
        executionTime: 1000,
        timestamp: new Date(),
      },
      language: 'en',
      report: '# Test Report',
      reportCommitted: true,
      errors: [],
    };
    expect(result.language).toBe('en');
    expect(result.reportCommitted).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
