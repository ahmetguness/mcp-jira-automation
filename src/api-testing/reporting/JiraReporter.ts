import type { TestResults } from '../models/types.js';
import { TestStatus } from '../models/enums.js';
import { createLogger } from '../../logger.js';
import { CredentialManager } from '../credential-manager/index.js';

const log = createLogger('api-testing:jira-reporter');

export interface JiraReporterConfig {
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  maxRetryAttempts?: number;
}

export class JiraReporter {
  private config: JiraReporterConfig;
  private maxRetryAttempts: number;

  constructor(config: JiraReporterConfig) {
    this.config = config;
    this.maxRetryAttempts = config.maxRetryAttempts ?? 3;
    log.info('JiraReporter initialized');
  }

  async reportToJira(taskKey: string, results: TestResults): Promise<void> {
    log.info(`Reporting test results to Jira task ${taskKey}`);
    try {
      const comment = this.formatJiraComment(results);
      const redactedComment = CredentialManager.redactCredentials(comment);
      await this.postJiraComment(taskKey, redactedComment);
      log.info(`Successfully reported results to Jira task ${taskKey}`);
    } catch (error) {
      log.error(`Failed to report results to Jira task ${taskKey}`, { error: String(error) });
      throw error;
    }
  }

  async updateTaskStatus(taskKey: string, results: TestResults, retryCount: number = 0): Promise<void> {
    try {
      if (results.failedTests === 0) {
        await this.transitionTaskStatus(taskKey, 'Done');
        log.info(`Task ${taskKey} transitioned to Done`);
      } else {
        await this.addJiraLabel(taskKey, 'test-failed');
        if (retryCount >= this.maxRetryAttempts) {
          await this.addJiraLabel(taskKey, 'permanently-failed');
        }
      }
    } catch (error) {
      log.error(`Failed to update task status for ${taskKey}`, { error: String(error) });
      throw error;
    }
  }

  private formatJiraComment(results: TestResults): string {
    const successRate = results.totalTests > 0 ? ((results.passedTests / results.totalTests) * 100).toFixed(1) : '0.0';
    let comment = `## API Test Results\n\n**Summary:** ${results.passedTests}/${results.totalTests} tests passed (${successRate}% success rate)\n**Duration:** ${results.durationSeconds.toFixed(2)} seconds\n**Timestamp:** ${results.timestamp.toISOString()}\n\n`;

    const passedTests = results.testCases.filter(tc => tc.status === TestStatus.PASSED);
    if (passedTests.length > 0) {
      comment += `### Passed Tests (${passedTests.length})\n\n`;
      for (const test of passedTests) comment += `- ✅ ${test.endpoint} - ${test.name} (${test.durationMs.toFixed(0)}ms)\n`;
      comment += `\n`;
    }

    const failedTests = results.testCases.filter(tc => tc.status === TestStatus.FAILED || tc.status === TestStatus.ERROR);
    if (failedTests.length > 0) {
      comment += `### Failed Tests (${failedTests.length})\n\n`;
      for (const test of failedTests) {
        comment += `- ❌ ${test.endpoint} - ${test.name}\n`;
        if (test.errorMessage) comment += `  Error: ${test.errorMessage}\n`;
        if (test.responseDetails) comment += `  Response: \`${JSON.stringify(test.responseDetails)}\`\n`;
      }
      comment += `\n`;
    }

    const skippedTests = results.testCases.filter(tc => tc.status === TestStatus.SKIPPED);
    if (skippedTests.length > 0) {
      comment += `### Skipped Tests (${skippedTests.length})\n\n`;
      for (const test of skippedTests) comment += `- ⏭️ ${test.endpoint} - ${test.name}\n`;
      comment += `\n`;
    }

    if (results.performanceMetrics) {
      comment += `### Performance Metrics\n\n`;
      comment += `- Min response time: ${results.performanceMetrics.minResponseTimeMs.toFixed(0)}ms\n`;
      comment += `- Max response time: ${results.performanceMetrics.maxResponseTimeMs.toFixed(0)}ms\n`;
      comment += `- Avg response time: ${results.performanceMetrics.avgResponseTimeMs.toFixed(0)}ms\n`;
      if (results.performanceMetrics.requestsPerSecond) comment += `- Requests/second: ${results.performanceMetrics.requestsPerSecond.toFixed(2)}\n`;
    }

    return comment;
  }

  private async postJiraComment(taskKey: string, comment: string): Promise<void> {
    const response = await fetch(`${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}/comment`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] },
      }),
    });
    if (!response.ok) throw new Error(`Failed to post Jira comment: ${response.status} ${await response.text()}`);
  }

  private async transitionTaskStatus(taskKey: string, targetStatus: string): Promise<void> {
    const transitionsUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}/transitions`;
    const getResponse = await fetch(transitionsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    if (!getResponse.ok) throw new Error(`Failed to get transitions: ${getResponse.status} ${await getResponse.text()}`);
    
    const transitionsData = await getResponse.json() as { transitions: Array<{ id: string; name: string; to: { name: string } }> };
    const transition = transitionsData.transitions.find(t => t.to.name.toLowerCase() === targetStatus.toLowerCase() || t.name.toLowerCase() === targetStatus.toLowerCase());
    
    if (!transition) {
      log.warn(`No transition found to status '${targetStatus}' for task ${taskKey}`);
      return;
    }
    
    const postResponse = await fetch(transitionsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ transition: { id: transition.id } }),
    });
    if (!postResponse.ok) throw new Error(`Failed to transition task: ${postResponse.status} ${await postResponse.text()}`);
  }

  private async addJiraLabel(taskKey: string, label: string): Promise<void> {
    const response = await fetch(`${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ update: { labels: [{ add: label }] } }),
    });
    if (!response.ok) throw new Error(`Failed to add Jira label: ${response.status} ${await response.text()}`);
  }
}
