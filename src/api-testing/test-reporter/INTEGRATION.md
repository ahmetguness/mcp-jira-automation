# TestReporter Integration Guide

This document describes how to integrate the TestReporter module into the ApiTestOrchestrator.

## Current Status

The TestReporter module is **fully implemented** with the following capabilities:
- ✅ Report test results to Jira with formatted comments
- ✅ Update task status based on test outcomes
- ✅ Add appropriate labels (test-failed, permanently-failed)
- ✅ Generate comprehensive Markdown documentation
- ✅ Save reports to docs/api-tests/ directory
- ⏳ SCM integration (placeholder - will be implemented in Task 12)

## Integration Steps

### 1. Add TestReporter to Orchestrator

Update `ApiTestOrchestrator.ts` to include the TestReporter:

```typescript
import { TestReporter } from '../test-reporter/TestReporter.js';

class ApiTestOrchestrator {
  private testReporter: TestReporter;
  
  constructor(config: OrchestratorConfig) {
    // ... existing initialization
    
    // Initialize TestReporter
    this.testReporter = new TestReporter({
      jiraBaseUrl: config.jira.jiraBaseUrl,
      jiraEmail: config.jira.jiraEmail,
      jiraApiToken: config.jira.jiraApiToken,
      maxRetryAttempts: config.maxRetryAttempts ?? 3,
    });
  }
}
```

### 2. Update reportResults Method

Replace the placeholder `reportResults` method with actual implementation:

```typescript
private async reportResults(
  task: JiraTask,
  testResults: TestResults,
  generatedTests: GeneratedTests,
  repository: RepositoryInfo
): Promise<void> {
  log.info(`Reporting results for task ${task.key}`);

  try {
    // 1. Report results to Jira
    await this.testReporter.reportToJira(task.key, testResults);
    log.info(`Results reported to Jira for task ${task.key}`);

    // 2. Update task status
    const retryCount = 0; // TODO: Track retry count in orchestrator state
    await this.testReporter.updateTaskStatus(task.key, testResults, retryCount);
    log.info(`Task status updated for ${task.key}`);

    // 3. Generate and save Markdown report
    const markdown = this.testReporter.generateMarkdownReport(testResults, task.key);
    await this.testReporter.saveMarkdownReport(markdown, task.key);
    log.info(`Markdown report saved for task ${task.key}`);

    // 4. Commit to SCM (when Task 12 is complete)
    // const commitConfig: CommitConfig = {
    //   commitTestScripts: true,
    //   commitTestResults: false,
    //   createPullRequest: false,
    //   branchPrefix: 'api-test',
    // };
    // await this.testReporter.commitToScm(
    //   repository,
    //   generatedTests.testFiles.map(f => f.content),
    //   testResults,
    //   commitConfig,
    //   task.key
    // );

  } catch (error) {
    log.error(`Failed to report results for task ${task.key}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - reporting failure shouldn't stop the pipeline
    // But we should notify the user
    await this.postJiraComment(
      task.key,
      `⚠️ Warning: Failed to fully report test results. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

### 3. Add Retry Tracking (Optional Enhancement)

To support the "permanently-failed" label after max retries, add retry tracking:

```typescript
interface OrchestratorConfig {
  // ... existing config
  maxRetryAttempts?: number;  // Default: 3
}

class ApiTestOrchestrator {
  private taskRetryCount: Map<string, number> = new Map();
  
  async processTask(task: JiraTask): Promise<TaskProcessingResult> {
    // Get current retry count
    const retryCount = this.taskRetryCount.get(task.key) ?? 0;
    
    try {
      // ... existing pipeline logic
      
      // On success, clear retry count
      this.taskRetryCount.delete(task.key);
      
    } catch (error) {
      // On failure, increment retry count
      this.taskRetryCount.set(task.key, retryCount + 1);
      
      // Pass retry count to reporter
      await this.testReporter.updateTaskStatus(task.key, testResults, retryCount + 1);
    }
  }
}
```

### 4. Configuration Updates

Add TestReporter configuration to the orchestrator config:

```typescript
interface OrchestratorConfig {
  jira: {
    jiraBaseUrl: string;
    jiraEmail: string;
    jiraApiToken: string;
    botUserIdentifier: string;
  };
  repository: {
    defaultProvider: ScmProvider;
    defaultBranch: string;
    cloneDepth: number;
  };
  requireApproval?: boolean;
  enablePolling?: boolean;
  maxRetryAttempts?: number;  // NEW: For TestReporter
}
```

## Testing Integration

### Unit Test Example

```typescript
describe('ApiTestOrchestrator - Result Reporting', () => {
  it('should report test results to Jira', async () => {
    const orchestrator = new ApiTestOrchestrator(mockConfig);
    const task = createMockTask();
    const results = createMockTestResults();
    
    await orchestrator['reportResults'](task, results, mockTests, mockRepo);
    
    // Verify Jira comment was posted
    expect(mockJiraClient.addComment).toHaveBeenCalledWith(
      task.key,
      expect.stringContaining('API Test Results')
    );
  });
  
  it('should update task status to Done when all tests pass', async () => {
    const results = createMockTestResults({ allPassed: true });
    
    await orchestrator['reportResults'](task, results, mockTests, mockRepo);
    
    expect(mockJiraClient.transitionIssue).toHaveBeenCalledWith(
      task.key,
      'Done'
    );
  });
  
  it('should add test-failed label when tests fail', async () => {
    const results = createMockTestResults({ someFailed: true });
    
    await orchestrator['reportResults'](task, results, mockTests, mockRepo);
    
    expect(mockJiraClient.updateIssue).toHaveBeenCalledWith(
      task.key,
      expect.objectContaining({
        update: { labels: [{ add: 'test-failed' }] }
      })
    );
  });
});
```

## Error Handling

The TestReporter includes comprehensive error handling:

1. **Jira API Failures**: Logged and reported, but don't stop the pipeline
2. **File System Errors**: Logged when saving Markdown reports
3. **Network Issues**: Retried automatically by Jira API
4. **Invalid Data**: Validated before processing

## Performance Considerations

- Jira API calls are sequential to avoid rate limiting
- Markdown generation is synchronous but fast (< 100ms)
- File I/O is async and non-blocking
- No caching needed - reports are generated once per test run

## Future Enhancements

When Task 12 (SCM Integration) is complete:

1. Uncomment the `commitToScm` call in `reportResults`
2. Add SCM configuration to `OrchestratorConfig`
3. Handle SCM commit failures gracefully
4. Add PR creation support

## See Also

- [TestReporter README](./README.md) - Module documentation
- [Example Usage](./example-usage.ts) - Code examples
- [Orchestrator](../orchestrator/ApiTestOrchestrator.ts) - Integration point
