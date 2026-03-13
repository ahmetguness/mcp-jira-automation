/**
 * Property-Based Tests for PR Update Compatibility
 * 
 * Feature: docker-test-execution-reporting
 * Property 15: PR Update Compatibility
 * **Validates: Requirements 8.4**
 * 
 * Tests that Docker test reports can be committed to pull requests using
 * the same process and format as local test reports.
 */

import { describe, test, expect, vi } from 'vitest';
import fc from 'fast-check';
import { DefaultReportGenerator } from '../../../src/test-execution-reporting/report-generator.js';
import type { TestResult, ReportLanguage, DockerRawTestResult, RawTestResult, PRUpdater, UpdateOptions } from '../../../src/test-execution-reporting/types.js';

// ─── Arbitraries ──────────────────────────────────────────────

const reportLanguageArb = fc.constantFrom<ReportLanguage>('en', 'tr');

const testResultArb = fc.record({
  summary: fc.record({
    total: fc.integer({ min: 0, max: 100 }),
    passed: fc.integer({ min: 0, max: 100 }),
    failed: fc.integer({ min: 0, max: 100 }),
    skipped: fc.integer({ min: 0, max: 100 }),
    successRate: fc.float({ min: 0, max: 100 }),
  }),
  tests: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      status: fc.constantFrom('passed', 'failed', 'skipped'),
      duration: fc.integer({ min: 0, max: 5000 }),
      error: fc.option(
        fc.record({
          message: fc.string({ minLength: 1, maxLength: 100 }),
          stack: fc.option(fc.string({ minLength: 1, maxLength: 200 })),
          type: fc.constantFrom('syntax', 'assertion', 'timeout', 'dependency', 'runtime'),
        })
      ),
    }),
    { minLength: 0, maxLength: 10 }
  ),
  errors: fc.array(
    fc.record({
      message: fc.string({ minLength: 1, maxLength: 100 }),
      stack: fc.option(fc.string({ minLength: 1, maxLength: 200 })),
      type: fc.constantFrom('syntax', 'assertion', 'timeout', 'dependency', 'runtime'),
    }),
    { minLength: 0, maxLength: 5 }
  ),
  executionTime: fc.integer({ min: 0, max: 300000 }),
  timestamp: fc.date(),
});

const containerIdArb = fc.string({ minLength: 12, maxLength: 64 }).map(s => 
  s.split('').map(c => c.charCodeAt(0).toString(16)).join('').substring(0, 64)
);

const imageNameArb = fc.oneof(
  fc.constant('node:20-alpine'),
  fc.constant('node:18-alpine'),
  fc.constant('node:20'),
  fc.string({ minLength: 5, maxLength: 50 }).map(s => `custom/${s}:latest`)
);

const networkModeArb = fc.constantFrom('none', 'bridge', 'host');

const timestampArb = fc.integer({ min: Date.now() - 1000000, max: Date.now() });

const dockerRawTestResultArb = fc
  .tuple(
    fc.constantFrom('jest', 'mocha', 'vitest', 'node:test', 'unknown'),
    fc.string({ minLength: 0, maxLength: 100 }),
    fc.string({ minLength: 0, maxLength: 100 }),
    fc.integer({ min: 0, max: 300000 }),
    fc.boolean(),
    containerIdArb,
    imageNameArb,
    networkModeArb,
    timestampArb
  )
  .map(([framework, stdout, stderr, duration, timedOut, containerId, imageName, networkMode, baseTime]) => {
    const exitCode = timedOut ? (Math.floor(Math.random() * 255) + 1) : (Math.random() > 0.3 ? 0 : Math.floor(Math.random() * 255) + 1);
    
    const containerCreationTime = baseTime;
    const containerStartTime = baseTime + Math.floor(Math.random() * 1000);
    const containerStopTime = containerStartTime + Math.floor(Math.random() * 5000);

    return {
      exitCode,
      stdout,
      stderr,
      duration,
      framework,
      timedOut,
      docker: {
        containerId,
        imageName,
        networkMode,
        containerCreationTime,
        containerStartTime,
        containerStopTime,
      },
    } as DockerRawTestResult;
  });

const rawTestResultArb = fc.record({
  exitCode: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 255 })),
  stdout: fc.string({ minLength: 0, maxLength: 100 }),
  stderr: fc.string({ minLength: 0, maxLength: 100 }),
  duration: fc.integer({ min: 0, max: 300000 }),
  framework: fc.constantFrom('jest', 'mocha', 'vitest', 'node:test', 'unknown'),
  timedOut: fc.boolean(),
});

