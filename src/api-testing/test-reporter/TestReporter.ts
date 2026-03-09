/**
 * TestReporter class - Reports test results to Jira and commits artifacts to SCM
 * Feature: api-endpoint-testing-transformation
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.3, 10.6, 12.5
 */

import type { TestResults, CommitConfig, CommitResult, RepositoryInfo, TestCase, TestFile } from '../models/types.js';
import { TestStatus } from '../models/enums.js';
import { createLogger } from '../../logger.js';
import type { ScmProvider } from '../../scm/provider.js';
import { CredentialManager } from '../credential-manager/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const log = createLogger('api-testing:test-reporter');

/**
 * Configuration for TestReporter
 */
export interface TestReporterConfig {
  /** Jira base URL (e.g., "https://company.atlassian.net") */
  jiraBaseUrl: string;
  /** Jira user email */
  jiraEmail: string;
  /** Jira API token */
  jiraApiToken: string;
  /** Maximum retry attempts before marking as permanently failed */
  maxRetryAttempts?: number;
  /** SCM provider for committing test artifacts (optional) */
  scmProvider?: ScmProvider;
}

/**
 * TestReporter - Reports test results to Jira and generates documentation
 * 
 * This class handles:
 * - Posting formatted test results to Jira as comments
 * - Updating task status based on test outcomes
 * - Adding appropriate labels (test-failed, permanently-failed)
 * - Generating Markdown documentation reports
 * - Saving reports to docs/api-tests/ if directory exists
 */
export class TestReporter {
  private config: TestReporterConfig;
  private maxRetryAttempts: number;
  private scmProvider?: ScmProvider;

  constructor(config: TestReporterConfig) {
    this.config = config;
    this.maxRetryAttempts = config.maxRetryAttempts ?? 3;
    this.scmProvider = config.scmProvider;
    
    log.info('TestReporter initialized', {
      baseUrl: config.jiraBaseUrl,
      maxRetryAttempts: this.maxRetryAttempts,
      hasScmProvider: !!this.scmProvider,
    });
  }

