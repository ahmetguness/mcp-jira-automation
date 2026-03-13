/**
 * Property-based tests for Result Collector component
 * 
 * **Validates: Requirements 1.2, 2.1, 2.2, 2.3, 2.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DefaultResultCollector } from '../../src/test-execution-reporting/result-collector.js';
import type { RawTestResult, TestFramework, TestStatus } from '../../src/test-execution-reporting/types.js';

describe('Result Collector - Property-Based Tests', () => {
  const collector = new DefaultResultCollector();
  const testConfig = { numRuns: 20 }; // Reduced for faster execution

  // Custom arbitraries for domain-specific data
  const testStatusArb = fc.constantFrom<TestStatus>('passed', 'failed', 'skipped');
  const frameworkArb = fc.constantFrom<TestFramework>('jest', 'mocha', 'vitest', 'node:test', 'unknown');

  const testCaseArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    status: testStatusArb,
    duration: fc.nat(10000),
    hasError: fc.boolean(),
  });

  const jestJsonArb = (tests: Array<{ name: string; status: TestStatus; duration: number; hasError: boolean }>) => {
    return {
      testResults: [
        {
          assertionResults: tests.map(test => ({
            title: test.name,
            fullName: test.name,
            status: test.status,
            duration: test.duration,
            failureMessages: test.status === 'failed' && test.hasError
              ? ['AssertionError: Test failed']
              : [],
          })),
        },
      ],
    };
  };

  const mochaJsonArb = (tests: Array<{ name: string; status: TestStatus; duration: number; hasError: boolean }>) => {
    return {
      tests: tests.map(test => ({
        title: test.name,
        fullTitle: test.name,
        duration: test.duration,
        pass: test.status === 'passed',
        fail: test.status === 'failed',
        pending: test.status === 'skipped',
        err: test.status === 'failed' && test.hasError
          ? { message: 'Test failed', stack: 'at test.js:10:5' }
          : undefined,
      })),
    };
  };

  const vitestJsonArb = (tests: Array<{ name: string; status: TestStatus; duration: number; hasError: boolean }>) => {
    return {
      testResults: [
        {
          assertionResults: tests.map(test => ({
            title: test.name,
            fullName: test.name,
            status: test.status,
            duration: test.duration,
            failureMessages: test.status === 'failed' && test.hasError
              ? ['Error: Test failed']
              : [],
          })),
        },
      ],
    };
  };

  const tapOutputArb = (tests: Array<{ name: string; status: TestStatus; duration: number; hasError: boolean }>) => {
    // Filter out tests with whitespace-only names
    const validTests = tests.filter(t => t.name.trim().length > 0);
    
    let output = 'TAP version 13\n';
    validTests.forEach((test, index) => {
      if (test.status === 'passed') {
        output += `ok ${index + 1} - ${test.name}\n`;
      } else if (test.status === 'failed') {
        output += `not ok ${index + 1} - ${test.name}\n`;
        if (test.hasError) {
          output += '  ---\n';
          output += '  message: \'Test failed\'\n';
          output += '  stack: \'at test.js:10:5\'\n';
          output += '  ...\n';
        }
      } else if (test.status === 'skipped') {
        output += `ok ${index + 1} - ${test.name} # skip\n`;
      }
    });
    output += `1..${validTests.length}\n`;
    return output;
  };

  /**
   * Property 1: Complete Output Capture
   * 
   * For any test execution, the Result Collector should capture all test output
   * including test names, statuses, execution times, error messages, and stack traces,
   * while preserving the original output format.
   */
  describe('Property 1: Complete Output Capture', () => {
    it('should capture all test names from Jest output', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 20 }),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // All test names should be captured
            expect(result.tests.length).toBe(tests.length);
            tests.forEach((test, index) => {
              expect(result.tests[index]?.name).toBe(test.name);
            });
          }
        ),
        testConfig
      );
    });

    it('should capture all test statuses from Mocha output', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 20 }),
          (tests) => {
            const mochaJson = mochaJsonArb(tests);
            const rawResult: RawTestResult = {
              exitCode: 0,
              stdout: JSON.stringify(mochaJson),
              stderr: '',
              duration: 1000,
              framework: 'mocha',
              timedOut: false,
              timestamp: Date.now(),
            };

            const result = collector.collect(rawResult);

            // All test statuses should be captured correctly
            expect(result.tests.length).toBe(tests.length);
            tests.forEach((test, index) => {
              expect(result.tests[index]?.status).toBe(test.status);
            });
          }
        ),
        testConfig
      );
    });

    it('should capture all test durations from Vitest output', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 20 }),
          (tests) => {
            const vitestJson = vitestJsonArb(tests);
            const rawResult: RawTestResult = {
              exitCode: 0,
              stdout: JSON.stringify(vitestJson),
              stderr: '',
              duration: 1000,
              framework: 'vitest',
              timedOut: false,
              timestamp: Date.now(),
            };

            const result = collector.collect(rawResult);

            // All test durations should be captured
            expect(result.tests.length).toBe(tests.length);
            tests.forEach((test, index) => {
              expect(result.tests[index]?.duration).toBe(test.duration);
            });
          }
        ),
        testConfig
      );
    });

    it('should capture error messages for failed tests', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 20 }),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // Failed tests with errors should have error information
            const failedTests = tests.filter(t => t.status === 'failed' && t.hasError);
            const resultFailedTests = result.tests.filter(t => t.status === 'failed' && t.error);

            expect(resultFailedTests.length).toBe(failedTests.length);
            resultFailedTests.forEach(test => {
              expect(test.error).toBeDefined();
              expect(test.error?.message).toBeTruthy();
            });
          }
        ),
        testConfig
      );
    });

    it('should parse TAP output completely', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 20 }),
          (tests) => {
            // Filter out tests with whitespace-only names (parser skips these)
            const validTests = tests.filter(t => t.name.trim().length > 0);
            
            // Skip this test case if all test names are whitespace-only
            fc.pre(validTests.length > 0);
            
            const tapOutput = tapOutputArb(tests);
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
            
            // All valid tests should be captured from TAP output
            expect(result.tests.length).toBe(validTests.length);
            validTests.forEach((test, index) => {
              expect(result.tests[index]?.name).toBe(test.name.trim());
              expect(result.tests[index]?.status).toBe(test.status);
            });
          }
        ),
        testConfig
      );
    });
  });

  /**
   * Property 3: Statistics Calculation Correctness
   * 
   * For any test results, the calculated summary statistics (total tests, passed count,
   * failed count, success rate) should match the actual counts from the test results,
   * where success rate equals (passed / total) × 100.
   */
  describe('Property 3: Statistics Calculation Correctness', () => {
    it('should calculate correct total count', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 0, maxLength: 50 }),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // Total should match the number of tests
            expect(result.summary.total).toBe(tests.length);
          }
        ),
        testConfig
      );
    });

    it('should calculate correct passed count', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 50 }),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // Passed count should match the number of passed tests
            const expectedPassed = tests.filter(t => t.status === 'passed').length;
            expect(result.summary.passed).toBe(expectedPassed);
          }
        ),
        testConfig
      );
    });

    it('should calculate correct failed count', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 50 }),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // Failed count should match the number of failed tests
            const expectedFailed = tests.filter(t => t.status === 'failed').length;
            expect(result.summary.failed).toBe(expectedFailed);
          }
        ),
        testConfig
      );
    });

    it('should calculate correct skipped count', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 50 }),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // Skipped count should match the number of skipped tests
            const expectedSkipped = tests.filter(t => t.status === 'skipped').length;
            expect(result.summary.skipped).toBe(expectedSkipped);
          }
        ),
        testConfig
      );
    });

    it('should calculate correct success rate', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 50 }),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // Success rate should be (passed / total) × 100
            const expectedPassed = tests.filter(t => t.status === 'passed').length;
            const expectedSuccessRate = tests.length > 0 ? (expectedPassed / tests.length) * 100 : 0;
            
            expect(result.summary.successRate).toBeCloseTo(expectedSuccessRate, 2);
          }
        ),
        testConfig
      );
    });

    it('should handle zero tests correctly', () => {
      fc.assert(
        fc.property(
          fc.constant([] as Array<{ name: string; status: TestStatus; duration: number; hasError: boolean }>),
          (tests) => {
            const jestJson = jestJsonArb(tests);
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

            // With zero tests, all counts should be zero
            expect(result.summary.total).toBe(0);
            expect(result.summary.passed).toBe(0);
            expect(result.summary.failed).toBe(0);
            expect(result.summary.skipped).toBe(0);
            expect(result.summary.successRate).toBe(0);
          }
        ),
        testConfig
      );
    });

    it('should maintain count invariants across all frameworks', () => {
      fc.assert(
        fc.property(
          fc.array(testCaseArb, { minLength: 1, maxLength: 50 }),
          frameworkArb,
          (tests, framework) => {
            const stdout = framework === 'jest'
              ? JSON.stringify(jestJsonArb(tests))
              : framework === 'mocha'
              ? JSON.stringify(mochaJsonArb(tests))
              : framework === 'vitest'
              ? JSON.stringify(vitestJsonArb(tests))
              : framework === 'node:test'
              ? tapOutputArb(tests)
              : tests.map(t => {
                  if (t.status === 'passed') return `✓ ${t.name}`;
                  if (t.status === 'failed') return `✗ ${t.name}`;
                  return `⏭ ${t.name}`;
                }).join('\n');

            const rawResult: RawTestResult = {
              exitCode: 0,
              stdout,
              stderr: '',
              duration: 1000,
              framework,
              timedOut: false,
              timestamp: Date.now(),
            };

            const result = collector.collect(rawResult);

            // Invariant: total = passed + failed + skipped
            expect(result.summary.total).toBe(
              result.summary.passed + result.summary.failed + result.summary.skipped
            );

            // Invariant: success rate is between 0 and 100
            expect(result.summary.successRate).toBeGreaterThanOrEqual(0);
            expect(result.summary.successRate).toBeLessThanOrEqual(100);

            // Invariant: if all tests passed, success rate should be 100
            if (result.summary.failed === 0 && result.summary.skipped === 0 && result.summary.total > 0) {
              expect(result.summary.successRate).toBe(100);
            }

            // Invariant: if all tests failed, success rate should be 0
            if (result.summary.passed === 0 && result.summary.total > 0) {
              expect(result.summary.successRate).toBe(0);
            }
          }
        ),
        testConfig
      );
    });
  });

  describe('Error extraction and categorization', () => {
    it('should categorize errors consistently', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'SyntaxError: Unexpected token',
            'AssertionError: expected 5 to equal 10',
            'Error: Test exceeded timeout',
            'Error: Cannot find module "test"',
            'Error: Something went wrong'
          ),
          (errorMessage) => {
            const jestJson = {
              testResults: [
                {
                  assertionResults: [
                    {
                      title: 'test',
                      fullName: 'test',
                      status: 'failed',
                      duration: 5,
                      failureMessages: [errorMessage],
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

            // Error should be categorized
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]?.type).toBeDefined();
            expect(['syntax', 'assertion', 'timeout', 'dependency', 'runtime']).toContain(result.errors[0]?.type);
          }
        ),
        testConfig
      );
    });
  });
});
