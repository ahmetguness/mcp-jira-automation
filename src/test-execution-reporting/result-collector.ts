/**
 * Result Collector Component
 * 
 * Responsible for parsing raw test output and extracting structured results.
 * 
 * Features:
 * - Framework-specific parsers (Jest, Mocha, Vitest, Node.js test runner)
 * - Fallback regex-based parser for non-JSON output
 * - Error extraction and categorization
 * - Statistics calculation with success rate
 */

import type { ResultCollector, RawTestResult, TestResult, TestCase, TestError, TestSummary, ErrorType } from './types.js';

export class DefaultResultCollector implements ResultCollector {
  collect(rawResult: RawTestResult): TestResult {
    const timestamp = new Date();
    let tests: TestCase[];
    let errors: TestError[];

    // Try framework-specific parser first
    try {
      const parsed = this.parseByFramework(rawResult);
      tests = parsed.tests;
      errors = parsed.errors;
    } catch {
      // Fall back to regex-based parsing
      const fallbackParsed = this.parseFallback(rawResult);
      tests = fallbackParsed.tests;
      errors = fallbackParsed.errors;
    }

    // Calculate summary statistics
    const summary = this.calculateStatistics(tests);

    return {
      summary,
      tests,
      errors,
      executionTime: rawResult.duration,
      timestamp,
    };
  }

  /**
   * Parse test output using framework-specific parser
   */
  private parseByFramework(rawResult: RawTestResult): { tests: TestCase[]; errors: TestError[] } {
    switch (rawResult.framework) {
      case 'jest':
        return this.parseJest(rawResult);
      case 'mocha':
        return this.parseMocha(rawResult);
      case 'vitest':
        return this.parseVitest(rawResult);
      case 'node:test':
        return this.parseNodeTest(rawResult);
      default:
        throw new Error('Unknown framework, falling back to regex parser');
    }
  }

