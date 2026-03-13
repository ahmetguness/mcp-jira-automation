/**
 * Report Generator Component
 * 
 * Responsible for formatting test results as markdown in the appropriate language.
 */

import type { ReportGenerator, TestResult, ReportLanguage, TestError, RawTestResult, DockerRawTestResult } from './types.js';
import { englishTemplate, turkishTemplate, type ReportTemplate } from './templates/index.js';

export class DefaultReportGenerator implements ReportGenerator {
  private readonly maxStackTraceLines = 500;

  generate(result: TestResult, language: ReportLanguage, rawResult?: RawTestResult): string {
    const template = this.getTemplate(language);
    const sections: string[] = [];

    // Header section
    sections.push(template.header);
    sections.push('');
    sections.push(`${template.executionTime}: ${this.formatTimestamp(result.timestamp)}`);
    sections.push(`${template.duration}: ${this.formatDuration(result.executionTime)}`);
    sections.push('');

    // Docker metadata section (if available)
    if (rawResult && this.isDockerResult(rawResult)) {
      sections.push(template.dockerMetadataHeader);
      sections.push('');
      sections.push(`${template.dockerContainerId}: \`${rawResult.docker.containerId}\``);
      sections.push(`${template.dockerImageName}: \`${rawResult.docker.imageName}\``);
      sections.push(`${template.dockerNetworkMode}: \`${rawResult.docker.networkMode}\``);
      sections.push('');
    }

    // Summary section
    sections.push(template.summaryHeader);
    sections.push('');
    sections.push(`- ${template.totalTests}: ${result.summary.total}`);
    sections.push(`- ${template.passed}: ${result.summary.passed} ✅`);
    sections.push(`- ${template.failed}: ${result.summary.failed} ❌`);
    sections.push(`- ${template.skipped}: ${result.summary.skipped} ⏭️`);
    sections.push(`- ${template.successRate}: ${result.summary.successRate.toFixed(1)}%`);
    sections.push('');

    // Test Results section
    sections.push(template.testResultsHeader);
    sections.push('');

    // Passed tests
    const passedTests = result.tests.filter(t => t.status === 'passed');
    if (passedTests.length > 0) {
      sections.push(template.passedTestsHeader);
      sections.push('');
      for (const test of passedTests) {
        sections.push(`- ✅ ${this.escapeMarkdown(test.name)} (${test.duration}ms)`);
      }
      sections.push('');
    }

    // Failed tests
    const failedTests = result.tests.filter(t => t.status === 'failed');
    if (failedTests.length > 0) {
      sections.push(template.failedTestsHeader);
      sections.push('');
      for (const test of failedTests) {
        sections.push(`- ❌ ${this.escapeMarkdown(test.name)} (${test.duration}ms)`);
        if (test.error) {
          sections.push('  ```');
          sections.push(`  ${this.escapeMarkdown(test.error.message)}`);
          if (test.error.stack) {
            sections.push('');
            sections.push(`  ${template.stackTrace}:`);
            sections.push(this.formatStackTrace(test.error.stack));
          }
          sections.push('  ```');
        }
        sections.push('');
      }
    }

    // Skipped tests
    const skippedTests = result.tests.filter(t => t.status === 'skipped');
    if (skippedTests.length > 0) {
      sections.push(template.skippedTestsHeader);
      sections.push('');
      for (const test of skippedTests) {
        sections.push(`- ⏭️ ${this.escapeMarkdown(test.name)} (${test.duration}ms)`);
      }
      sections.push('');
    }

    // Errors section
    if (result.errors.length > 0) {
      sections.push(template.errorsHeader);
      sections.push('');
      for (const error of result.errors) {
        sections.push(this.formatError(error, template));
        sections.push('');
      }
    }

    return sections.join('\n');
  }

  private isDockerResult(result: RawTestResult): result is DockerRawTestResult {
    return 'docker' in result && typeof result.docker === 'object' && result.docker !== null;
  }

  private getTemplate(language: ReportLanguage): ReportTemplate {
    return language === 'tr' ? turkishTemplate : englishTemplate;
  }

  private formatTimestamp(timestamp: Date): string {
    // Handle invalid dates
    if (isNaN(timestamp.getTime())) {
      return 'Invalid Date';
    }
    return timestamp.toISOString().replace('T', ' ').substring(0, 19);
  }

  private formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${milliseconds}ms`;
    }
    const seconds = Math.floor(milliseconds / 1000);
    const ms = milliseconds % 1000;
    if (seconds < 60) {
      return `${seconds}s ${ms}ms`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  private escapeMarkdown(text: string): string {
    // Escape special markdown characters
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/`/g, '\\`')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/\./g, '\\.')
      .replace(/!/g, '\\!');
  }

  private formatStackTrace(stack: string): string {
    const lines = stack.split('\n');
    
    // Truncate if too long
    if (lines.length > this.maxStackTraceLines) {
      const truncated = lines.slice(0, this.maxStackTraceLines);
      truncated.push(`  ... (truncated: ${lines.length - this.maxStackTraceLines} more lines)`);
      return truncated.map(line => `  ${line}`).join('\n');
    }
    
    return lines.map(line => `  ${line}`).join('\n');
  }

  private formatError(error: TestError, template: ReportTemplate): string {
    const sections: string[] = [];

    // Error type header
    switch (error.type) {
      case 'syntax':
        sections.push(template.syntaxError);
        break;
      case 'dependency':
        sections.push(template.dependencyError);
        break;
      case 'timeout':
        sections.push(template.timeoutError);
        break;
      case 'runtime':
      case 'assertion':
        sections.push(template.runtimeError);
        break;
    }

    sections.push('');
    sections.push(`**${template.errorDetails}:**`);
    sections.push('```');
    sections.push(this.escapeMarkdown(error.message));
    
    if (error.stack) {
      sections.push('');
      sections.push(`${template.stackTrace}:`);
      sections.push(this.formatStackTrace(error.stack));
    }
    
    sections.push('```');

    // Add troubleshooting hints based on error type
    if (error.type === 'dependency') {
      sections.push('');
      sections.push(this.extractMissingDependencies(error.message, template));
    } else if (error.type === 'timeout') {
      sections.push('');
      sections.push(this.extractTimeoutInfo(error.message, template));
    }

    return sections.join('\n');
  }

  private extractMissingDependencies(message: string, template: ReportTemplate): string {
    // Extract module names from error messages like "Cannot find module 'xyz'"
    const modulePattern = /Cannot find module ['"]([^'"]+)['"]/g;
    const matches = [...message.matchAll(modulePattern)];
    
    if (matches.length > 0) {
      const modules = matches.map(m => m[1]);
      return `**${template.missingDependencies}:** ${modules.join(', ')}`;
    }
    
    return '';
  }

  private extractTimeoutInfo(message: string, template: ReportTemplate): string {
    // Extract duration information from timeout messages
    const durationPattern = /(\d+)\s*(ms|milliseconds|s|seconds|m|minutes)/i;
    const match = message.match(durationPattern);
    
    if (match) {
      return `**${template.executionDuration}:** ${match[0]}`;
    }
    
    return '';
  }
}
