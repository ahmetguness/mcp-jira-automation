/**
 * Custom fast-check generators for test-execution-reporting
 * These generators create realistic test data for property-based testing
 */

import fc from 'fast-check';
import type {
  TestCase,
  TestError,
  TestResult,
  TestStatus,
  ErrorType,
  RawTestResult,
  TestFramework,
} from '../../src/test-execution-reporting/types.js';

/**
 * Generator for test status values
 */
export const testStatusArb = fc.constantFrom<TestStatus>('passed', 'failed', 'skipped');

/**
 * Generator for error types
 */
export const errorTypeArb = fc.constantFrom<ErrorType>('syntax', 'assertion', 'timeout', 'dependency', 'runtime');

/**
 * Generator for test frameworks
 */
export const testFrameworkArb = fc.constantFrom<TestFramework>('jest', 'mocha', 'vitest', 'node:test', 'unknown');

/**
 * Generator for test errors with various error types
 */
export const errorArb: fc.Arbitrary<TestError> = fc.record({
  message: fc.oneof(
    // Syntax errors
    fc.constant('SyntaxError: Unexpected token'),
    fc.constant('SyntaxError: Unexpected end of input'),
    fc.constant('SyntaxError: Invalid or unexpected token'),
    // Assertion errors
    fc.constant('AssertionError: expected 5 to equal 10'),
    fc.constant('AssertionError: Expected values to be strictly equal'),
    fc.constant('Error: expect(received).toBe(expected)'),
    // Timeout errors
    fc.constant('Error: Test exceeded timeout of 5000ms'),
    fc.constant('TimeoutError: Operation timed out'),
    // Dependency errors
    fc.constant('Error: Cannot find module "test-utils"'),
    fc.constant('Error: MODULE_NOT_FOUND'),
    fc.constant('Error: Cannot find module "@testing-library/react"'),
    // Runtime errors
    fc.constant('Error: Something went wrong'),
    fc.constant('TypeError: Cannot read property "foo" of undefined'),
    fc.constant('ReferenceError: x is not defined'),
    // Generic error message
    fc.string({ minLength: 10, maxLength: 200 })
  ),
  stack: fc.option(
    fc.oneof(
      fc.constant('at test.js:10:5\nat Object.<anonymous> (test.js:15:3)'),
      fc.constant('at TestExecutor.execute (executor.ts:45:12)'),
      fc.array(fc.string({ minLength: 20, maxLength: 80 }), { minLength: 3, maxLength: 20 })
        .map(lines => lines.join('\n'))
    )
  ),
  type: errorTypeArb,
});

/**
 * Generator for individual test cases
 */
export const testCaseArb: fc.Arbitrary<TestCase> = fc.record({
  name: fc.oneof(
    // Normal test names
    fc.string({ minLength: 5, maxLength: 100 }),
    // Test names with special characters
    fc.constant('should handle [special] characters'),
    fc.constant('test with *asterisks* and _underscores_'),
    fc.constant('test with `backticks` and (parentheses)'),
    // Test names with non-ASCII characters
    fc.constant('test with Turkish: ğüşıöç'),
    fc.constant('test with emoji: 🚀 ✅ ❌'),
    fc.constant('test with Chinese: 测试'),
  ),
  status: testStatusArb,
  duration: fc.nat(10000),
  error: fc.option(errorArb),
});

/**
 * Generator for test output data with realistic test results
 */
export const testOutputArb: fc.Arbitrary<TestResult> = fc
  .array(testCaseArb, { minLength: 0, maxLength: 50 })
  .chain((tests) => {
    const passed = tests.filter((t) => t.status === 'passed').length;
    const failed = tests.filter((t) => t.status === 'failed').length;
    const skipped = tests.filter((t) => t.status === 'skipped').length;
    const total = tests.length;
    const successRate = total > 0 ? (passed / total) * 100 : 0;

    return fc.record({
      summary: fc.constant({
        total,
        passed,
        failed,
        skipped,
        successRate,
      }),
      tests: fc.constant(tests),
      errors: fc.array(errorArb, { minLength: 0, maxLength: 5 }),
      executionTime: fc.nat(300000),
      timestamp: fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
    });
  });

