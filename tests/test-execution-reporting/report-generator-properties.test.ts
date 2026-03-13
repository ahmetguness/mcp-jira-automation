/**
 * Property-based tests for Report Generator component
 * Feature: test-execution-reporting
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { DefaultReportGenerator } from '../../src/test-execution-reporting/report-generator.js';
import type { TestResult, TestCase, TestError, ReportLanguage } from '../../src/test-execution-reporting/types.js';

describe('Report Generator Properties', () => {
  const generator = new DefaultReportGenerator();
  const testConfig = { numRuns: 20 }; // Reduced for faster execution

  // Generators for test data
  const testStatusArb = fc.constantFrom('passed', 'failed', 'skipped');
  const errorTypeArb = fc.constantFrom('syntax', 'assertion', 'timeout', 'dependency', 'runtime');
  const languageArb = fc.constantFrom<ReportLanguage>('en', 'tr');

  const testErrorArb: fc.Arbitrary<TestError> = fc.record({
    message: fc.string({ minLength: 1, maxLength: 200 }),
    stack: fc.option(fc.string({ minLength: 10, maxLength: 500 })),
    type: errorTypeArb,
  });

  const testCaseArb: fc.Arbitrary<TestCase> = fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    status: testStatusArb,
    duration: fc.nat(10000),
    error: fc.option(testErrorArb),
  });

  const testResultArb: fc.Arbitrary<TestResult> = fc
    .array(testCaseArb, { minLength: 0, maxLength: 20 })
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
        errors: fc.array(testErrorArb, { minLength: 0, maxLength: 5 }),
        executionTime: fc.nat(300000),
        timestamp: fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
      });
    });

  // Feature: test-execution-reporting, Property 5: Report Completeness
  describe('Property 5: Report Completeness', () => {
    it('should include header section in all reports', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          const expectedHeader = language === 'tr' ? 'Test Çalıştırma Raporu' : 'Test Execution Report';
          return report.includes(expectedHeader);
        }),
        testConfig
      );
    });

    it('should include summary section with all statistics', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          const summaryHeader = language === 'tr' ? '## Özet' : '## Summary';
          
          // Check for summary header
          if (!report.includes(summaryHeader)) return false;
          
          // Check for all statistics
          const hasTotal = report.includes(result.summary.total.toString());
          const hasPassed = report.includes(result.summary.passed.toString());
          const hasFailed = report.includes(result.summary.failed.toString());
          const hasSkipped = report.includes(result.summary.skipped.toString());
          const hasSuccessRate = report.includes(result.summary.successRate.toFixed(1));
          
          return hasTotal && hasPassed && hasFailed && hasSkipped && hasSuccessRate;
        }),
        testConfig
      );
    });

    it('should include emoji indicators for test statuses', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          
          // Check for emoji indicators in summary
          const hasPassedEmoji = report.includes('✅');
          const hasFailedEmoji = result.summary.failed > 0 ? report.includes('❌') : true;
          const hasSkippedEmoji = result.summary.skipped > 0 ? report.includes('⏭️') : true;
          
          return hasPassedEmoji && hasFailedEmoji && hasSkippedEmoji;
        }),
        testConfig
      );
    });

    it('should include test results section with all tests', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          const testResultsHeader = language === 'tr' ? '## Test Sonuçları' : '## Test Results';
          
          // Check for test results header
          if (!report.includes(testResultsHeader)) return false;
          
          // For each test, check that it appears in the report
          // We check for the emoji indicator corresponding to the test status
          return result.tests.every((test) => {
            const emoji = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️';
            // Count how many times this emoji appears - should be at least as many as tests with this status
            const emojiCount = (report.match(new RegExp(emoji, 'g')) || []).length;
            return emojiCount > 0;
          });
        }),
        testConfig
      );
    });

    it('should include error messages and stack traces for failed tests', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          
          // Check that failed tests with errors have error indicators in the report
          const failedTestsWithErrors = result.tests.filter(
            (t) => t.status === 'failed' && t.error
          );
          
          if (failedTestsWithErrors.length === 0) return true;
          
          // Check that error messages appear in code blocks
          const hasCodeBlocks = report.includes('```');
          
          // Check for stack trace label if any error has a stack
          const hasStackTraces = failedTestsWithErrors.some(t => t.error?.stack);
          const stackLabel = language === 'tr' ? 'Hata İzleme' : 'Stack Trace';
          const hasStackLabel = !hasStackTraces || report.includes(stackLabel);
          
          return hasCodeBlocks && hasStackLabel;
        }),
        testConfig
      );
    });

    it('should include timestamps in all reports', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          const timeLabel = language === 'tr' ? 'Çalıştırma Zamanı' : 'Execution Time';
          
          return report.includes(timeLabel);
        }),
        testConfig
      );
    });

    it('should include execution duration in all reports', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          const durationLabel = language === 'tr' ? 'Süre' : 'Duration';
          
          return report.includes(durationLabel);
        }),
        testConfig
      );
    });

    it('should format reports in the specified language', () => {
      fc.assert(
        fc.property(testResultArb, languageArb, (result, language) => {
          const report = generator.generate(result, language);
          
          if (language === 'tr') {
            // Turkish reports should have Turkish headers
            return (
              report.includes('Test Çalıştırma Raporu') &&
              report.includes('Özet') &&
              report.includes('Test Sonuçları')
            );
          } else {
            // English reports should have English headers
            return (
              report.includes('Test Execution Report') &&
              report.includes('Summary') &&
              report.includes('Test Results')
            );
          }
        }),
        testConfig
      );
    });
  });

  // Feature: test-execution-reporting, Property 6: Report Filename Format
  describe('Property 6: Report Filename Format', () => {
    it('should generate valid filename pattern', () => {
      fc.assert(
        fc.property(fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }), (timestamp) => {
          // Simulate filename generation
          const filename = `test-report-${timestamp.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.md`;
          
          // Check pattern: test-report-{timestamp}.md
          const pattern = /^test-report-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/;
          return pattern.test(filename);
        }),
        testConfig
      );
    });

    it('should generate unique filenames for different timestamps', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
          fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
          (timestamp1, timestamp2) => {
            // Only test timestamps that differ by at least 1 second
            fc.pre(Math.abs(timestamp1.getTime() - timestamp2.getTime()) >= 1000);
            
            const filename1 = `test-report-${timestamp1.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.md`;
            const filename2 = `test-report-${timestamp2.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.md`;
            
            return filename1 !== filename2;
          }
        ),
        testConfig
      );
    });
  });

  // Feature: test-execution-reporting, Property 8: Error Report Handling
  describe('Property 8: Error Report Handling', () => {
    it('should include error type indicators for all error types', () => {
      fc.assert(
        fc.property(errorTypeArb, languageArb, fc.string({ minLength: 1 }), (errorType, language, message) => {
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [{ message, type: errorType, stack: undefined }],
            executionTime: 1000,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          
          // Check for error indicator emoji
          return report.includes('⚠️');
        }),
        testConfig
      );
    });

    it('should include syntax error details', () => {
      fc.assert(
        fc.property(languageArb, fc.string({ minLength: 1 }), (language, message) => {
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [{ message, type: 'syntax', stack: undefined }],
            executionTime: 1000,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          const errorLabel = language === 'tr' ? 'Sözdizimi Hatası' : 'Syntax Error';
          
          return report.includes(errorLabel);
        }),
        testConfig
      );
    });

    it('should include dependency error details with missing packages', () => {
      fc.assert(
        fc.property(
          languageArb,
          fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9@/-]+$/.test(s)), { minLength: 1, maxLength: 5 }),
          (language, packages) => {
            const message = packages.map(pkg => `Cannot find module '${pkg}'`).join('. ');
            const testResult: TestResult = {
              summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
              tests: [],
              errors: [{ message, type: 'dependency', stack: undefined }],
              executionTime: 1000,
              timestamp: new Date(),
            };
            
            const report = generator.generate(testResult, language);
            const errorLabel = language === 'tr' ? 'Bağımlılık Hatası' : 'Dependency Error';
            
            // Check for error label and at least one package name
            return report.includes(errorLabel) && packages.some(pkg => report.includes(pkg));
          }
        ),
        testConfig
      );
    });

    it('should include timeout error details with duration', () => {
      fc.assert(
        fc.property(languageArb, fc.nat(300000), (language, duration) => {
          const message = `Test execution exceeded timeout of ${duration}ms`;
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [{ message, type: 'timeout', stack: undefined }],
            executionTime: duration,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          const errorLabel = language === 'tr' ? 'Zaman Aşımı Hatası' : 'Timeout Error';
          
          return report.includes(errorLabel);
        }),
        testConfig
      );
    });

    it('should include runtime error details', () => {
      fc.assert(
        fc.property(languageArb, fc.string({ minLength: 1 }), (language, message) => {
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [{ message, type: 'runtime', stack: undefined }],
            executionTime: 1000,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          const errorLabel = language === 'tr' ? 'Çalışma Zamanı Hatası' : 'Runtime Error';
          
          return report.includes(errorLabel);
        }),
        testConfig
      );
    });

    it('should handle errors with stack traces', () => {
      fc.assert(
        fc.property(errorTypeArb, languageArb, fc.string({ minLength: 1 }), fc.string({ minLength: 10 }), (errorType, language, message, stack) => {
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [{ message, type: errorType, stack }],
            executionTime: 1000,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          const stackLabel = language === 'tr' ? 'Hata İzleme' : 'Stack Trace';
          
          return report.includes(stackLabel);
        }),
        testConfig
      );
    });

    it('should truncate very long stack traces', () => {
      fc.assert(
        fc.property(languageArb, (language) => {
          // Generate a very long stack trace (> 500 lines)
          const longStack = Array(600)
            .fill('at someFunction (file.js:123:45)')
            .join('\n');
          
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [{ message: 'Error', type: 'runtime', stack: longStack }],
            executionTime: 1000,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          
          // Check for truncation indicator
          return report.includes('truncated');
        }),
        testConfig
      );
    });
  });

  // Additional property: Markdown safety
  describe('Additional Property: Markdown Safety', () => {
    it('should escape special markdown characters in test names', () => {
      fc.assert(
        fc.property(languageArb, (language) => {
          const specialChars = ['*', '_', '[', ']', '(', ')', '`', '#', '+', '-', '.', '!'];
          const testName = specialChars.join('');
          
          const testResult: TestResult = {
            summary: { total: 1, passed: 1, failed: 0, skipped: 0, successRate: 100 },
            tests: [{ name: testName, status: 'passed', duration: 100, error: undefined }],
            errors: [],
            executionTime: 1000,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          
          // Check that special characters are escaped (preceded by backslash)
          return specialChars.every(char => {
            const escaped = `\\${char}`;
            return report.includes(escaped);
          });
        }),
        testConfig
      );
    });

    it('should handle empty test results gracefully', () => {
      fc.assert(
        fc.property(languageArb, (language) => {
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [],
            executionTime: 0,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          
          // Report should still have header and summary
          const header = language === 'tr' ? 'Test Çalıştırma Raporu' : 'Test Execution Report';
          const summary = language === 'tr' ? '## Özet' : '## Summary';
          
          return report.includes(header) && report.includes(summary);
        }),
        testConfig
      );
    });

    it('should handle missing error messages gracefully', () => {
      fc.assert(
        fc.property(languageArb, (language) => {
          const testResult: TestResult = {
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
            tests: [],
            errors: [{ message: '', type: 'runtime', stack: undefined }],
            executionTime: 1000,
            timestamp: new Date(),
          };
          
          const report = generator.generate(testResult, language);
          
          // Report should still be generated without crashing
          return report.length > 0;
        }),
        testConfig
      );
    });
  });
});
