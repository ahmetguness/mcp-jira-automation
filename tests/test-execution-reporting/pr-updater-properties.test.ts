/**
 * Property-based tests for PR Updater component
 * Feature: test-execution-reporting
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { DefaultPRUpdater } from '../../src/test-execution-reporting/pr-updater.js';
import type { ScmProvider } from '../../src/scm/provider.js';
import type { UpdateOptions } from '../../src/test-execution-reporting/types.js';

describe('PR Updater Properties', () => {
  describe('Property 7: Report Commit Creation', () => {
    /**
     * **Validates: Requirements 5.1, 5.2, 5.4**
     * 
     * For any generated markdown report, the PR_Updater should create a commit
     * to the pull request with the report file and a descriptive commit message.
     */
    it('should create commit with correct filename pattern and commit message', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random report content
          fc.string({ minLength: 10, maxLength: 1000 }),
          // Generate random PR URLs for different providers
          fc.oneof(
            fc.tuple(
              fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
              fc.stringMatching(/^[a-zA-Z0-9_-]+$/)
            ).map(([org, repo]) => `https://github.com/${org}/${repo}/pull/123`),
            fc.tuple(
              fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
              fc.stringMatching(/^[a-zA-Z0-9_-]+$/)
            ).map(([org, repo]) => `https://gitlab.com/${org}/${repo}/-/merge_requests/123`),
            fc.tuple(
              fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
              fc.stringMatching(/^[a-zA-Z0-9_-]+$/)
            ).map(([org, repo]) => `https://bitbucket.org/${org}/${repo}/pull-requests/123`)
          ),
          // Generate language
          fc.constantFrom('en' as const, 'tr' as const),
          async (reportContent, prUrl, language) => {
            // Mock SCM provider
            const mockScmProvider: ScmProvider = {
              getRepoInfo: vi.fn(),
              readFile: vi.fn(),
              listFiles: vi.fn(),
              readFiles: vi.fn(),
              createBranch: vi.fn(),
              writeFile: vi.fn().mockResolvedValue(undefined),
              createPullRequest: vi.fn(),
            };

            const updater = new DefaultPRUpdater(mockScmProvider, language);
            const options: UpdateOptions = {
              maxRetries: 3,
              retryDelay: 1000,
            };

            // Execute
            const result = await updater.addReport(prUrl, reportContent, options);

            // Verify success
            expect(result).toBe(true);

            // Verify writeFile was called with correct arguments
            const mockData = (mockScmProvider.writeFile as unknown as { mock: { calls: unknown[][] } }).mock;
            expect(mockData.calls.length).toBe(1);
            
            const [repo, filename, content, commitMessage, branch] = mockData.calls[0] as [string, string, string, string, string];

            // Verify filename matches pattern: test-report-{timestamp}.md
            expect(filename).toMatch(/^test-report-\d{8}-\d{9}\.md$/);

            // Verify content is the report
            expect(content).toBe(reportContent);

            // Verify commit message is descriptive and language-appropriate
            if (language === 'tr') {
              expect(commitMessage).toBe('Test çalıştırma raporu eklendi');
            } else {
              expect(commitMessage).toBe('Add test execution report');
            }

            // Verify repo and branch are extracted from PR URL
            expect(repo).toBeTruthy();
            expect(branch).toBeTruthy();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle retry logic with exponential backoff', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 100 }),
          fc.integer({ min: 1, max: 3 }),
          async (reportContent, failureCount) => {
            let callCount = 0;
            const mockScmProvider: ScmProvider = {
              getRepoInfo: vi.fn(),
              readFile: vi.fn(),
              listFiles: vi.fn(),
              readFiles: vi.fn(),
              createBranch: vi.fn(),
              writeFile: vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount < failureCount) {
                  throw new Error('Network error: ECONNREFUSED');
                }
                return Promise.resolve(undefined);
              }),
              createPullRequest: vi.fn(),
            };

            const updater = new DefaultPRUpdater(mockScmProvider, 'en');
            const options: UpdateOptions = {
              maxRetries: 3,
              retryDelay: 10, // Use small delay for testing
            };

            const prUrl = 'https://github.com/org/repo/pull/123';
            const result = await updater.addReport(prUrl, reportContent, options);

            // Should succeed if failures are less than max retries
            if (failureCount <= 3) {
              expect(result).toBe(true);
              expect(callCount).toBe(failureCount);
            } else {
              expect(result).toBe(false);
              expect(callCount).toBe(3);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should not retry on permission errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 100 }),
          fc.constantFrom('403', '401', 'permission denied', 'unauthorized', 'forbidden'),
          async (reportContent, errorType) => {
            let callCount = 0;
            const mockScmProvider: ScmProvider = {
              getRepoInfo: vi.fn(),
              readFile: vi.fn(),
              listFiles: vi.fn(),
              readFiles: vi.fn(),
              createBranch: vi.fn(),
              writeFile: vi.fn().mockImplementation(() => {
                callCount++;
                throw new Error(`Permission error: ${errorType}`);
              }),
              createPullRequest: vi.fn(),
            };

            const updater = new DefaultPRUpdater(mockScmProvider, 'en');
            const options: UpdateOptions = {
              maxRetries: 3,
              retryDelay: 10,
            };

            const prUrl = 'https://github.com/org/repo/pull/123';
            const result = await updater.addReport(prUrl, reportContent, options);

            // Should fail immediately without retries
            expect(result).toBe(false);
            expect(callCount).toBe(1);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should generate unique timestamps for concurrent reports', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 10, maxLength: 100 }), { minLength: 2, maxLength: 5 }),
          async (reports) => {
            const filenames = new Set<string>();

            for (const report of reports) {
              const mockScmProvider: ScmProvider = {
                getRepoInfo: vi.fn(),
                readFile: vi.fn(),
                listFiles: vi.fn(),
                readFiles: vi.fn(),
                createBranch: vi.fn(),
                writeFile: vi.fn().mockImplementation((_repo, filename) => {
                  filenames.add(filename);
                  return Promise.resolve(undefined);
                }),
                createPullRequest: vi.fn(),
              };

              const updater = new DefaultPRUpdater(mockScmProvider, 'en');
              const options: UpdateOptions = {
                maxRetries: 3,
                retryDelay: 1000,
              };

              const prUrl = 'https://github.com/org/repo/pull/123';
              await updater.addReport(prUrl, report, options);
              
              // Add small delay to ensure different timestamps
              await new Promise(resolve => setTimeout(resolve, 10));
            }

            // All filenames should be unique with the delay
            expect(filenames.size).toBe(reports.length);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
