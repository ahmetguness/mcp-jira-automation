# Approval Manager

The Approval Manager module implements an optional approval workflow for API endpoint testing. When enabled, it generates a test plan, posts it to Jira for review, and waits for approval before executing tests.

## Features

- **Optional Approval Workflow**: Enable/disable via `REQUIRE_APPROVAL` environment variable
- **Test Plan Generation**: Automatically generates comprehensive test plans from endpoints and test scenarios
- **Jira Integration**: Posts test plans as comments and manages task status transitions
- **Approval Detection**: Monitors task status and detects when approval is granted
- **Automatic Execution**: When approval mode is disabled, tests execute immediately without waiting

## Requirements

This module implements the following requirements:

- **9.1**: Post test plan to Jira when `REQUIRE_APPROVAL=true`
- **9.2**: List endpoints and scenarios in test plan
- **9.3**: Set task status to "Approval Pending"
- **9.4**: Execute tests when status changes to "Approved"
- **9.5**: Skip approval when `REQUIRE_APPROVAL=false`

## Usage

### Basic Setup

```typescript
import { ApprovalManager } from './approval-manager/ApprovalManager.js';

const approvalManager = new ApprovalManager({
  jiraBaseUrl: 'https://your-domain.atlassian.net',
  jiraEmail: 'your-email@example.com',
  jiraApiToken: process.env.JIRA_API_TOKEN,
  requireApproval: true, // Enable approval mode
});
```

### Check if Approval is Required

```typescript
if (approvalManager.isApprovalRequired()) {
  console.log('Approval is required before test execution');
} else {
  console.log('Tests will execute automatically');
}
```

### Generate Test Plan

```typescript
const testPlan = approvalManager.generateTestPlan(endpoints, generatedTests);

// Test plan includes:
// - List of endpoints with URLs and HTTP methods
// - Test scenarios for each endpoint
// - Framework information
// - Estimated test count
// - Required environment variables
```

### Request Approval

```typescript
await approvalManager.requestApproval(
  'PROJ-123',
  endpoints,
  generatedTests
);

// This will:
// 1. Generate a test plan
// 2. Post it as a Jira comment
// 3. Set task status to "Approval Pending"
```

### Wait for Approval

```typescript
await approvalManager.waitForApproval(
  'PROJ-123',
  30000,   // Poll every 30 seconds
  3600000  // Timeout after 1 hour
);

// This will poll the task status until:
// - Status changes to "Approved" (success)
// - Timeout is reached (throws error)
```

### Check Approval Status

```typescript
const isApproved = await approvalManager.isTaskApproved('PROJ-123');

if (isApproved) {
  console.log('Task is approved, proceed with test execution');
} else {
  console.log('Task is not yet approved');
}
```

## Test Plan Format

The test plan posted to Jira includes:

```markdown
🔍 *API Test Plan - Approval Required*

The following API tests are ready to be executed. Please review and approve.

## Test Summary

- **Framework:** pytest+requests
- **Total Endpoints:** 2
- **Estimated Test Count:** 6

## Endpoints to Test

### 1. GET https://api.example.com/users

**Test Scenarios:**
- success
- unauthorized
- not_found

### 2. POST https://api.example.com/users

**Test Scenarios:**
- success
- validation_error
- duplicate_email

## Required Environment Variables

- `API_BASE_URL`
- `API_TOKEN`

## Approval Instructions

To approve and execute these tests:
1. Review the endpoints and test scenarios above
2. Ensure all required environment variables are configured
3. Change the task status to **"Approved"**

The tests will execute automatically once approved.
```

## Approval Workflow

### With Approval Required (`REQUIRE_APPROVAL=true`)

1. **Test Generation**: System generates test scripts
2. **Test Plan Creation**: ApprovalManager creates test plan
3. **Jira Comment**: Test plan posted to Jira task
4. **Status Change**: Task status set to "Approval Pending"
5. **Waiting**: System polls task status every 30 seconds
6. **Approval**: User reviews and changes status to "Approved"
7. **Detection**: System detects status change
8. **Execution**: Tests execute automatically

### Without Approval (`REQUIRE_APPROVAL=false`)

1. **Test Generation**: System generates test scripts
2. **Immediate Execution**: Tests execute immediately without approval

## Configuration

### Environment Variables

```bash
# Enable approval mode (default: false)
REQUIRE_APPROVAL=true

# Jira configuration
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

### Orchestrator Integration

The ApprovalManager is integrated into the ApiTestOrchestrator:

```typescript
import { ApiTestOrchestrator } from './orchestrator/ApiTestOrchestrator.js';

const orchestrator = new ApiTestOrchestrator({
  jira: {
    jiraBaseUrl: process.env.JIRA_BASE_URL,
    jiraEmail: process.env.JIRA_EMAIL,
    jiraApiToken: process.env.JIRA_API_TOKEN,
    botUserId: process.env.JIRA_BOT_USER_ID,
  },
  requireApproval: process.env.REQUIRE_APPROVAL === 'true',
});

// The orchestrator automatically handles approval workflow
await orchestrator.processTask(task);
```

## Error Handling

### Approval Timeout

If approval is not granted within the timeout period (default: 1 hour):

```typescript
try {
  await approvalManager.waitForApproval('PROJ-123');
} catch (error) {
  console.error('Approval timeout:', error.message);
  // Handle timeout (e.g., notify user, log error)
}
```

### Jira API Errors

If Jira API calls fail:

```typescript
try {
  await approvalManager.requestApproval('PROJ-123', endpoints, generatedTests);
} catch (error) {
  console.error('Failed to request approval:', error.message);
  // Handle error (e.g., retry, fallback to auto-execution)
}
```

### Status Transition Errors

If the task doesn't have an "Approval Pending" or "Approved" status available:

- The system logs a warning with available transitions
- An error is thrown explaining the issue
- The user should configure Jira workflow to include these statuses

## Best Practices

1. **Use Approval for Production**: Enable approval mode when testing production endpoints
2. **Disable for Development**: Disable approval for faster iteration in development
3. **Configure Timeouts**: Adjust polling interval and timeout based on your team's response time
4. **Monitor Logs**: Check logs for approval status and any errors
5. **Jira Workflow**: Ensure your Jira workflow includes "Approval Pending" and "Approved" statuses

## Integration with Pipeline

The approval workflow is integrated into the main pipeline between test generation and execution:

```
Jira Task → Parse → Validate → Resolve Repo → Retrieve Context
    ↓
Generate Tests
    ↓
[Approval Workflow] ← Only if REQUIRE_APPROVAL=true
    ↓
Execute Tests → Report Results
```

## See Also

- [ApiTestOrchestrator](../orchestrator/README.md) - Main orchestration module
- [TestScriptGenerator](../test-script-generator/README.md) - Test generation module
- [TestExecutor](../test-executor/README.md) - Test execution module
- [Example Usage](./example-usage.ts) - Code examples
