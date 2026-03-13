/**
 * Property-Based Tests for Metadata Inclusion in Reports
 * 
 * Feature: docker-test-execution-reporting
 * Property 14: Metadata Inclusion in Reports
 * **Validates: Requirements 8.3, 10.4**
 * 
 * Tests that Docker test execution metadata (container ID, image name, network mode)
 * is included in generated reports while maintaining backward compatibility with
 * non-Docker results.
 */

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { DefaultReportGenerator } from '../../../src/test-execution-reporting/report-generator.js';
import type { TestResult, ReportLanguage, DockerRawTestResult, RawTestResult } from '../../../src/test-execution-reporting/types.js';

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

// ─── Property Tests ───────────────────────────────────────────

describe('Property 14: Metadata Inclusion in Reports', () => {
  const generator = new DefaultReportGenerator();

  test('Docker reports include container ID metadata', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should contain the container ID
          expect(report).toContain(dockerResult.docker.containerId);
          
          // Container ID should be in a code block (backticks)
          expect(report).toMatch(new RegExp(`\`${dockerResult.docker.containerId}\``));
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker reports include image name metadata', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should contain the image name
          expect(report).toContain(dockerResult.docker.imageName);
          
          // Image name should be in a code block (backticks)
          expect(report).toMatch(new RegExp(`\`${dockerResult.docker.imageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker reports include network mode metadata', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should contain the network mode
          expect(report).toContain(dockerResult.docker.networkMode);
          
          // Network mode should be in a code block (backticks)
          expect(report).toMatch(new RegExp(`\`${dockerResult.docker.networkMode}\``));
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker reports include Docker metadata section header', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // Report should have a Docker metadata section
          if (language === 'en') {
            expect(report).toContain('## Docker Execution Metadata');
          } else {
            expect(report).toContain('## Docker Çalıştırma Bilgileri');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Non-Docker reports do not include Docker metadata', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        rawTestResultArb,
        (testResult, language, rawResult) => {
          const report = generator.generate(testResult, language, rawResult);

          // Report should NOT have Docker metadata section
          expect(report).not.toContain('Docker Execution Metadata');
          expect(report).not.toContain('Docker Çalıştırma Bilgileri');
          expect(report).not.toContain('Container ID');
          expect(report).not.toContain('Konteyner ID');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Reports without rawResult do not include Docker metadata', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        (testResult, language) => {
          const report = generator.generate(testResult, language);

          // Report should NOT have Docker metadata section
          expect(report).not.toContain('Docker Execution Metadata');
          expect(report).not.toContain('Docker Çalıştırma Bilgileri');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker metadata appears before summary section', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          const dockerMetadataIndex = report.indexOf(
            language === 'en' ? '## Docker Execution Metadata' : '## Docker Çalıştırma Bilgileri'
          );
          const summaryIndex = report.indexOf(
            language === 'en' ? '## Summary' : '## Özet'
          );

          // Docker metadata should appear before summary
          expect(dockerMetadataIndex).toBeGreaterThan(-1);
          expect(summaryIndex).toBeGreaterThan(-1);
          expect(dockerMetadataIndex).toBeLessThan(summaryIndex);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker metadata uses correct language labels', () => {
    fc.assert(
      fc.property(
        testResultArb,
        dockerRawTestResultArb,
        (testResult, dockerResult) => {
          // Test English labels
          const englishReport = generator.generate(testResult, 'en', dockerResult);
          expect(englishReport).toContain('**Container ID**');
          expect(englishReport).toContain('**Image Name**');
          expect(englishReport).toContain('**Network Mode**');

          // Test Turkish labels
          const turkishReport = generator.generate(testResult, 'tr', dockerResult);
          expect(turkishReport).toContain('**Konteyner ID**');
          expect(turkishReport).toContain('**İmaj Adı**');
          expect(turkishReport).toContain('**Ağ Modu**');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Docker metadata does not interfere with test results section', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const dockerReport = generator.generate(testResult, language, dockerResult);
          const nonDockerReport = generator.generate(testResult, language);

          // Both reports should have the same test results section structure
          const dockerTestResultsIndex = dockerReport.indexOf(
            language === 'en' ? '## Test Results' : '## Test Sonuçları'
          );
          const nonDockerTestResultsIndex = nonDockerReport.indexOf(
            language === 'en' ? '## Test Results' : '## Test Sonuçları'
          );

          expect(dockerTestResultsIndex).toBeGreaterThan(-1);
          expect(nonDockerTestResultsIndex).toBeGreaterThan(-1);

          // Extract test results sections
          const dockerTestResults = dockerReport.substring(dockerTestResultsIndex);
          const nonDockerTestResults = nonDockerReport.substring(nonDockerTestResultsIndex);

          // Test results sections should be identical
          expect(dockerTestResults).toBe(nonDockerTestResults);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('All three Docker metadata fields are always present together', () => {
    fc.assert(
      fc.property(
        testResultArb,
        reportLanguageArb,
        dockerRawTestResultArb,
        (testResult, language, dockerResult) => {
          const report = generator.generate(testResult, language, dockerResult);

          // If Docker metadata section exists, all three fields must be present
          const hasDockerSection = report.includes(
            language === 'en' ? '## Docker Execution Metadata' : '## Docker Çalıştırma Bilgileri'
          );

          if (hasDockerSection) {
            expect(report).toContain(dockerResult.docker.containerId);
            expect(report).toContain(dockerResult.docker.imageName);
            expect(report).toContain(dockerResult.docker.networkMode);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