  /**
   * Report test results to Jira
   * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 12.5
   * 
   * Posts a formatted comment to Jira containing:
   * - Summary with success rate
   * - Per-endpoint test status
   * - Error messages and response bodies for failures
   * - Test duration and timestamp
   * - Performance metrics (min, max, avg response time)
   * 
   * @param taskKey - Jira task key (e.g., "PROJ-123")
   * @param results - Test execution results
   */
  async reportToJira(taskKey: string, results: TestResults): Promise<void> {
    log.info(`Reporting test results to Jira task ${taskKey}`, {
      totalTests: results.totalTests,
      passedTests: results.passedTests,
      failedTests: results.failedTests,
    });

    try {
      const comment = this.formatJiraComment(results);
      
      // Requirement 7.2: Redact credentials from Jira comments
      const redactedComment = CredentialManager.redactCredentials(comment);
      
      await this.postJiraComment(taskKey, redactedComment);
      
      log.info(`Successfully reported results to Jira task ${taskKey}`);
    } catch (error) {
      log.error(`Failed to report results to Jira task ${taskKey}`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Update task status based on test results
   * Requirements: 4.6, 4.7, 10.6
   * 
   * - If all tests pass: Move task to "Done" status
   * - If any test fails: Keep task "In Progress" and add "test-failed" label
   * - If max retries reached: Add "permanently-failed" label
   * 
   * @param taskKey - Jira task key
   * @param results - Test execution results
   * @param retryCount - Current retry attempt count (default: 0)
   */
  async updateTaskStatus(taskKey: string, results: TestResults, retryCount: number = 0): Promise<void> {
    log.info(`Updating task status for ${taskKey}`, {
      allPassed: results.failedTests === 0,
      retryCount,
      maxRetries: this.maxRetryAttempts,
    });

    try {
      if (results.failedTests === 0) {
        // All tests passed - move to Done
        await this.transitionTaskStatus(taskKey, 'Done');
        log.info(`Task ${taskKey} transitioned to Done - all tests passed`);
      } else {
        // Some tests failed - add test-failed label
        await this.addJiraLabel(taskKey, 'test-failed');
        log.info(`Added 'test-failed' label to task ${taskKey}`);
        
        // Check if max retries reached
        if (retryCount >= this.maxRetryAttempts) {
          await this.addJiraLabel(taskKey, 'permanently-failed');
          log.warn(`Task ${taskKey} marked as permanently-failed after ${retryCount} retries`);
        }
      }
    } catch (error) {
      log.error(`Failed to update task status for ${taskKey}`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Generate Markdown documentation report
   * Requirements: 8.1, 8.2, 8.3, 8.4, 8.6
   * 
   * Generates a comprehensive Markdown report containing:
   * - Test summary with success rate
   * - List of tested endpoints
   * - Request/response examples for successful tests
   * - Error analysis and fix suggestions for failures
   * - Summary table with last test date and status
   * 
   * @param results - Test execution results
   * @param taskKey - Jira task key for reference
   * @returns Markdown formatted report
   */
  generateMarkdownReport(results: TestResults, taskKey: string): string {
    log.debug(`Generating Markdown report for task ${taskKey}`);

    const successRate = results.totalTests > 0 
      ? ((results.passedTests / results.totalTests) * 100).toFixed(1)
      : '0.0';

    let markdown = `# API Test Report - ${taskKey}\n\n`;
    markdown += `**Generated:** ${results.timestamp.toISOString()}\n\n`;
    markdown += `## Summary\n\n`;
    markdown += `- **Total Tests:** ${results.totalTests}\n`;
    markdown += `- **Passed:** ${results.passedTests} ✅\n`;
    markdown += `- **Failed:** ${results.failedTests} ❌\n`;
    markdown += `- **Skipped:** ${results.skippedTests} ⏭️\n`;
    markdown += `- **Success Rate:** ${successRate}%\n`;
    markdown += `- **Duration:** ${results.durationSeconds.toFixed(2)}s\n\n`;

    // Performance metrics
    if (results.performanceMetrics) {
      markdown += `## Performance Metrics\n\n`;
      markdown += `- **Min Response Time:** ${results.performanceMetrics.minResponseTimeMs.toFixed(0)}ms\n`;
      markdown += `- **Max Response Time:** ${results.performanceMetrics.maxResponseTimeMs.toFixed(0)}ms\n`;
      markdown += `- **Avg Response Time:** ${results.performanceMetrics.avgResponseTimeMs.toFixed(0)}ms\n`;
      markdown += `- **Success Rate:** ${(results.performanceMetrics.successRate * 100).toFixed(1)}%\n`;
      if (results.performanceMetrics.requestsPerSecond) {
        markdown += `- **Requests/Second:** ${results.performanceMetrics.requestsPerSecond.toFixed(2)}\n`;
      }
      markdown += `\n`;
    }

    // Passed tests with examples
    const passedTests = results.testCases.filter(tc => tc.status === TestStatus.PASSED);
    if (passedTests.length > 0) {
      markdown += `## Passed Tests (${passedTests.length})\n\n`;
      for (const test of passedTests) {
        markdown += `### ✅ ${test.name}\n\n`;
        markdown += `- **Endpoint:** ${test.endpoint}\n`;
        markdown += `- **Duration:** ${test.durationMs.toFixed(0)}ms\n`;
        
        if (test.requestDetails) {
          markdown += `\n**Request:**\n\`\`\`json\n${JSON.stringify(test.requestDetails, null, 2)}\n\`\`\`\n`;
        }
        
        if (test.responseDetails) {
          markdown += `\n**Response:**\n\`\`\`json\n${JSON.stringify(test.responseDetails, null, 2)}\n\`\`\`\n`;
        }
        
        markdown += `\n`;
      }
    }

    // Failed tests with error analysis
    const failedTests = results.testCases.filter(tc => tc.status === TestStatus.FAILED || tc.status === TestStatus.ERROR);
    if (failedTests.length > 0) {
      markdown += `## Failed Tests (${failedTests.length})\n\n`;
      for (const test of failedTests) {
        markdown += `### ❌ ${test.name}\n\n`;
        markdown += `- **Endpoint:** ${test.endpoint}\n`;
        markdown += `- **Duration:** ${test.durationMs.toFixed(0)}ms\n`;
        
        if (test.errorMessage) {
          markdown += `\n**Error:**\n\`\`\`\n${test.errorMessage}\n\`\`\`\n`;
        }
        
        if (test.requestDetails) {
          markdown += `\n**Request:**\n\`\`\`json\n${JSON.stringify(test.requestDetails, null, 2)}\n\`\`\`\n`;
        }
        
        if (test.responseDetails) {
          markdown += `\n**Response:**\n\`\`\`json\n${JSON.stringify(test.responseDetails, null, 2)}\n\`\`\`\n`;
        }
        
        // Add fix suggestions
        markdown += `\n**Suggested Fixes:**\n`;
        markdown += this.generateFixSuggestions(test);
        markdown += `\n`;
      }
    }

    // Summary table
    markdown += `## Test Results Summary\n\n`;
    markdown += `| Endpoint | Status | Duration | Last Tested |\n`;
    markdown += `|----------|--------|----------|-------------|\n`;
    
    for (const test of results.testCases) {
      const statusIcon = test.status === TestStatus.PASSED ? '✅' : test.status === TestStatus.FAILED ? '❌' : '⏭️';
      markdown += `| ${test.endpoint} | ${statusIcon} ${test.status} | ${test.durationMs.toFixed(0)}ms | ${results.timestamp.toISOString()} |\n`;
    }
    
    markdown += `\n`;

    return markdown;
  }

  /**
   * Save Markdown report to docs/api-tests/ directory
   * Requirements: 8.5
   * 
   * Saves the generated Markdown report to docs/api-tests/ if the directory exists.
   * Creates the directory if it doesn't exist.
   * 
   * @param markdown - Markdown report content
   * @param taskKey - Jira task key for filename
   * @param docsPath - Base path for documentation (default: 'docs/api-tests')
   */
  async saveMarkdownReport(markdown: string, taskKey: string, docsPath: string = 'docs/api-tests'): Promise<void> {
    log.info(`Saving Markdown report for task ${taskKey}`, { docsPath });

    try {
      // Create directory if it doesn't exist
      await fs.mkdir(docsPath, { recursive: true });
      
      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${taskKey}_${timestamp}.md`;
      const filepath = path.join(docsPath, filename);
      
      // Write report to file
      await fs.writeFile(filepath, markdown, 'utf-8');
      
      log.info(`Markdown report saved to ${filepath}`);
    } catch (error) {
      log.error(`Failed to save Markdown report for task ${taskKey}`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Commit test artifacts to SCM
   * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
   * 
   * This method:
   * - Creates a branch with format `api-test/{jira-task-key}`
   * - Organizes test scripts under `tests/api/` directory (one file per endpoint)
   * - Saves test results as JSON in `test-results/` directory
   * - Ensures directory structure exists (Git creates directories implicitly when files are added)
   * - Formats commit message: `[{JIRA-KEY}] Add API tests for {endpoint-summary}`
   * - Optionally creates PR with test summary in description
   * 
   * @param repo - Repository information
   * @param testFiles - Generated test files
   * @param results - Test execution results
   * @param config - Commit configuration
   * @param taskKey - Jira task key for branch naming
   */
  async commitToScm(
    repo: RepositoryInfo,
    testFiles: TestFile[],
    results: TestResults,
    config: CommitConfig,
    taskKey: string
  ): Promise<CommitResult> {
    log.info(`Committing test artifacts to SCM for task ${taskKey}`, {
      repository: repo.url,
      testFileCount: testFiles.length,
      commitTestScripts: config.commitTestScripts,
      commitTestResults: config.commitTestResults,
      createPullRequest: config.createPullRequest,
    });

    // Check if SCM provider is available
    if (!this.scmProvider) {
      const error = 'SCM provider not configured';
      log.error(error);
      return {
        success: false,
        branchName: `${config.branchPrefix}/${taskKey}`,
        error,
      };
    }

    try {
      // Create branch name
      const branchName = `${config.branchPrefix}/${taskKey}`;
      log.info(`Creating branch ${branchName} from ${repo.branch}`);

      // Create branch from base branch
      await this.scmProvider.createBranch(repo.url, branchName, repo.branch);
      log.info(`Branch ${branchName} created successfully`);

      // Commit test scripts if configured
      if (config.commitTestScripts && testFiles.length > 0) {
        log.info(`Committing ${testFiles.length} test scripts to ${branchName}`);
        
        for (const testFile of testFiles) {
          // Requirement 7.3: Validate no credentials in test scripts before committing
          const validation = CredentialManager.validateNoHardcodedCredentials(testFile.content);
          if (!validation.valid) {
            log.error(`Test file ${testFile.path} contains hardcoded credentials`, {
              issues: validation.issues,
            });
            throw new Error(
              `Cannot commit test file ${testFile.path}: contains hardcoded credentials. ` +
              `Issues: ${validation.issues.join(', ')}`
            );
          }
          
          // Requirement 7.3: Redact any remaining credentials from test file content
          const redactedContent = CredentialManager.redactCredentials(testFile.content);
          
          // Check if redaction changed the content (indicates credentials were found)
          if (redactedContent !== testFile.content) {
            log.warn(`Credentials detected and redacted in test file ${testFile.path}`);
          }
          
          // Ensure test file path is under tests/api/
          // Requirement 5.2: Organize test scripts under tests/api/ directory
          // Requirement 5.6: Directory creation is handled implicitly by Git when files are added
          const testFilePath = testFile.path.startsWith('tests/api/')
            ? testFile.path
            : path.join('tests/api', path.basename(testFile.path));
          
          log.debug(`Committing test file: ${testFilePath}`);
          
          // Generate commit message for this test file
          // Requirement 5.7: Commit message references Jira task key
          const endpoints = testFile.coveredEndpoints.join(', ');
          const commitMessage = `[${taskKey}] Add API tests for ${endpoints}`;
          
          // Write test file to repository (using redacted content)
          // Requirement 5.3: Create separate file per endpoint
          await this.scmProvider.writeFile(
            repo.url,
            testFilePath,
            redactedContent,
            commitMessage,
            branchName
          );
          
          log.debug(`Test file ${testFilePath} committed successfully`);
        }
        
        log.info(`All test scripts committed to branch ${branchName}`);
      }

      // Commit test results if configured
      if (config.commitTestResults) {
        log.info(`Committing test results to ${branchName}`);
        
        // Generate test results JSON
        // Requirement 5.4: Save test results as JSON in test-results/ directory
        const resultsJson = JSON.stringify(results, null, 2);
        const resultsPath = `test-results/${taskKey}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        
        const commitMessage = `[${taskKey}] Add test results`;
        
        // Write test results to repository
        await this.scmProvider.writeFile(
          repo.url,
          resultsPath,
          resultsJson,
          commitMessage,
          branchName
        );
        
        log.info(`Test results committed to ${resultsPath}`);
      }

      // Create pull request if configured
      let pullRequestUrl: string | undefined;
      if (config.createPullRequest) {
        log.info(`Creating pull request for branch ${branchName}`);
        
        // Generate PR title and description
        const prTitle = `[${taskKey}] API Tests`;
        const prDescription = this.generatePullRequestDescription(testFiles, results, taskKey);
        
        pullRequestUrl = await this.scmProvider.createPullRequest(
          repo.url,
          prTitle,
          prDescription,
          branchName,
          repo.branch
        );
        
        log.info(`Pull request created: ${pullRequestUrl}`);
      }

      return {
        success: true,
        branchName,
        pullRequestUrl,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to commit test artifacts to SCM for task ${taskKey}`, { error: errorMessage });
      
      return {
        success: false,
        branchName: `${config.branchPrefix}/${taskKey}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Format test results as Jira comment
   * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 12.5
   * 
   * @param results - Test execution results
   * @returns Formatted comment text
   */
  private formatJiraComment(results: TestResults): string {
    const successRate = results.totalTests > 0 
      ? ((results.passedTests / results.totalTests) * 100).toFixed(1)
      : '0.0';

    let comment = `## API Test Results\n\n`;
    comment += `**Summary:** ${results.passedTests}/${results.totalTests} tests passed (${successRate}% success rate)\n`;
    comment += `**Duration:** ${results.durationSeconds.toFixed(2)} seconds\n`;
    comment += `**Timestamp:** ${results.timestamp.toISOString()}\n\n`;

    // Passed tests
    const passedTests = results.testCases.filter(tc => tc.status === TestStatus.PASSED);
    if (passedTests.length > 0) {
      comment += `### Passed Tests (${passedTests.length})\n\n`;
      for (const test of passedTests) {
        comment += `- ✅ ${test.endpoint} - ${test.name} (${test.durationMs.toFixed(0)}ms)\n`;
      }
      comment += `\n`;
    }

    // Failed tests
    const failedTests = results.testCases.filter(tc => tc.status === TestStatus.FAILED || tc.status === TestStatus.ERROR);
    if (failedTests.length > 0) {
      comment += `### Failed Tests (${failedTests.length})\n\n`;
      for (const test of failedTests) {
        comment += `- ❌ ${test.endpoint} - ${test.name}\n`;
        if (test.errorMessage) {
          comment += `  Error: ${test.errorMessage}\n`;
        }
        if (test.responseDetails) {
          comment += `  Response: \`${JSON.stringify(test.responseDetails)}\`\n`;
        }
      }
      comment += `\n`;
    }

    // Skipped tests
    const skippedTests = results.testCases.filter(tc => tc.status === TestStatus.SKIPPED);
    if (skippedTests.length > 0) {
      comment += `### Skipped Tests (${skippedTests.length})\n\n`;
      for (const test of skippedTests) {
        comment += `- ⏭️ ${test.endpoint} - ${test.name}\n`;
      }
      comment += `\n`;
    }

    // Performance metrics
    if (results.performanceMetrics) {
      comment += `### Performance Metrics\n\n`;
      comment += `- Min response time: ${results.performanceMetrics.minResponseTimeMs.toFixed(0)}ms\n`;
      comment += `- Max response time: ${results.performanceMetrics.maxResponseTimeMs.toFixed(0)}ms\n`;
      comment += `- Avg response time: ${results.performanceMetrics.avgResponseTimeMs.toFixed(0)}ms\n`;
      if (results.performanceMetrics.requestsPerSecond) {
        comment += `- Requests/second: ${results.performanceMetrics.requestsPerSecond.toFixed(2)}\n`;
      }
    }

    return comment;
  }

  /**
   * Post a comment to a Jira task
   * 
   * @param taskKey - Jira task key
   * @param comment - Comment text
   */
  private async postJiraComment(taskKey: string, comment: string): Promise<void> {
    const commentUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}/comment`;
    
    const response = await fetch(commentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: comment,
                },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to post Jira comment: ${response.status} ${errorText}`);
    }

    log.debug(`Posted comment to Jira task ${taskKey}`);
  }

  /**
   * Transition task to a new status
   * 
   * @param taskKey - Jira task key
   * @param targetStatus - Target status name (e.g., "Done", "In Progress")
   */
  private async transitionTaskStatus(taskKey: string, targetStatus: string): Promise<void> {
    log.debug(`Transitioning task ${taskKey} to ${targetStatus}`);

    // First, get available transitions
    const transitionsUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}/transitions`;
    
    const getResponse = await fetch(transitionsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!getResponse.ok) {
      const errorText = await getResponse.text();
      throw new Error(`Failed to get transitions: ${getResponse.status} ${errorText}`);
    }

    const transitionsData = await getResponse.json() as {
      transitions: Array<{ id: string; name: string; to: { name: string } }>;
    };

    // Find the transition that leads to the target status
    const transition = transitionsData.transitions.find(
      t => t.to.name.toLowerCase() === targetStatus.toLowerCase() || t.name.toLowerCase() === targetStatus.toLowerCase()
    );

    if (!transition) {
      log.warn(`No transition found to status '${targetStatus}' for task ${taskKey}`);
      return;
    }

    // Execute the transition
    const postResponse = await fetch(transitionsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        transition: {
          id: transition.id,
        },
      }),
    });

    if (!postResponse.ok) {
      const errorText = await postResponse.text();
      throw new Error(`Failed to transition task: ${postResponse.status} ${errorText}`);
    }

    log.info(`Task ${taskKey} transitioned to ${targetStatus}`);
  }

  /**
   * Add a label to a Jira task
   * 
   * @param taskKey - Jira task key
   * @param label - Label to add
   */
  private async addJiraLabel(taskKey: string, label: string): Promise<void> {
    const issueUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}`;
    
    const response = await fetch(issueUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        update: {
          labels: [
            { add: label },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add Jira label: ${response.status} ${errorText}`);
    }

    log.debug(`Added label '${label}' to Jira task ${taskKey}`);
  }

  /**
   * Generate fix suggestions for a failed test
   * 
   * @param test - Failed test case
   * @returns Markdown formatted fix suggestions
   */
  private generateFixSuggestions(test: TestCase): string {
    let suggestions = '';

    if (test.errorMessage) {
      const error = test.errorMessage.toLowerCase();
      
      if (error.includes('timeout') || error.includes('timed out')) {
        suggestions += '- Check if the API endpoint is responsive\n';
        suggestions += '- Consider increasing the timeout value\n';
        suggestions += '- Verify network connectivity\n';
      } else if (error.includes('401') || error.includes('unauthorized')) {
        suggestions += '- Verify authentication credentials are correct\n';
        suggestions += '- Check if the API token has expired\n';
        suggestions += '- Ensure proper authorization headers are set\n';
      } else if (error.includes('404') || error.includes('not found')) {
        suggestions += '- Verify the endpoint URL is correct\n';
        suggestions += '- Check if the resource exists\n';
        suggestions += '- Ensure the base URL is properly configured\n';
      } else if (error.includes('500') || error.includes('internal server error')) {
        suggestions += '- Check server logs for detailed error information\n';
        suggestions += '- Verify the request payload is valid\n';
        suggestions += '- Contact the API provider if the issue persists\n';
      } else if (error.includes('400') || error.includes('bad request')) {
        suggestions += '- Verify the request body format is correct\n';
        suggestions += '- Check if all required fields are provided\n';
        suggestions += '- Validate data types match the API specification\n';
      } else {
        suggestions += '- Review the error message for specific details\n';
        suggestions += '- Check API documentation for requirements\n';
        suggestions += '- Verify the test configuration is correct\n';
      }
    } else {
      suggestions += '- Review test logs for more information\n';
      suggestions += '- Verify the test expectations are correct\n';
    }

    return suggestions;
  }

  /**
   * Generate pull request description with test summary
   * 
   * @param testFiles - Generated test files
   * @param results - Test execution results
   * @param taskKey - Jira task key
   * @returns Markdown formatted PR description
   */
  private generatePullRequestDescription(testFiles: TestFile[], results: TestResults, taskKey: string): string {
    const successRate = results.totalTests > 0 
      ? ((results.passedTests / results.totalTests) * 100).toFixed(1)
      : '0.0';

    let description = `## API Tests for ${taskKey}\n\n`;
    description += `This PR adds automated API tests generated from Jira task ${taskKey}.\n\n`;
    
    description += `### Test Summary\n\n`;
    description += `- **Total Tests:** ${results.totalTests}\n`;
    description += `- **Passed:** ${results.passedTests} ✅\n`;
    description += `- **Failed:** ${results.failedTests} ❌\n`;
    description += `- **Success Rate:** ${successRate}%\n`;
    description += `- **Duration:** ${results.durationSeconds.toFixed(2)}s\n\n`;

    description += `### Test Files\n\n`;
    for (const testFile of testFiles) {
      description += `- \`${testFile.path}\` - ${testFile.testCount} tests covering:\n`;
      for (const endpoint of testFile.coveredEndpoints) {
        description += `  - ${endpoint}\n`;
      }
    }
    description += `\n`;

    if (results.performanceMetrics) {
      description += `### Performance Metrics\n\n`;
      description += `- **Min Response Time:** ${results.performanceMetrics.minResponseTimeMs.toFixed(0)}ms\n`;
      description += `- **Max Response Time:** ${results.performanceMetrics.maxResponseTimeMs.toFixed(0)}ms\n`;
      description += `- **Avg Response Time:** ${results.performanceMetrics.avgResponseTimeMs.toFixed(0)}ms\n\n`;
    }

    if (results.failedTests > 0) {
      description += `### ⚠️ Failed Tests\n\n`;
      const failedTests = results.testCases.filter(tc => tc.status === TestStatus.FAILED || tc.status === TestStatus.ERROR);
      for (const test of failedTests) {
        description += `- **${test.endpoint}**: ${test.errorMessage || 'Unknown error'}\n`;
      }
      description += `\n`;
    }

    description += `---\n`;
    description += `*Generated by API Endpoint Testing Transformation*\n`;

    return description;
  }
}
