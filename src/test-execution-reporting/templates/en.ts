/**
 * English language template for test execution reports
 */

export interface ReportTemplate {
  header: string;
  executionTime: string;
  duration: string;
  summaryHeader: string;
  totalTests: string;
  passed: string;
  failed: string;
  skipped: string;
  successRate: string;
  testResultsHeader: string;
  passedTestsHeader: string;
  failedTestsHeader: string;
  skippedTestsHeader: string;
  errorsHeader: string;
  noErrors: string;
  syntaxError: string;
  dependencyError: string;
  timeoutError: string;
  runtimeError: string;
  stackTrace: string;
  missingDependencies: string;
  executionDuration: string;
  errorDetails: string;
  dockerMetadataHeader: string;
  dockerContainerId: string;
  dockerImageName: string;
  dockerNetworkMode: string;
}

export const englishTemplate: ReportTemplate = {
  header: '# Test Execution Report',
  executionTime: '**Execution Time**',
  duration: '**Duration**',
  summaryHeader: '## Summary',
  totalTests: '**Total Tests**',
  passed: '**Passed**',
  failed: '**Failed**',
  skipped: '**Skipped**',
  successRate: '**Success Rate**',
  testResultsHeader: '## Test Results',
  passedTestsHeader: '### Passed Tests',
  failedTestsHeader: '### Failed Tests',
  skippedTestsHeader: '### Skipped Tests',
  errorsHeader: '## Errors',
  noErrors: 'No errors encountered during test execution.',
  syntaxError: '⚠️ **Syntax Error**',
  dependencyError: '⚠️ **Dependency Error**',
  timeoutError: '⚠️ **Timeout Error**',
  runtimeError: '⚠️ **Runtime Error**',
  stackTrace: 'Stack Trace',
  missingDependencies: 'Missing Dependencies',
  executionDuration: 'Execution Duration',
  errorDetails: 'Error Details',
  dockerMetadataHeader: '## Docker Execution Metadata',
  dockerContainerId: '**Container ID**',
  dockerImageName: '**Image Name**',
  dockerNetworkMode: '**Network Mode**',
};
