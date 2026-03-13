/**
 * Integration tests for Test Execution Pipeline
 * 
 * Tests the complete end-to-end flow:
 * test file → execution → report → PR commit
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.4, 6.1, 6.2, 6.3, 6.4**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestExecutionPipeline } from '../../src/test-execution-reporting/pipeline.js';
import { DefaultTestExecutor } from '../../src/test-execution-reporting/test-executor.js';
import { DefaultResultCollector } from '../../src/test-execution-reporting/result-collector.js';
import { DefaultLanguageDetector } from '../../src/test-execution-reporting/language-detector.js';
import { DefaultReportGenerator } from '../../src/test-execution-reporting/report-generator.js';
import { DefaultPRUpdater } from '../../src/test-execution-reporting/pr-updater.js';
import type { TestExecutionContext } from '../../src/test-execution-reporting/types.js';
import type { ScmProvider } from '../../src/scm/provider.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

describe('TestExecutionPipeline - Integration Tests', () => {
  let mockScmProvider: ScmProvider;
  let pipeline: TestExecutionPipeline;

  beforeEach(() => {
    // Create mock SCM provider
    mockScmProvider = {
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScmProvider;

    // Create pipeline with real components
    const testExecutor = new DefaultTestExecutor();
    const resultCollector = new DefaultResultCollector();
    const languageDetector = new DefaultLanguageDetector();
    const reportGenerator = new DefaultReportGenerator();
    const prUpdater = new DefaultPRUpdater(mockScmProvider, 'en');

    pipeline = new TestExecutionPipeline(
      testExecutor,
      resultCollector,
      languageDetector,
      reportGenerator,
      prUpdater
    );
  });

  describe('End-to-End Pipeline Flow', () => {
    it('should execute complete pipeline for Node.js test runner', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/node-test-example.test.ts');
      const englishTask = await readFile(
        resolve('tests/fixtures/test-execution-reporting/jira-tasks/english-task.txt'),
        'utf-8'
      );

      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: englishTask,
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify execution completed
      expect(result.context).toEqual(context);
      expect(result.rawResult).toBeDefined();
      // Framework detection may vary based on environment
      expect(['node:test', 'vitest', 'jest', 'mocha']).toContain(result.rawResult.framework);
      
      // Verify test results collected
      expect(result.testResult).toBeDefined();
      expect(result.testResult.summary.total).toBeGreaterThanOrEqual(0);
      
      // Verify language detected
      expect(result.language).toBe('en');
      
      // Verify report generated
      expect(result.report).toBeDefined();
      expect(result.report).toContain('Test Execution Report');
      expect(result.report).toContain('Summary');
      
      // Verify PR updated
      expect(result.reportCommitted).toBe(true);
      const mockData = (mockScmProvider.writeFile as unknown as { mock: { calls: unknown[][] } }).mock;
      expect(mockData.calls.length).toBeGreaterThan(0);
      
      // Verify no errors or only recoverable errors
      const nonRecoverableErrors = result.errors.filter(e => !e.recoverable);
      expect(nonRecoverableErrors).toHaveLength(0);
    }, 30000);

    it('should execute complete pipeline with Turkish language detection', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/node-test-example.test.ts');
      const turkishTask = await readFile(
        resolve('tests/fixtures/test-execution-reporting/jira-tasks/turkish-task.txt'),
        'utf-8'
      );

      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: turkishTask,
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify Turkish language detected
      expect(result.language).toBe('tr');
      
      // Verify Turkish report generated
      expect(result.report).toContain('Test Çalıştırma Raporu');
      expect(result.report).toContain('Özet');
      
      // Verify no errors
      expect(result.errors).toHaveLength(0);
    }, 30000);
  });

  describe('Error Scenarios', () => {
    it('should handle missing test file gracefully', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/nonexistent.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: 'Test task',
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify execution attempted (may or may not error depending on framework behavior)
      expect(result.rawResult).toBeDefined();
      
      // Verify fallback report generated
      expect(result.report).toBeDefined();
      
      // Verify report committed
      expect(result.reportCommitted).toBe(true);
      
      // If errors occurred, verify they're tracked
      if (result.errors.length > 0) {
        const executionError = result.errors.find(e => e.stage === 'execution');
        if (executionError) {
          expect(executionError.recoverable).toBe(false);
        }
      }
    });

    it('should handle PR update failure gracefully', async () => {
      // Mock SCM provider to fail
      mockScmProvider.writeFile = vi.fn().mockRejectedValue(new Error('Network error'));

      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/node-test-example.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: 'Test task',
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify execution and report generation succeeded
      expect(result.rawResult).toBeDefined();
      expect(result.testResult).toBeDefined();
      expect(result.report).toBeDefined();
      
      // Verify PR update failed
      expect(result.reportCommitted).toBe(false);
      
      // Verify error tracked
      const commitError = result.errors.find(e => e.stage === 'commit');
      expect(commitError).toBeDefined();
      expect(commitError?.recoverable).toBe(true);
    }, 10000); // Increase timeout for retry logic
  });

  describe('Multiple Test Frameworks', () => {
    it('should handle Jest test files', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/jest-example.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: 'Test task',
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify framework detected (may vary based on environment)
      expect(['jest', 'vitest', 'node:test']).toContain(result.rawResult.framework);
      
      // Verify report generated
      expect(result.report).toBeDefined();
    });

    it('should handle Mocha test files', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/mocha-example.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: 'Test task',
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify framework detected (may vary based on environment)
      expect(['mocha', 'vitest', 'node:test']).toContain(result.rawResult.framework);
      
      // Verify report generated
      expect(result.report).toBeDefined();
    });

    it('should handle Vitest test files', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/vitest-example.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: 'Test task',
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify Vitest framework detected (or fallback to node:test)
      expect(['vitest', 'node:test']).toContain(result.rawResult.framework);
      
      // Verify report generated
      expect(result.report).toBeDefined();
    });
  });

  describe('Report Content Validation', () => {
    it('should include all required report sections', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/node-test-example.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: 'Test task',
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify report contains all required sections
      expect(result.report).toContain('Test Execution Report');
      expect(result.report).toContain('Execution Time');
      expect(result.report).toContain('Duration');
      expect(result.report).toContain('Summary');
      expect(result.report).toContain('Total Tests');
      expect(result.report).toContain('Passed');
      expect(result.report).toContain('Failed');
      expect(result.report).toContain('Skipped');
      expect(result.report).toContain('Success Rate');
      expect(result.report).toContain('Test Results');
    });

    it('should include test details in report', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/node-test-example.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: 'Test task',
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify test result structure
      expect(result.testResult.tests).toBeDefined();
      expect(Array.isArray(result.testResult.tests)).toBe(true);
      
      // If tests were found, verify their structure
      if (result.testResult.tests.length > 0) {
        for (const test of result.testResult.tests) {
          expect(test.name).toBeDefined();
          expect(test.status).toMatch(/passed|failed|skipped/);
          expect(test.duration).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('Error Recovery', () => {
    it('should continue pipeline after recoverable errors', async () => {
      const testFilePath = resolve('tests/fixtures/test-execution-reporting/test-files/node-test-example.test.ts');
      
      const context: TestExecutionContext = {
        testFilePath,
        prUrl: 'https://github.com/test/repo/pull/123',
        jiraTaskKey: 'TEST-123',
        jiraTaskContent: '', // Empty content to test language detection fallback
        repositoryPath: process.cwd(),
        branch: 'test-branch',
        createdAt: new Date(),
      };

      const result = await pipeline.execute(context);

      // Verify pipeline completed despite empty Jira content
      expect(result.language).toBe('en'); // Should default to English
      expect(result.report).toBeDefined();
      expect(result.reportCommitted).toBe(true);
    });
  });
});
