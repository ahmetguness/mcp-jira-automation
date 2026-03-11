import type { TestResults, TestCase } from '../models/types.js';
import { TestStatus } from '../models/enums.js';
import { createLogger } from '../../logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FailureAnalyzer } from './FailureAnalyzer.js';

const log = createLogger('api-testing:result-collector');

export class ResultCollector {
  private failureAnalyzer: FailureAnalyzer;

  constructor() {
    this.failureAnalyzer = new FailureAnalyzer();
    log.info('ResultCollector initialized');
  }

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

    const passedTests = results.testCases.filter(tc => tc.status === TestStatus.PASSED);
    if (passedTests.length > 0) {
      markdown += `## Passed Tests (${passedTests.length})\n\n`;
      for (const test of passedTests) {
        markdown += `### ✅ ${test.name}\n\n`;
        markdown += `- **Endpoint:** ${test.endpoint}\n`;
        markdown += `- **Duration:** ${test.durationMs.toFixed(0)}ms\n`;
        if (test.requestDetails) markdown += `\n**Request:**\n\`\`\`json\n${JSON.stringify(test.requestDetails, null, 2)}\n\`\`\`\n`;
        if (test.responseDetails) markdown += `\n**Response:**\n\`\`\`json\n${JSON.stringify(test.responseDetails, null, 2)}\n\`\`\`\n`;
        markdown += `\n`;
      }
    }

    const failedTests = results.testCases.filter(tc => tc.status === TestStatus.FAILED || tc.status === TestStatus.ERROR);
    if (failedTests.length > 0) {
      markdown += `## Failed Tests (${failedTests.length})\n\n`;
      for (const test of failedTests) {
        markdown += `### ❌ ${test.name}\n\n`;
        markdown += `- **Endpoint:** ${test.endpoint}\n`;
        markdown += `- **Duration:** ${test.durationMs.toFixed(0)}ms\n`;
        if (test.errorMessage) markdown += `\n**Error:**\n\`\`\`\n${test.errorMessage}\n\`\`\`\n`;
        if (test.requestDetails) markdown += `\n**Request:**\n\`\`\`json\n${JSON.stringify(test.requestDetails, null, 2)}\n\`\`\`\n`;
        if (test.responseDetails) markdown += `\n**Response:**\n\`\`\`json\n${JSON.stringify(test.responseDetails, null, 2)}\n\`\`\`\n`;
        markdown += `\n**Suggested Fixes:**\n`;
        markdown += this.failureAnalyzer.generateFixSuggestions(test);
        markdown += `\n`;
      }
    }

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

  async saveMarkdownReport(markdown: string, taskKey: string, docsPath: string = 'docs/api-tests'): Promise<void> {
    log.info(`Saving Markdown report for task ${taskKey}`, { docsPath });
    try {
      await fs.mkdir(docsPath, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${taskKey}_${timestamp}.md`;
      const filepath = path.join(docsPath, filename);
      await fs.writeFile(filepath, markdown, 'utf-8');
      log.info(`Markdown report saved to ${filepath}`);
    } catch (error) {
      log.error(`Failed to save Markdown report for task ${taskKey}`, { error: String(error) });
      throw error;
    }
  }
}
