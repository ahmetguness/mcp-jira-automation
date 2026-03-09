# Test Reporter Module

The Test Reporter module is responsible for reporting API test results to Jira, updating task status, and generating comprehensive documentation.

## Features

- **Jira Integration**: Post formatted test results as comments to Jira tasks
- **Task Status Management**: Automatically update task status based on test outcomes
- **Label Management**: Add appropriate labels (test-failed, permanently-failed)
- **Markdown Reports**: Generate comprehensive documentation with examples and fix suggestions
- **Performance Metrics**: Include response time statistics in reports
- **Error Analysis**: Provide actionable fix suggestions for failed tests
- **SCM Integration**: Commit test scripts and results to version control (GitHub, GitLab, Bitbucket)
- **Pull Request Creation**: Optionally create PRs with test summaries

## Requirements Covered

- **4.1-4.7**: Test result reporting to Jira with comprehensive formatting
- **5.1-5.7**: SCM integration for test artifacts (branch creation, file organization, commit messages)
- **8.1-8.6**: Markdown documentation generation with examples
- **10.3, 10.6**: Permanent failure handling after max retries
- **12.5**: Performance metrics reporting

## Usage

### Basic Setup

```typescript
import { TestReporter } from './test-reporter/TestReporter.js';
import { createScmProvider } from './scm/index.js';

// Without SCM integration
const reporter = new TestReporter({
  jiraBaseUrl: 'https://company.atlassian.net',
  jiraEmail: 'bot@company.com',
  jiraApiToken: process.env.JIRA_API_TOKEN,
  maxRetryAttempts: 3,
});

// With SCM integration
const scmProvider = createScmProvider(config, mcp);
const reporterWithScm = new TestReporter({
  jiraBaseUrl: 'https://company.atlassian.net',
  jiraEmail: 'bot@company.com',
  jiraApiToken: process.env.JIRA_API_TOKEN,
  maxRetryAttempts: 3,
  scmProvider, // Optional: enables SCM commit functionality
});
```

### Report Test Results to Jira

```typescript
const results: TestResults = {
  totalTests: 5,
  passedTests: 4,
  failedTests: 1,
  skippedTests: 0,
  durationSeconds: 12.5,
  timestamp: new Date(),
  testCases: [
    {
      name: 'GET /api/users returns 200',
      endpoint: 'GET /api/users',
      status: TestStatus.PASSED,
      durationMs: 120,
    },
    // ... more test cases
  ],
  performanceMetrics: {
    minResponseTimeMs: 85,
    maxResponseTimeMs: 250,
    avgResponseTimeMs: 146,
    successRate: 0.8,
  },
};

// Report to Jira
await reporter.reportToJira('PROJ-123', results);

// Update task status
await reporter.updateTaskStatus('PROJ-123', results, 0);
```

### Generate Markdown Documentation

```typescript
// Generate report
const markdown = reporter.generateMarkdownReport(results, 'PROJ-123');

// Save to file
await reporter.saveMarkdownReport(markdown, 'PROJ-123', 'docs/api-tests');
```

### Handle Permanent Failures

```typescript
// After max retries (3 attempts)
await reporter.updateTaskStatus('PROJ-123', results, 3);
// This will add the "permanently-failed" label
```

### Commit Test Artifacts to SCM

```typescript
import type { RepositoryInfo, TestFile, CommitConfig } from './models/types.js';
import { ScmProvider } from './models/enums.js';

// Repository information
const repo: RepositoryInfo = {
  url: 'owner/repo', // Format depends on SCM provider
  provider: ScmProvider.GITHUB,
  branch: 'main',
  authToken: process.env.GITHUB_TOKEN,
  cloneDepth: 1,
};

// Generated test files
const testFiles: TestFile[] = [
  {
    path: 'tests/api/test_users.py',
    content: '# Test content here',
    testCount: 2,
    coveredEndpoints: ['GET /api/users', 'POST /api/users'],
  },
];

// Commit configuration
const commitConfig: CommitConfig = {
  commitTestScripts: true,    // Commit test files to tests/api/
  commitTestResults: true,     // Commit results JSON to test-results/
  createPullRequest: true,     // Create PR with test summary
  branchPrefix: 'api-test',    // Branch name: api-test/{jira-key}
};

// Commit to SCM
const result = await reporter.commitToScm(
  repo,
  testFiles,
  results,
  commitConfig,
  'PROJ-123'
);

if (result.success) {
  console.log(`Branch: ${result.branchName}`);
  console.log(`PR: ${result.pullRequestUrl}`);
}
```

## Report Format

### Jira Comment Format

```markdown
## API Test Results

**Summary:** 4/5 tests passed (80.0% success rate)
**Duration:** 12.50 seconds
**Timestamp:** 2024-01-15T14:30:00.000Z

### Passed Tests (4)

- ✅ GET /api/users - GET /api/users returns 200 (120ms)
- ✅ POST /api/users - POST /api/users creates user (250ms)
- ✅ GET /api/users/123 - GET /api/users/:id returns user (95ms)
- ✅ DELETE /api/users/123 - DELETE /api/users/:id removes user (180ms)

### Failed Tests (1)

- ❌ GET /api/users/999 - GET /api/users/:id handles not found
  Error: Expected status 404, got 500
  Response: `{"error":"Internal Server Error"}`

### Performance Metrics

- Min response time: 85ms
- Max response time: 250ms
- Avg response time: 146ms
```

