/**
 * Unit tests for Result Collector component
 */

import { describe, it, expect } from 'vitest';
import { DefaultResultCollector } from '../../src/test-execution-reporting/result-collector.js';
import type { RawTestResult } from '../../src/test-execution-reporting/types.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

describe('DefaultResultCollector', () => {
  const collector = new DefaultResultCollector();

  describe('Jest JSON parser', () => {
    it('should parse successful Jest JSON output', async () => {
      const fixtureContent = await readFile(
        resolve('tests/fixtures/test-execution-reporting/test-outputs/jest-success.json'),
        'utf-8'
      );

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: fixtureContent,
        stderr: '',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(3);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.skipped).toBe(0);
      expect(result.summary.successRate).toBe(100);
      expect(result.tests).toHaveLength(3);
      expect(result.tests[0]?.name).toBe('Calculator should add two numbers');
      expect(result.tests[0]?.status).toBe('passed');
      expect(result.tests[0]?.duration).toBe(5);
    });

    it('should parse failed Jest JSON output', async () => {
      const fixtureContent = await readFile(
        resolve('tests/fixtures/test-execution-reporting/test-outputs/jest-failure.json'),
        'utf-8'
      );

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: fixtureContent,
        stderr: '',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(3);
      expect(result.summary.passed).toBe(2);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.skipped).toBe(0);
      expect(result.summary.successRate).toBeCloseTo(66.67, 1);
      expect(result.tests).toHaveLength(3);
      
      const failedTest = result.tests.find(t => t.status === 'failed');
      expect(failedTest).toBeDefined();
      expect(failedTest?.name).toBe('Calculator should subtract two numbers');
      expect(failedTest?.error).toBeDefined();
      expect(failedTest?.error?.type).toBe('assertion');
      expect(failedTest?.error?.message).toContain('Expected: 5');
    });
  });

  describe('Mocha JSON parser', () => {
    it('should parse Mocha JSON output', () => {
      const mochaJson = {
        tests: [
          {
            title: 'should pass test 1',
            fullTitle: 'Suite should pass test 1',
            duration: 10,
            pass: true,
            fail: false,
            pending: false,
          },
          {
            title: 'should fail test 2',
            fullTitle: 'Suite should fail test 2',
            duration: 15,
            pass: false,
            fail: true,
            pending: false,
            err: {
              message: 'AssertionError: expected 5 to equal 10',
              stack: 'at Context.<anonymous> (test.js:10:15)',
            },
          },
          {
            title: 'should skip test 3',
            fullTitle: 'Suite should skip test 3',
            duration: 0,
            pass: false,
            fail: false,
            pending: true,
          },
        ],
      };

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: JSON.stringify(mochaJson),
        stderr: '',
        duration: 1000,
        framework: 'mocha',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(3);
      expect(result.summary.passed).toBe(1);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.skipped).toBe(1);
      expect(result.summary.successRate).toBeCloseTo(33.33, 1);
      expect(result.tests).toHaveLength(3);
      
      const failedTest = result.tests.find(t => t.status === 'failed');
      expect(failedTest?.error?.type).toBe('assertion');
    });
  });

  describe('Vitest JSON parser', () => {
    it('should parse Vitest JSON output', () => {
      const vitestJson = {
        testResults: [
          {
            assertionResults: [
              {
                title: 'should pass',
                fullName: 'Suite should pass',
                status: 'passed',
                duration: 5,
                failureMessages: [],
              },
              {
                title: 'should fail',
                fullName: 'Suite should fail',
                status: 'failed',
                duration: 8,
                failureMessages: ['Error: Test failed with assertion error'],
              },
            ],
          },
        ],
      };

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: JSON.stringify(vitestJson),
        stderr: '',
        duration: 1000,
        framework: 'vitest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(2);
      expect(result.summary.passed).toBe(1);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.successRate).toBe(50);
    });
  });

  describe('Node.js test runner TAP parser', () => {
    it('should parse TAP output with passed tests', () => {
      const tapOutput = `TAP version 13
ok 1 - should add numbers
ok 2 - should subtract numbers
ok 3 - should multiply numbers
1..3
# tests 3
# pass 3
# fail 0`;

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: tapOutput,
        stderr: '',
        duration: 1000,
        framework: 'node:test',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(3);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.successRate).toBe(100);
    });

    it('should parse TAP output with failed tests', () => {
      const tapOutput = `TAP version 13
ok 1 - should add numbers
not ok 2 - should subtract numbers
  ---
  message: 'Expected 5 but got 3'
  stack: 'at test.js:10:5'
  ...
ok 3 - should multiply numbers
1..3
# tests 3
# pass 2
# fail 1`;

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: tapOutput,
        stderr: '',
        duration: 1000,
        framework: 'node:test',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(3);
      expect(result.summary.passed).toBe(2);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.successRate).toBeCloseTo(66.67, 1);
      
      const failedTest = result.tests.find(t => t.status === 'failed');
      expect(failedTest?.error?.message).toContain('Expected 5 but got 3');
    });

    it('should parse TAP output with skipped tests', () => {
      const tapOutput = `TAP version 13
ok 1 - should add numbers
ok 2 - should subtract numbers # skip
ok 3 - should multiply numbers
1..3`;

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: tapOutput,
        stderr: '',
        duration: 1000,
        framework: 'node:test',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(3);
      expect(result.summary.passed).toBe(2);
      expect(result.summary.skipped).toBe(1);
    });
  });

  describe('Fallback regex parser', () => {
    it('should parse output with checkmark symbols', () => {
      const output = `
  ✓ test one (5ms)
  ✓ test two (3ms)
  ✗ test three (10ms)
  ⏭ test four (0ms)
`;

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: output,
        stderr: '',
        duration: 1000,
        framework: 'unknown',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(4);
      expect(result.summary.passed).toBe(2);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.skipped).toBe(1);
    });

    it('should parse output with PASS/FAIL keywords', () => {
      const output = `
PASS test one (5ms)
PASS test two (3ms)
FAIL test three (10ms)
SKIP test four
`;

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: output,
        stderr: '',
        duration: 1000,
        framework: 'unknown',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(4);
      expect(result.summary.passed).toBe(2);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.skipped).toBe(1);
    });

    it('should handle incomplete or malformed output', () => {
      const output = `Some random output
that doesn't match
any known pattern`;

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: output,
        stderr: 'Error: Something went wrong',
        duration: 1000,
        framework: 'unknown',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      // Should create an error entry even if no tests found
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Error categorization', () => {
    it('should categorize syntax errors', () => {
      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: '',
        stderr: 'SyntaxError: Unexpected token',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.type).toBe('syntax');
    });

    it('should categorize assertion errors', () => {
      const jestJson = {
        testResults: [
          {
            assertionResults: [
              {
                title: 'test',
                fullName: 'test',
                status: 'failed',
                duration: 5,
                failureMessages: ['AssertionError: expected 5 to equal 10'],
              },
            ],
          },
        ],
      };

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: JSON.stringify(jestJson),
        stderr: '',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.errors[0]?.type).toBe('assertion');
    });

    it('should categorize timeout errors', () => {
      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Test exceeded timeout of 5000ms',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.type).toBe('timeout');
    });

    it('should categorize dependency errors', () => {
      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Cannot find module "some-package"',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.type).toBe('dependency');
    });

    it('should categorize runtime errors', () => {
      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Something went wrong at runtime',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.type).toBe('runtime');
    });
  });

  describe('Statistics calculation', () => {
    it('should calculate correct success rate', () => {
      const jestJson = {
        testResults: [
          {
            assertionResults: [
              { title: 'test1', fullName: 'test1', status: 'passed', duration: 5, failureMessages: [] },
              { title: 'test2', fullName: 'test2', status: 'passed', duration: 5, failureMessages: [] },
              { title: 'test3', fullName: 'test3', status: 'failed', duration: 5, failureMessages: ['error'] },
              { title: 'test4', fullName: 'test4', status: 'passed', duration: 5, failureMessages: [] },
            ],
          },
        ],
      };

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: JSON.stringify(jestJson),
        stderr: '',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(4);
      expect(result.summary.passed).toBe(3);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.successRate).toBe(75);
    });

    it('should handle zero tests gracefully', () => {
      const jestJson = {
        testResults: [],
      };

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: JSON.stringify(jestJson),
        stderr: '',
        duration: 1000,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(0);
      expect(result.summary.passed).toBe(0);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.skipped).toBe(0);
      expect(result.summary.successRate).toBe(0);
    });
  });
});
