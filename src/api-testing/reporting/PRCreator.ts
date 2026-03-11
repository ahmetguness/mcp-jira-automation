import type { TestResults, CommitConfig, CommitResult, RepositoryInfo, TestFile } from '../models/types.js';
import { TestStatus } from '../models/enums.js';
import { createLogger } from '../../logger.js';
import type { ScmProvider } from '../../scm/provider.js';
import { CredentialManager } from '../credential-manager/index.js';
import * as path from 'path';

const log = createLogger('api-testing:pr-creator');

export class PRCreator {
  private scmProvider?: ScmProvider;

  constructor(scmProvider?: ScmProvider) {
    this.scmProvider = scmProvider;
    log.info('PRCreator initialized', { hasScmProvider: !!this.scmProvider });
  }

  async commitToScm(
    repo: RepositoryInfo,
    testFiles: TestFile[],
    results: TestResults,
    config: CommitConfig,
    taskKey: string
  ): Promise<CommitResult> {
    log.info(`Committing test artifacts to SCM for task ${taskKey}`);

    if (!this.scmProvider) {
      const error = 'SCM provider not configured';
      log.error(error);
      return { success: false, branchName: `${config.branchPrefix}/${taskKey}`, error };
    }

    try {
      const branchName = `${config.branchPrefix}/${taskKey}`;
      await this.scmProvider.createBranch(repo.url, branchName, repo.branch);
      log.info(`Branch ${branchName} created successfully`);

      if (config.commitTestScripts && testFiles.length > 0) {
        for (const testFile of testFiles) {
          const validation = CredentialManager.validateNoHardcodedCredentials(testFile.content);
          if (!validation.valid) {
            throw new Error(`Cannot commit test file ${testFile.path}: contains hardcoded credentials.`);
          }
          
          const redactedContent = CredentialManager.redactCredentials(testFile.content);
          const testFilePath = testFile.path.startsWith('tests/api/') ? testFile.path : path.join('tests/api', path.basename(testFile.path));
          
          const endpoints = testFile.coveredEndpoints.join(', ');
          const commitMessage = `[${taskKey}] Add API tests for ${endpoints}`;
          
          await this.scmProvider.writeFile(repo.url, testFilePath, redactedContent, commitMessage, branchName);
        }
      }

      if (config.commitTestResults) {
        const resultsJson = JSON.stringify(results, null, 2);
        const resultsPath = `test-results/${taskKey}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        await this.scmProvider.writeFile(repo.url, resultsPath, resultsJson, `[${taskKey}] Add test results`, branchName);
      }

      let pullRequestUrl: string | undefined;
      if (config.createPullRequest) {
        const prTitle = `[${taskKey}] API Tests`;
        const prDescription = this.generatePullRequestDescription(testFiles, results, taskKey);
        pullRequestUrl = await this.scmProvider.createPullRequest(repo.url, prTitle, prDescription, branchName, repo.branch);
        log.info(`Pull request created: ${pullRequestUrl}`);
      }

      return { success: true, branchName, pullRequestUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to commit test artifacts to SCM for task ${taskKey}`, { error: errorMessage });
      return { success: false, branchName: `${config.branchPrefix}/${taskKey}`, error: errorMessage };
    }
  }

  private generatePullRequestDescription(testFiles: TestFile[], results: TestResults, taskKey: string): string {
    const successRate = results.totalTests > 0 ? ((results.passedTests / results.totalTests) * 100).toFixed(1) : '0.0';

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

    description += `---\n*Generated by API Endpoint Testing Transformation*\n`;
    return description;
  }
}
