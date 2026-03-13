/**
 * Unit tests for Report Generator component
 */

import { describe, it, expect } from 'vitest';
import { DefaultReportGenerator } from '../../src/test-execution-reporting/report-generator.js';
import type { TestResult } from '../../src/test-execution-reporting/types.js';

describe('Report Generator', () => {
  const generator = new DefaultReportGenerator();

  describe('English Reports', () => {
    it('should generate a complete English report for successful tests', () => {
      const testResult: TestResult = {
        summary: {
          total: 3,
          passed: 3,
          failed: 0,
          skipped: 0,
          successRate: 100,
        },
        tests: [
          { name: 'test 1', status: 'passed', duration: 100, error: undefined },
          { name: 'test 2', status: 'passed', duration: 200, error: undefined },
          { name: 'test 3', status: 'passed', duration: 150, error: undefined },
        ],
        errors: [],
        executionTime: 450,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('# Test Execution Report');
      expect(report).toContain('## Summary');
      expect(report).toContain('**Total Tests**: 3');
      expect(report).toContain('**Passed**: 3 ✅');
      expect(report).toContain('**Failed**: 0 ❌');
      expect(report).toContain('**Success Rate**: 100.0%');
      expect(report).toContain('## Test Results');
      expect(report).toContain('### Passed Tests');
      expect(report).toContain('✅ test 1 (100ms)');
      expect(report).toContain('✅ test 2 (200ms)');
      expect(report).toContain('✅ test 3 (150ms)');
    });

    it('should generate a report with failed tests and error details', () => {
      const testResult: TestResult = {
        summary: {
          total: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          successRate: 50,
        },
        tests: [
          { name: 'passing test', status: 'passed', duration: 100, error: undefined },
          {
            name: 'failing test',
            status: 'failed',
            duration: 200,
            error: {
              message: 'Expected 5 to equal 10',
              stack: 'at test.js:10:5\nat run.js:20:10',
              type: 'assertion',
            },
          },
        ],
        errors: [],
        executionTime: 300,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('### Failed Tests');
      expect(report).toContain('❌ failing test (200ms)');
      expect(report).toContain('Expected 5 to equal 10');
      expect(report).toContain('Stack Trace:');
      expect(report).toContain('at test.js:10:5');
    });

    it('should generate a report with skipped tests', () => {
      const testResult: TestResult = {
        summary: {
          total: 3,
          passed: 1,
          failed: 0,
          skipped: 2,
          successRate: 33.33,
        },
        tests: [
          { name: 'passing test', status: 'passed', duration: 100, error: undefined },
          { name: 'skipped test 1', status: 'skipped', duration: 0, error: undefined },
          { name: 'skipped test 2', status: 'skipped', duration: 0, error: undefined },
        ],
        errors: [],
        executionTime: 100,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('### Skipped Tests');
      expect(report).toContain('⏭️ skipped test 1 (0ms)');
      expect(report).toContain('⏭️ skipped test 2 (0ms)');
    });

    it('should generate error report for syntax errors', () => {
      const testResult: TestResult = {
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          successRate: 0,
        },
        tests: [],
        errors: [
          {
            message: 'SyntaxError: Unexpected token }',
            stack: 'at test.js:5:10',
            type: 'syntax',
          },
        ],
        executionTime: 0,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('## Errors');
      expect(report).toContain('⚠️ **Syntax Error**');
      expect(report).toContain('SyntaxError: Unexpected token }');
    });

    it('should generate error report for dependency errors', () => {
      const testResult: TestResult = {
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          successRate: 0,
        },
        tests: [],
        errors: [
          {
            message: "Cannot find module 'express'. Cannot find module 'lodash'.",
            stack: undefined,
            type: 'dependency',
          },
        ],
        executionTime: 0,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('⚠️ **Dependency Error**');
      expect(report).toContain('**Missing Dependencies:** express, lodash');
    });

    it('should generate error report for timeout errors', () => {
      const testResult: TestResult = {
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          successRate: 0,
        },
        tests: [],
        errors: [
          {
            message: 'Test execution exceeded timeout of 5000ms',
            stack: undefined,
            type: 'timeout',
          },
        ],
        executionTime: 5000,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('⚠️ **Timeout Error**');
      expect(report).toContain('**Execution Duration:** 5000ms');
    });
  });

  describe('Turkish Reports', () => {
    it('should generate a complete Turkish report', () => {
      const testResult: TestResult = {
        summary: {
          total: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          successRate: 50,
        },
        tests: [
          { name: 'başarılı test', status: 'passed', duration: 100, error: undefined },
          {
            name: 'başarısız test',
            status: 'failed',
            duration: 200,
            error: {
              message: 'Beklenen değer 5, alınan 10',
              stack: undefined,
              type: 'assertion',
            },
          },
        ],
        errors: [],
        executionTime: 300,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'tr');

      expect(report).toContain('# Test Çalıştırma Raporu');
      expect(report).toContain('## Özet');
      expect(report).toContain('**Toplam Test**: 2');
      expect(report).toContain('**Başarılı**: 1 ✅');
      expect(report).toContain('**Başarısız**: 1 ❌');
      expect(report).toContain('**Başarı Oranı**: 50.0%');
      expect(report).toContain('## Test Sonuçları');
      expect(report).toContain('### Başarılı Testler');
      expect(report).toContain('### Başarısız Testler');
    });

    it('should generate Turkish error report', () => {
      const testResult: TestResult = {
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          successRate: 0,
        },
        tests: [],
        errors: [
          {
            message: 'Sözdizimi hatası',
            stack: undefined,
            type: 'syntax',
          },
        ],
        executionTime: 0,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'tr');

      expect(report).toContain('## Hatalar');
      expect(report).toContain('⚠️ **Sözdizimi Hatası**');
    });
  });

  describe('Markdown Safety', () => {
    it('should escape special markdown characters in test names', () => {
      const testResult: TestResult = {
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          successRate: 100,
        },
        tests: [
          {
            name: 'test with *asterisks* and [brackets] and `backticks`',
            status: 'passed',
            duration: 100,
            error: undefined,
          },
        ],
        errors: [],
        executionTime: 100,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('\\*');
      expect(report).toContain('\\[');
      expect(report).toContain('\\]');
      expect(report).toContain('\\`');
    });

    it('should truncate very long stack traces', () => {
      const longStack = Array(600)
        .fill('at someFunction (file.js:123:45)')
        .join('\n');

      const testResult: TestResult = {
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          successRate: 0,
        },
        tests: [],
        errors: [
          {
            message: 'Error',
            stack: longStack,
            type: 'runtime',
          },
        ],
        executionTime: 0,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('truncated');
      expect(report).toContain('100 more lines');
    });
  });

  describe('Duration Formatting', () => {
    it('should format milliseconds correctly', () => {
      const testResult: TestResult = {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
        tests: [],
        errors: [],
        executionTime: 500,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');
      expect(report).toContain('500ms');
    });

    it('should format seconds correctly', () => {
      const testResult: TestResult = {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
        tests: [],
        errors: [],
        executionTime: 5500,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');
      expect(report).toContain('5s 500ms');
    });

    it('should format minutes correctly', () => {
      const testResult: TestResult = {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
        tests: [],
        errors: [],
        executionTime: 125000,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');
      expect(report).toContain('2m 5s');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty test results', () => {
      const testResult: TestResult = {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
        tests: [],
        errors: [],
        executionTime: 0,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('# Test Execution Report');
      expect(report).toContain('## Summary');
      expect(report).toContain('**Total Tests**: 0');
    });

    it('should handle invalid dates gracefully', () => {
      const testResult: TestResult = {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
        tests: [],
        errors: [],
        executionTime: 0,
        timestamp: new Date('invalid'),
      };

      const report = generator.generate(testResult, 'en');

      expect(report).toContain('Invalid Date');
    });
  });
});