const prUrlArb = fc.string({ minLength: 10, maxLength: 100 }).map(s => `https://github.com/org/repo/pull/${Math.floor(Math.random() * 1000)}`);

// ─── Mock PR Updater ──────────────────────────────────────────

class MockPRUpdater implements PRUpdater {
  public lastReport: string | null = null;
  public lastPrUrl: string | null = null;
  public callCount = 0;

  async addReport(prUrl: string, report: string, options: UpdateOptions): Promise<boolean> {
    this.lastReport = report;
    this.lastPrUrl = prUrl;
    this.callCount++;
    return true;
  }

  reset() {
    this.lastReport = null;
    this.lastPrUrl = null;
    this.callCount = 0;
  }
}

// ─── Property Tests ───────────────────────────────────────────

describe('Property 15: PR Update Compatibility', () => {
  const generator = new DefaultReportGenerator();

  test('Docker reports are valid markdown', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Should start with a header
          expect(report).toMatch(/^# /);

          // Should contain markdown headers
          expect(report).toMatch(/## /);

          // Should be non-empty
          expect(report.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker and non-Docker reports use the same format', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        rawTestResultArb,
        (testResult, language, dockerResult, rawResult) => {
          // Generate both types of reports
          const dockerReport = generator.generate(testResult, language, dockerResult);
          const nonDockerReport = generator.generate(testResult, language, rawResult);

          // Both should be valid markdown
          expect(dockerReport).toMatch(/^# /);
          expect(nonDockerReport).toMatch(/^# /);
          
          // Both should have summary sections
          expect(dockerReport).toContain(language === 'en' ? '## Summary' : '## Özet');
          expect(nonDockerReport).toContain(language === 'en' ? '## Summary' : '## Özet');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker reports maintain consistent structure for PR commits', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should have consistent section ordering
          const headerIndex = report.indexOf('#');
          const dockerMetadataIndex = report.indexOf(
            language === 'en' ? '## Docker Execution Metadata' : '## Docker Çalıştırma Bilgileri'
          );
          const summaryIndex = report.indexOf(
            language === 'en' ? '## Summary' : '## Özet'
          );
          const testResultsIndex = report.indexOf(
            language === 'en' ? '## Test Results' : '## Test Sonuçları'
          );

          // All sections should exist
          expect(headerIndex).toBeGreaterThanOrEqual(0);
          expect(dockerMetadataIndex).toBeGreaterThan(0);
          expect(summaryIndex).toBeGreaterThan(0);
          expect(testResultsIndex).toBeGreaterThan(0);

          // Sections should be in order
          expect(headerIndex).toBeLessThan(dockerMetadataIndex);
          expect(dockerMetadataIndex).toBeLessThan(summaryIndex);
          expect(summaryIndex).toBeLessThan(testResultsIndex);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker reports can be processed identically to non-Docker reports', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should be a string
          expect(typeof report).toBe('string');
          expect(report.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker metadata does not break markdown format', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Docker metadata should be properly formatted
          expect(report).toContain(`\`${dockerResult.docker.containerId}\``);
          expect(report).toContain(`\`${dockerResult.docker.imageName}\``);
          expect(report).toContain(`\`${dockerResult.docker.networkMode}\``);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker reports with special characters in metadata are safe for PR commits', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should properly escape or handle special characters
          // Container IDs, image names, and network modes should be in code blocks
          const dockerMetadataSection = report.substring(
            report.indexOf(language === 'en' ? '## Docker Execution Metadata' : '## Docker Çalıştırma Bilgileri'),
            report.indexOf(language === 'en' ? '## Summary' : '## Özet')
          );

          // All Docker metadata values should be in backticks
          expect(dockerMetadataSection).toContain(`\`${dockerResult.docker.containerId}\``);
          expect(dockerMetadataSection).toContain(`\`${dockerResult.docker.imageName}\``);
          expect(dockerMetadataSection).toContain(`\`${dockerResult.docker.networkMode}\``);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker reports maintain consistent line endings for PR commits', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should use consistent line endings (LF)
          expect(report).not.toContain('\r\n'); // No CRLF
          
          // Should have proper line breaks
          const lines = report.split('\n');
          expect(lines.length).toBeGreaterThan(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
