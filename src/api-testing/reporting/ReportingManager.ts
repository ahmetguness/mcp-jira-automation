import type { TestResults, CommitConfig, CommitResult, RepositoryInfo, TestFile } from '../models/types.js';
import { ResultCollector } from './ResultCollector.js';
import { PRCreator } from './PRCreator.js';
import { JiraReporter, type JiraReporterConfig } from './JiraReporter.js';
import type { ScmProvider } from '../../scm/provider.js';
import { createLogger } from '../../logger.js';

const log = createLogger('api-testing:reporting-manager');

export interface ReportingManagerConfig extends JiraReporterConfig {
  scmProvider?: ScmProvider;
}

export class ReportingManager {
  public resultCollector: ResultCollector;
  public prCreator: PRCreator;
  public jiraReporter: JiraReporter;

  constructor(config: ReportingManagerConfig) {
    this.resultCollector = new ResultCollector();
    this.prCreator = new PRCreator(config.scmProvider);
    this.jiraReporter = new JiraReporter({
      jiraBaseUrl: config.jiraBaseUrl,
      jiraEmail: config.jiraEmail,
      jiraApiToken: config.jiraApiToken,
      maxRetryAttempts: config.maxRetryAttempts,
    });
    
    log.info('ReportingManager initialized');
  }

  // Facade methods to act as a drop-in replacement for old TestReporter interface

  async reportToJira(taskKey: string, results: TestResults): Promise<void> {
    return this.jiraReporter.reportToJira(taskKey, results);
  }

  async updateTaskStatus(taskKey: string, results: TestResults, retryCount: number = 0): Promise<void> {
    return this.jiraReporter.updateTaskStatus(taskKey, results, retryCount);
  }

  async commitToScm(
    repo: RepositoryInfo,
    testFiles: TestFile[],
    results: TestResults,
    config: CommitConfig,
    taskKey: string
  ): Promise<CommitResult> {
    return this.prCreator.commitToScm(repo, testFiles, results, config, taskKey);
  }
}

export * from './ResultCollector.js';
export * from './PRCreator.js';
export * from './JiraReporter.js';
export * from './FailureAnalyzer.js';