  /**
   * Parse Jest JSON output (--json flag)
   */
  private parseJest(rawResult: RawTestResult): { tests: TestCase[]; errors: TestError[] } {
    const tests: TestCase[] = [];
    const errors: TestError[] = [];

    try {
      const jsonOutput = JSON.parse(rawResult.stdout);

      // Extract tests from testResults
      for (const testSuite of jsonOutput.testResults || []) {
        for (const assertion of testSuite.assertionResults || []) {
          const testName = assertion.fullName || assertion.title || 'Unknown test';
          const status = assertion.status === 'passed' ? 'passed' :
                        assertion.status === 'failed' ? 'failed' :
                        assertion.status === 'pending' || assertion.status === 'skipped' ? 'skipped' : 'failed';
          const duration = assertion.duration || 0;

          let error: TestError | undefined;
          if (status === 'failed' && assertion.failureMessages && assertion.failureMessages.length > 0) {
            const errorMessage = assertion.failureMessages.join('\n');
            error = this.extractError(errorMessage);
            errors.push(error);
          }

          tests.push({
            name: testName,
            status,
            duration,
            error,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error('Failed to parse Jest JSON output: ' + message, { cause: error });
    }

    return { tests, errors };
  }

  /**
   * Parse Mocha JSON output (--reporter json flag)
   */
  private parseMocha(rawResult: RawTestResult): { tests: TestCase[]; errors: TestError[] } {
    const tests: TestCase[] = [];
    const errors: TestError[] = [];

    try {
      const jsonOutput = JSON.parse(rawResult.stdout);

      // Mocha JSON format has tests, passes, failures, pending arrays
      const allTests = jsonOutput.tests || [];

      for (const test of allTests) {
        const testName = test.fullTitle || test.title || 'Unknown test';
        const status = test.pass ? 'passed' :
                      test.fail ? 'failed' :
                      test.pending ? 'skipped' : 'failed';
        const duration = test.duration || 0;

        let error: TestError | undefined;
        if (status === 'failed' && test.err) {
          const errorMessage = test.err.message || test.err.toString();
          const stack = test.err.stack;
          error = this.extractError(errorMessage, stack);
          errors.push(error);
        }

        tests.push({
          name: testName,
          status,
          duration,
          error,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error('Failed to parse Mocha JSON output: ' + message, { cause: error });
    }

    return { tests, errors };
  }

  /**
   * Parse Vitest JSON output (--reporter=json flag)
   */
  private parseVitest(rawResult: RawTestResult): { tests: TestCase[]; errors: TestError[] } {
    const tests: TestCase[] = [];
    const errors: TestError[] = [];

    try {
      const jsonOutput = JSON.parse(rawResult.stdout);

      // Vitest JSON format has testResults array
      const testResults = jsonOutput.testResults || [];

      for (const testFile of testResults) {
        for (const assertion of testFile.assertionResults || []) {
          const testName = assertion.fullName || assertion.title || 'Unknown test';
          const status = assertion.status === 'passed' ? 'passed' :
                        assertion.status === 'failed' ? 'failed' :
                        assertion.status === 'skipped' || assertion.status === 'todo' ? 'skipped' : 'failed';
          const duration = assertion.duration || 0;

          let error: TestError | undefined;
          if (status === 'failed' && assertion.failureMessages && assertion.failureMessages.length > 0) {
            const errorMessage = assertion.failureMessages.join('\n');
            error = this.extractError(errorMessage);
            errors.push(error);
          }

          tests.push({
            name: testName,
            status,
            duration,
            error,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error('Failed to parse Vitest JSON output: ' + message, { cause: error });
    }

    return { tests, errors };
  }

  /**
   * Parse Node.js test runner TAP output
   */
  private parseNodeTest(rawResult: RawTestResult): { tests: TestCase[]; errors: TestError[] } {
    const tests: TestCase[] = [];
    const errors: TestError[] = [];

    try {
      // Node.js test runner outputs TAP format
      const lines = rawResult.stdout.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        
        const trimmedLine = line.trim();

        // TAP format: "ok 1 - test name" or "not ok 1 - test name"
        const okMatch = trimmedLine.match(/^ok\s+\d+\s+-\s+(.+?)(?:\s+#\s+(.+))?$/);
        const notOkMatch = trimmedLine.match(/^not ok\s+\d+\s+-\s+(.+?)(?:\s+#\s+(.+))?$/);

        if (okMatch) {
          const testName = okMatch[1]?.trim() || '';
          // Skip if test name is empty or whitespace-only
          if (!testName) continue;
          
          const directive = okMatch[2];
          const status = directive && directive.toLowerCase().includes('skip') ? 'skipped' : 'passed';

          tests.push({
            name: testName,
            status,
            duration: 0, // TAP doesn't include duration by default
          });
        } else if (notOkMatch) {
          const testName = notOkMatch[1]?.trim() || '';
          // Skip if test name is empty or whitespace-only
          if (!testName) continue;
          
          const directive = notOkMatch[2];

          // Check if it's a skipped test
          if (directive && directive.toLowerCase().includes('skip')) {
            tests.push({
              name: testName,
              status: 'skipped',
              duration: 0,
            });
          } else {
            // Extract error from following lines (YAML block in TAP)
            let errorMessage = '';
            let stack = '';
            let j = i + 1;

            // Look for YAML block (starts with "  ---" and ends with "  ...")
            if (j < lines.length && lines[j]?.trim() === '---') {
              j++;
              while (j < lines.length && lines[j]?.trim() !== '...' && lines[j]?.trim() !== '') {
                const errorLine = lines[j];
                if (errorLine && errorLine.includes('message:')) {
                  errorMessage = errorLine.split('message:')[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
                } else if (errorLine && errorLine.includes('stack:')) {
                  // Stack might be multi-line
                  stack = errorLine.split('stack:')[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
                }
                j++;
              }
            }

            const error = this.extractError(errorMessage || 'Test failed', stack);
            errors.push(error);

            tests.push({
              name: testName,
              status: 'failed',
              duration: 0,
              error,
            });
          }
        }
      }
    } catch (error) {
      throw new Error('Failed to parse Node.js test runner TAP output: ' + (error instanceof Error ? error.message : String(error)), { cause: error });
    }

    return { tests, errors };
  }

  /**
   * Fallback regex-based parser for when JSON output is unavailable
   */
  private parseFallback(rawResult: RawTestResult): { tests: TestCase[]; errors: TestError[] } {
    const tests: TestCase[] = [];
    const errors: TestError[] = [];

    const output = rawResult.stdout + '\n' + rawResult.stderr;
    const lines = output.split('\n');

    // Common test output patterns
    const passPatterns = [
      /✓\s+(.+?)(?:\s+\((\d+)ms\))?$/,           // ✓ test name (123ms)
      /✔\s+(.+?)(?:\s+\((\d+)ms\))?$/,           // ✔ test name (123ms)
      /PASS\s+(.+?)(?:\s+\((\d+)ms\))?$/i,       // PASS test name (123ms)
      /\s+ok\s+\d+\s+(.+?)(?:\s+\((\d+)ms\))?$/, // ok 1 test name (123ms)
    ];

    const failPatterns = [
      /✗\s+(.+?)(?:\s+\((\d+)ms\))?$/,           // ✗ test name (123ms)
      /✖\s+(.+?)(?:\s+\((\d+)ms\))?$/,           // ✖ test name (123ms)
      /FAIL\s+(.+?)(?:\s+\((\d+)ms\))?$/i,       // FAIL test name (123ms)
      /\s+not ok\s+\d+\s+(.+?)(?:\s+\((\d+)ms\))?$/, // not ok 1 test name (123ms)
    ];

    const skipPatterns = [
      /⏭\s+(.+?)(?:\s+\((\d+)ms\))?$/,           // ⏭ test name (123ms)
      /SKIP\s+(.+?)(?:\s+\((\d+)ms\))?$/i,       // SKIP test name (123ms)
      /\s+ok\s+\d+\s+(.+?)\s+#\s*skip/i,         // ok 1 test name # skip
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for passed tests
      for (const pattern of passPatterns) {
        const match = line?.match(pattern);
        if (match) {
          tests.push({
            name: match[1]?.trim() || 'Unknown test',
            status: 'passed',
            duration: match[2] ? parseInt(match[2], 10) : 0,
          });
          break;
        }
      }

      // Check for failed tests
      for (const pattern of failPatterns) {
        const match = line?.match(pattern);
        if (match) {
          const testName = match[1]?.trim() || 'Unknown test';
          const duration = match[2] ? parseInt(match[2], 10) : 0;

          // Try to extract error from following lines
          let errorMessage = '';
          let stack = '';
          let j = i + 1;

          // Look for error message in next few lines
          while (j < lines.length && j < i + 20) {
            const errorLine = lines[j];
            if (errorLine && (errorLine.trim().startsWith('Error:') || errorLine.trim().includes('Expected'))) {
              errorMessage = errorLine.trim();
              // Collect stack trace
              j++;
              while (j < lines.length && j < i + 50 && lines[j] && (lines[j]?.trim().startsWith('at ') || lines[j]?.includes('    at '))) {
                stack += lines[j] + '\n';
                j++;
              }
              break;
            }
            j++;
          }

          const error = this.extractError(errorMessage || 'Test failed', stack);
          errors.push(error);

          tests.push({
            name: testName,
            status: 'failed',
            duration,
            error,
          });
          break;
        }
      }

      // Check for skipped tests
      for (const pattern of skipPatterns) {
        const match = line?.match(pattern);
        if (match) {
          tests.push({
            name: match[1]?.trim() || 'Unknown test',
            status: 'skipped',
            duration: match[2] ? parseInt(match[2], 10) : 0,
          });
          break;
        }
      }
    }

    // If no tests were found, check if there's an execution error
    if (tests.length === 0 && rawResult.exitCode !== 0) {
      const error = this.extractError(rawResult.stderr || 'Test execution failed');
      errors.push(error);
    }

    return { tests, errors };
  }

  /**
   * Extract error information and categorize error type
   */
  private extractError(message: string, stack?: string): TestError {
    const errorType = this.categorizeError(message, stack);

    return {
      message: message.trim(),
      stack: stack?.trim(),
      type: errorType,
    };
  }

  /**
   * Categorize error by analyzing error message and stack trace
   */
  private categorizeError(message: string, stack?: string): ErrorType {
    const combinedText = (message + ' ' + (stack || '')).toLowerCase();

    // Check for syntax errors
    if (
      combinedText.includes('syntaxerror') ||
      combinedText.includes('unexpected token') ||
      combinedText.includes('unexpected identifier') ||
      combinedText.includes('parsing error') ||
      combinedText.includes('parse error')
    ) {
      return 'syntax';
    }

    // Check for assertion errors
    if (
      combinedText.includes('assertionerror') ||
      combinedText.includes('expected') ||
      combinedText.includes('assertion') ||
      combinedText.includes('toBe') ||
      combinedText.includes('toEqual') ||
      combinedText.includes('should')
    ) {
      return 'assertion';
    }

    // Check for timeout errors
    if (
      combinedText.includes('timeout') ||
      combinedText.includes('exceeded') ||
      combinedText.includes('timed out')
    ) {
      return 'timeout';
    }

    // Check for dependency errors
    if (
      combinedText.includes('cannot find module') ||
      combinedText.includes('module_not_found') ||
      combinedText.includes('module not found') ||
      combinedText.includes('missing dependency') ||
      combinedText.includes('err_module_not_found')
    ) {
      return 'dependency';
    }

    // Default to runtime error
    return 'runtime';
  }

  /**
   * Calculate summary statistics from test cases
   */
  private calculateStatistics(tests: TestCase[]): TestSummary {
    const total = tests.length;
    const passed = tests.filter(t => t.status === 'passed').length;
    const failed = tests.filter(t => t.status === 'failed').length;
    const skipped = tests.filter(t => t.status === 'skipped').length;

    // Calculate success rate as (passed / total) × 100
    // Handle division by zero
    const successRate = total > 0 ? (passed / total) * 100 : 0;

    return {
      total,
      passed,
      failed,
      skipped,
      successRate,
    };
  }
}