### Markdown Documentation Format

The generated Markdown report includes:

1. **Summary Section**: Test counts, success rate, duration
2. **Performance Metrics**: Response time statistics
3. **Passed Tests**: With request/response examples
4. **Failed Tests**: With error analysis and fix suggestions
5. **Summary Table**: Quick overview of all endpoints

## Task Status Management

The reporter automatically manages task status based on test results:

| Test Outcome | Action |
|--------------|--------|
| All tests pass | Transition task to "Done" |
| Any test fails | Add "test-failed" label, keep "In Progress" |
| Max retries reached | Add "permanently-failed" label |

## Error Analysis

The reporter provides intelligent fix suggestions based on error types:

- **Timeout errors**: Check API responsiveness, increase timeout, verify network
- **401 Unauthorized**: Verify credentials, check token expiration
- **404 Not Found**: Verify URL, check resource existence
- **500 Server Error**: Check server logs, verify payload
- **400 Bad Request**: Verify request format, check required fields

## Configuration

### Environment Variables

```bash
JIRA_BASE_URL=https://company.atlassian.net
JIRA_EMAIL=bot@company.com
JIRA_API_TOKEN=your-api-token
```

### Reporter Config

```typescript
interface TestReporterConfig {
  jiraBaseUrl: string;        // Jira instance URL
  jiraEmail: string;          // Bot user email
  jiraApiToken: string;       // API token for authentication
  maxRetryAttempts?: number;  // Max retries before permanent failure (default: 3)
  scmProvider?: ScmProvider;  // Optional: SCM provider for committing artifacts
}
```

### Commit Config

```typescript
interface CommitConfig {
  commitTestScripts: boolean;   // Commit test files to tests/api/ (default: true)
  commitTestResults: boolean;   // Commit results JSON to test-results/ (default: false)
  createPullRequest: boolean;   // Create PR with test summary (default: false)
  branchPrefix: string;         // Branch name prefix (default: "api-test")
}
```

## SCM Integration

### Branch Naming

Test artifacts are committed to branches with the format: `{branchPrefix}/{jira-task-key}`

Example: `api-test/PROJ-123`

### File Organization

- **Test Scripts**: `tests/api/test_{endpoint}.py` (one file per endpoint)
- **Test Results**: `test-results/{jira-key}_{timestamp}.json`

### Commit Messages

Format: `[{JIRA-KEY}] Add API tests for {endpoint-summary}`

Example: `[PROJ-123] Add API tests for GET /api/users, POST /api/users`

### Pull Request Description

When `createPullRequest: true`, the PR includes:

- Test summary with success rate
- List of test files and covered endpoints
- Performance metrics
- Failed tests (if any)

Example:

```markdown
## API Tests for PROJ-123

This PR adds automated API tests generated from Jira task PROJ-123.

### Test Summary

- **Total Tests:** 5
- **Passed:** 4 ✅
- **Failed:** 1 ❌
- **Success Rate:** 80.0%
- **Duration:** 12.50s

### Test Files

- `tests/api/test_users.py` - 2 tests covering:
  - GET /api/users
  - POST /api/users

### Performance Metrics

- **Min Response Time:** 85ms
- **Max Response Time:** 250ms
- **Avg Response Time:** 146ms
```

### Directory Creation

Git automatically creates directories when files are added to paths. The system ensures:

- `tests/api/` directory exists when test scripts are committed
- `test-results/` directory exists when results are committed

No explicit directory creation is needed - Git handles this implicitly.

## Integration with Pipeline

The Test Reporter is typically used in the orchestration pipeline:

```typescript
// 1. Execute tests
const results = await testExecutor.executeTests(tests, config);

// 2. Report results to Jira
await testReporter.reportToJira(taskKey, results);

// 3. Update task status
await testReporter.updateTaskStatus(taskKey, results, retryCount);

// 4. Generate documentation
const markdown = testReporter.generateMarkdownReport(results, taskKey);
await testReporter.saveMarkdownReport(markdown, taskKey);

// 5. Commit test artifacts to SCM (optional)
if (scmProvider) {
  const commitResult = await testReporter.commitToScm(
    repo,
    testFiles,
    results,
    commitConfig,
    taskKey
  );
  
  if (commitResult.success && commitResult.pullRequestUrl) {
    // Add PR link to Jira comment
    await testReporter.reportToJira(taskKey, {
      ...results,
      additionalInfo: `Pull Request: ${commitResult.pullRequestUrl}`,
    });
  }
}
```

## Error Handling

The reporter includes comprehensive error handling:

- Retries Jira API calls on transient failures
- Logs all operations for debugging
- Throws descriptive errors for permanent failures
- Continues execution even if optional operations fail
- Handles SCM commit failures gracefully
- Returns detailed error information in CommitResult

## Future Enhancements

- Trend analysis across multiple test runs
- Integration with notification systems (Slack, email)
- Support for additional SCM providers
- Automatic test result comparison with previous runs

## See Also

- [Example Usage](./example-usage.ts) - Complete examples
- [Test Executor](../test-executor/README.md) - Test execution module
- [API Testing Overview](../README.md) - System architecture
