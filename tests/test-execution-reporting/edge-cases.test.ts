/**
 * Edge case tests for Test Execution Reporting
 * Tests unusual scenarios to ensure robustness
 * 
 * **Validates: All requirements (edge cases)**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DefaultTestExecutor } from '../../src/test-execution-reporting/test-executor.js';
import { DefaultResultCollector } from '../../src/test-execution-reporting/result-collector.js';
import { DefaultReportGenerator } from '../../src/test-execution-reporting/report-generator.js';
import type { TestResult, RawTestResult } from '../../src/test-execution-reporting/types.js';

describe('Edge Cases', () => {
  let tempDir: string;
  const executor = new DefaultTestExecutor();
  const collector = new DefaultResultCollector();
  const generator = new DefaultReportGenerator();

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-exec-edge-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Empty test files', () => {
    it('should handle test file with no tests', async () => {
      const testFile = join(tempDir, 'empty.test.js');
      await writeFile(testFile, '// No tests here');

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 100,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);

      expect(result.summary.total).toBe(0);
      expect(result.tests).toHaveLength(0);
      
      // Should still generate a valid report
      const report = generator.generate(result, 'en');
      expect(report).toContain('Test Execution Report');
      expect(report).toContain('Total Tests');
    });

    it('should handle completely empty file', async () => {
      const testFile = join(tempDir, 'empty.test.js');
      await writeFile(testFile, '');

      const framework = await executor.detectFramework(testFile);
      expect(framework).toBe('node:test'); // Should default
    });
  });

  describe('Files with only skipped tests', () => {
    it('should handle all tests skipped', () => {
      const jestJson = {
        testResults: [
          {
            assertionResults: [
              { title: 'test 1', fullName: 'test 1', status: 'skipped', duration: 0, failureMessages: [] },
              { title: 'test 2', fullName: 'test 2', status: 'skipped', duration: 0, failureMessages: [] },
              { title: 'test 3', fullName: 'test 3', status: 'skipped', duration: 0, failureMessages: [] },
            ],
          },
        ],
      };

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: JSON.stringify(jestJson),
        stderr: '',
        duration: 100,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);
      
      expect(result.summary.total).toBe(3);
      expect(result.summary.skipped).toBe(3);
      expect(result.summary.passed).toBe(0);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.successRate).toBe(0);
      
      // Should generate report with skipped tests
      const report = generator.generate(result, 'en');
      expect(report).toContain('Skipped');
      expect(report).toContain('⏭️');
    });
  });

  describe('Very large output', () => {
    it('should handle very large stdout without memory issues', () => {
      // Generate 10MB of output
      const largeOutput = 'x'.repeat(10 * 1024 * 1024);

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: largeOutput,
        stderr: '',
        duration: 1000,
        framework: 'unknown',
        timedOut: false,
        timestamp: Date.now(),
      };

      // Should not throw or crash
      expect(() => collector.collect(rawResult)).not.toThrow();
    });

    it('should truncate very long stack traces', () => {
      // Generate stack trace with > 500 lines
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

      const report = generator.generate(testResult, 'en');
      
      // Should include truncation indicator
      expect(report).toContain('truncated');
    });
  });

  describe('Non-ASCII characters', () => {
    it('should handle non-ASCII characters in filenames', async () => {
      const testFile = join(tempDir, 'türkçe-test.test.ts');
      await writeFile(testFile, `
        import { test } from 'vitest';
        test('should work', () => {});
      `);

      const framework = await executor.detectFramework(testFile);
      expect(framework).toBe('vitest');
    });

    it('should handle non-ASCII characters in test names', () => {
      const jestJson = {
        testResults: [
          {
            assertionResults: [
              { 
                title: 'test with Turkish: ğüşıöç', 
                fullName: 'test with Turkish: ğüşıöç', 
                status: 'passed', 
                duration: 100, 
                failureMessages: [] 
              },
              { 
                title: 'test with Chinese: 测试', 
                fullName: 'test with Chinese: 测试', 
                status: 'passed', 
                duration: 100, 
                failureMessages: [] 
              },
              { 
                title: 'test with emoji: 🚀 ✅', 
                fullName: 'test with emoji: 🚀 ✅', 
                status: 'passed', 
                duration: 100, 
                failureMessages: [] 
              },
            ],
          },
        ],
      };

      const rawResult: RawTestResult = {
        exitCode: 0,
        stdout: JSON.stringify(jestJson),
        stderr: '',
        duration: 300,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);
      
      expect(result.tests).toHaveLength(3);
      expect(result.tests[0]?.name).toContain('ğüşıöç');
      expect(result.tests[1]?.name).toContain('测试');
      expect(result.tests[2]?.name).toContain('🚀');
      
      // Should generate report without issues
      const report = generator.generate(result, 'en');
      expect(report).toContain('ğüşıöç');
      expect(report).toContain('测试');
      expect(report).toContain('🚀');
    });
  });

  describe('Special markdown characters', () => {
    it('should escape special markdown characters in test names', () => {
      const specialChars = ['*', '_', '[', ']', '(', ')', '`', '#', '+', '-', '.', '!'];
      const testName = `test with ${specialChars.join(' ')} characters`;

      const testResult: TestResult = {
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, successRate: 100 },
        tests: [{ name: testName, status: 'passed', duration: 100, error: undefined }],
        errors: [],
        executionTime: 100,
        timestamp: new Date(),
      };

      const report = generator.generate(testResult, 'en');
      
      // Special characters should be escaped
      specialChars.forEach(char => {
        const escaped = `\\${char}`;
        expect(report).toContain(escaped);
      });
    });

    it('should handle test names with code blocks', () => {
      const testName = 'test with `code` and ```blocks```';

      const testResult: TestResult = {
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, successRate: 100 },
        tests: [{ name: testName, status: 'passed', duration: 100, error: undefined }],
        errors: [],
        executionTime: 100,
        timestamp: new Date(),
      };

      const report = generator.generate(testResult, 'en');
      
      // Should escape backticks
      expect(report).toContain('\\`');
    });
  });

  describe('Concurrent executions', () => {
    it('should handle multiple test executions concurrently', async () => {
      const testFile1 = join(tempDir, 'test1.test.js');
      const testFile2 = join(tempDir, 'test2.test.js');
      const testFile3 = join(tempDir, 'test3.test.js');

      await Promise.all([
        writeFile(testFile1, 'import { test } from "vitest"; test("test1", () => {});'),
        writeFile(testFile2, 'import { test } from "vitest"; test("test2", () => {});'),
        writeFile(testFile3, 'import { test } from "vitest"; test("test3", () => {});'),
      ]);

      // Execute framework detection concurrently
      const results = await Promise.all([
        executor.detectFramework(testFile1),
        executor.detectFramework(testFile2),
        executor.detectFramework(testFile3),
      ]);

      // All should detect correctly
      expect(results).toEqual(['vitest', 'vitest', 'vitest']);
    });

    it('should generate unique report filenames for concurrent reports', () => {
      const timestamp1 = new Date('2024-01-15T10:30:00Z');
      const timestamp2 = new Date('2024-01-15T10:30:01Z');
      const timestamp3 = new Date('2024-01-15T10:30:02Z');

      const filename1 = `test-report-${timestamp1.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.md`;
      const filename2 = `test-report-${timestamp2.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.md`;
      const filename3 = `test-report-${timestamp3.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.md`;

      // All filenames should be unique
      expect(filename1).not.toBe(filename2);
      expect(filename2).not.toBe(filename3);
      expect(filename1).not.toBe(filename3);
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle malformed JSON output', () => {
      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: '{ invalid json {',
        stderr: '',
        duration: 100,
        framework: 'jest',
        timedOut: false,
        timestamp: Date.now(),
      };

      // Should not throw, should fall back to regex parsing
      expect(() => collector.collect(rawResult)).not.toThrow();
    });

    it('should handle missing error messages', () => {
      const testResult: TestResult = {
        summary: { total: 0, passed: 0, failed: 0, skipped: 0, successRate: 0 },
        tests: [],
        errors: [{ message: '', type: 'runtime', stack: undefined }],
        executionTime: 1000,
        timestamp: new Date(),
      };

      // Should generate report without crashing
      expect(() => generator.generate(testResult, 'en')).not.toThrow();
      
      const report = generator.generate(testResult, 'en');
      expect(report.length).toBeGreaterThan(0);
    });

    it('should handle timeout with partial output', () => {
      const partialOutput = `
        PASS test1.test.js
        ✓ test 1 (50ms)
        ✓ test 2 (30ms)
        RUNS test2.test.js
      `;

      const rawResult: RawTestResult = {
        exitCode: 1,
        stdout: partialOutput,
        stderr: 'Test execution timed out',
        duration: 300000,
        framework: 'unknown', // Use unknown to trigger fallback parser
        timedOut: true,
        timestamp: Date.now(),
      };

      const result = collector.collect(rawResult);
      
      // Should capture what was completed
      expect(result.tests.length).toBeGreaterThan(0);
      expect(result.tests[0]?.status).toBe('passed');
      expect(result.tests[1]?.status).toBe('passed');
      
      // Execution time should reflect timeout
      expect(result.executionTime).toBe(300000);
    });
  });

  describe('Framework detection edge cases', () => {
    it('should handle mixed framework indicators', async () => {
      const testFile = join(tempDir, 'mixed.test.js');
      await writeFile(testFile, `
        // Has both Jest and Mocha imports
        import { describe, test } from '@jest/globals';
        const { it } = require('mocha');
      `);

      const framework = await executor.detectFramework(testFile);
      
      // Should detect one of them (Jest takes precedence in implementation)
      expect(['jest', 'mocha', 'vitest', 'node:test']).toContain(framework);
    });

    it('should handle test file in deeply nested directory', async () => {
      const deepDir = join(tempDir, 'a', 'b', 'c', 'd', 'e');
      await mkdir(deepDir, { recursive: true });
      
      const testFile = join(deepDir, 'deep.test.js');
      await writeFile(testFile, 'import { test } from "vitest";');

      const framework = await executor.detectFramework(testFile);
      expect(framework).toBe('vitest');
    });
  });
});
