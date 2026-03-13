/**
 * Pipeline Orchestration
 * 
 * Orchestrates the complete test execution and reporting pipeline.
 * Chains: TestExecutor → ResultCollector → LanguageDetector → ReportGenerator → PRUpdater
 */

import type {
  TestExecutionContext,
  ExecutionResult,
  TestExecutor,
  ResultCollector,
  LanguageDetector,
  ReportGenerator,
  PRUpdater,
  RawTestResult,
  TestResult,
  ReportLanguage,
  PipelineError,
  ExecutionOptions,
  UpdateOptions,
} from './types.js';
import { createLogger } from '../logger.js';

const log = createLogger('test-execution-reporting:pipeline');

/**
 * Pipeline orchestrator that chains all components
 */
export class TestExecutionPipeline {
  constructor(
    private testExecutor: TestExecutor,
    private resultCollector: ResultCollector,
    private languageDetector: LanguageDetector,
    private reportGenerator: ReportGenerator,
    private prUpdater: PRUpdater
  ) {}

  /**
   * Execute the complete pipeline
   * @param context - Test execution context
   * @returns Complete execution result
   */
  async execute(context: TestExecutionContext): Promise<ExecutionResult> {
    log.info(`Starting pipeline execution for test file: ${context.testFilePath}`);

    const errors: PipelineError[] = [];
    let rawResult: RawTestResult;
    let testResult: TestResult;
    let language: ReportLanguage;
    let report: string;
    let reportCommitted = false;

    // Stage 1: Test Execution
    try {
      log.info('Stage 1: Executing tests...');
      const executionOptions: ExecutionOptions = {
        timeout: 300000, // 5 minutes
        cwd: context.repositoryPath,
      };
      rawResult = await this.testExecutor.execute(context.testFilePath, executionOptions);
      log.info(`Test execution completed with exit code: ${rawResult.exitCode}`);
    } catch (error) {
      log.error(error);
      const pipelineError = this.createPipelineError('execution', error, false);
      errors.push(pipelineError);

      // Create a fallback raw result for error reporting
      rawResult = {
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        duration: 0,
        framework: 'unknown',
        timedOut: false,
        timestamp: Date.now(),
      };
    }

    // Stage 2: Result Collection
    try {
      log.info('Stage 2: Collecting test results...');
      testResult = this.resultCollector.collect(rawResult);
      log.info(`Collected ${testResult.summary.total} test results`);
    } catch (error) {
      log.error(error);
      const pipelineError = this.createPipelineError('collection', error, true);
      errors.push(pipelineError);

      // Create a fallback test result for error reporting
      testResult = {
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          successRate: 0,
        },
        tests: [],
        errors: [{
          message: error instanceof Error ? error.message : String(error),
          type: 'runtime',
        }],
        executionTime: rawResult.duration,
        timestamp: new Date(),
      };
    }

    // Stage 3: Language Detection
    try {
      log.info('Stage 3: Detecting report language...');
      language = this.languageDetector.detect(context.jiraTaskContent);
      log.info(`Detected language: ${language}`);
    } catch (error) {
      log.warn('Language detection failed, defaulting to English');
      const pipelineError = this.createPipelineError('detection', error, true);
      errors.push(pipelineError);
      language = 'en'; // Default to English on error
    }

    // Stage 4: Report Generation
    try {
      log.info('Stage 4: Generating markdown report...');
      report = this.reportGenerator.generate(testResult, language, rawResult);
      log.info(`Generated report (${report.length} characters)`);
    } catch (error) {
      log.error(error);
      const pipelineError = this.createPipelineError('generation', error, false);
      errors.push(pipelineError);

      // Create a fallback error report
      report = this.createFallbackReport(testResult, language, error);
    }

    // Stage 5: PR Update
    try {
      log.info('Stage 5: Committing report to PR...');
      const updateOptions: UpdateOptions = {
        maxRetries: 3,
        retryDelay: 1000,
      };
      reportCommitted = await this.prUpdater.addReport(context.prUrl, report, updateOptions);
      
      if (!reportCommitted) {
        // PR update failed but didn't throw - create error
        const pipelineError: PipelineError = {
          stage: 'commit',
          message: 'Failed to commit report to PR after retries',
          recoverable: true,
        };
        errors.push(pipelineError);
        log.warn('Report commit failed after retries');
      } else {
        log.info('Report commit succeeded');
      }
    } catch (error) {
      log.error(error);
      const pipelineError = this.createPipelineError('commit', error, true);
      errors.push(pipelineError);
      // reportCommitted remains false (initialized at top)
    }

    // Log pipeline completion
    if (errors.length === 0) {
      log.info('Pipeline completed successfully');
    } else {
      log.warn(`Pipeline completed with ${errors.length} error(s)`);
      errors.forEach((err, idx) => {
        log.warn(`Error ${idx + 1}: [${err.stage}] ${err.message} (recoverable: ${err.recoverable})`);
      });
    }

    return {
      context,
      rawResult,
      testResult,
      language,
      report,
      reportCommitted,
      errors,
    };
  }

  /**
   * Create a pipeline error from an exception
   * @param stage - Pipeline stage where error occurred
   * @param error - The error that occurred
   * @param recoverable - Whether the error is recoverable
   * @returns Pipeline error object
   */
  private createPipelineError(
    stage: PipelineError['stage'],
    error: unknown,
    recoverable: boolean
  ): PipelineError {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    return {
      stage,
      message,
      stack,
      recoverable,
    };
  }

  /**
   * Create a fallback error report when report generation fails
   * @param testResult - Test result data
   * @param language - Report language
   * @param error - The error that occurred
   * @returns Fallback markdown report
   */
  private createFallbackReport(
    testResult: TestResult,
    language: ReportLanguage,
    error: unknown
  ): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const header = language === 'tr' ? '# Test Çalıştırma Raporu' : '# Test Execution Report';
    const errorHeader = language === 'tr' ? '## Hata' : '## Error';
    const errorText = language === 'tr'
      ? 'Rapor oluşturulurken bir hata oluştu:'
      : 'An error occurred while generating the report:';
    const summaryHeader = language === 'tr' ? '## Özet' : '## Summary';

    return `${header}

${errorHeader}

${errorText}

\`\`\`
${errorMessage}
\`\`\`

${summaryHeader}

- Total Tests / Toplam Test: ${testResult.summary.total}
- Passed / Başarılı: ${testResult.summary.passed}
- Failed / Başarısız: ${testResult.summary.failed}
- Skipped / Atlandı: ${testResult.summary.skipped}
- Success Rate / Başarı Oranı: ${testResult.summary.successRate.toFixed(1)}%
`;
  }
}