/**
 * Generator for Jira task content with Turkish, English, or mixed text
 */
export const jiraTaskArb = fc.oneof(
  // Pure Turkish content
  fc.tuple(
    fc.constantFrom('ğ', 'ü', 'ş', 'ı', 'ö', 'ç', 'Ğ', 'Ü', 'Ş', 'İ', 'Ö', 'Ç'),
    fc.constantFrom('hata', 'başarılı', 'başarısız', 'çalıştır', 'testler', 'sonuç', 'rapor', 'geliştirme'),
    fc.array(fc.constantFrom('test', 'kod', 'sistem', 'veri'), { minLength: 2, maxLength: 5 })
  ).map(([char, word, words]) => {
    return `${char.repeat(3)} ${word} ${words.join(' ')} ${char.repeat(2)}`;
  }),
  
  // Pure English content
  fc.array(
    fc.constantFrom('test', 'error', 'success', 'failure', 'run', 'execute', 'result', 'report', 'development'),
    { minLength: 5, maxLength: 15 }
  ).map(words => words.join(' ')),
  
  // Mixed Turkish-English content
  fc.tuple(
    fc.constantFrom('test', 'hata', 'error', 'başarılı', 'success'),
    fc.constantFrom('ğüşıöç', 'development', 'çalıştır', 'execute'),
    fc.array(fc.constantFrom('kod', 'code', 'sistem', 'system'), { minLength: 2, maxLength: 5 })
  ).map(([word1, word2, words]) => {
    return `${word1} ${word2} ${words.join(' ')}`;
  }),
  
  // Empty or whitespace content
  fc.constantFrom('', '   ', '\n\n', '\t\t'),
  
  // Ambiguous content (neutral words)
  fc.array(
    fc.constantFrom('data', 'file', 'process', 'value', 'item', 'object'),
    { minLength: 1, maxLength: 5 }
  ).map(words => words.join(' '))
);

/**
 * Generator for test files with framework indicators
 */
export const testFileArb = fc.record({
  path: fc.oneof(
    fc.constant('test.test.ts'),
    fc.constant('example.spec.js'),
    fc.constant('integration.test.tsx'),
    fc.constant('unit.spec.jsx'),
    // Non-ASCII filenames
    fc.constant('türkçe-test.test.ts'),
    fc.constant('测试.test.js'),
    fc.constant('тест.spec.ts'),
  ),
  content: fc.oneof(
    // Jest test file
    fc.constant(`
      import { describe, test, expect } from '@jest/globals';
      describe('test suite', () => {
        test('should pass', () => {
          expect(true).toBe(true);
        });
      });
    `),
    // Mocha test file
    fc.constant(`
      const { describe, it } = require('mocha');
      const { expect } = require('chai');
      describe('test suite', () => {
        it('should pass', () => {
          expect(true).to.be.true;
        });
      });
    `),
    // Vitest test file
    fc.constant(`
      import { describe, test, expect } from 'vitest';
      describe('test suite', () => {
        test('should pass', () => {
          expect(true).toBe(true);
        });
      });
    `),
    // Node.js test runner
    fc.constant(`
      import { test } from 'node:test';
      import assert from 'node:assert';
      test('should pass', () => {
        assert.strictEqual(true, true);
      });
    `),
    // Empty test file
    fc.constant(''),
    // Test file with only comments
    fc.constant('// This is a test file\n/* No actual tests */'),
  ),
  framework: testFrameworkArb,
});

/**
 * Generator for raw test results from test execution
 */
export const rawTestResultArb: fc.Arbitrary<RawTestResult> = fc.record({
  exitCode: fc.oneof(
    fc.constant(0), // Success
    fc.constant(1), // Failure
    fc.nat(255)     // Any exit code
  ),
  stdout: fc.oneof(
    fc.string({ minLength: 0, maxLength: 1000 }),
    fc.constant(''),
    // Very large output
    fc.constant('x'.repeat(10000)),
  ),
  stderr: fc.oneof(
    fc.string({ minLength: 0, maxLength: 500 }),
    fc.constant(''),
  ),
  duration: fc.nat(300000),
  framework: testFrameworkArb,
  timedOut: fc.boolean(),
  timestamp: fc.nat().map(() => Date.now()),
});
