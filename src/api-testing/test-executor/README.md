# Test Executor Module

Executes API tests in isolated Docker containers with timeout, retry, and performance tracking capabilities.

## Features

- **Docker Isolation** (Req 3.1, 3.5): Each test runs in a fresh Docker container that is destroyed after execution
- **Framework Support** (Req 6.6): Supports pytest+requests, pytest+httpx, jest+supertest, and postman+newman
- **Timeout Handling** (Req 3.4): Enforces configurable timeouts with graceful SIGTERM/SIGKILL termination
- **Output Capture** (Req 3.6): Captures stdout and stderr from test execution
- **Retry Logic** (Req 3.7, 10.1, 10.2): Implements exponential backoff retry for network errors
- **Error Classification** (Req 10.4, 10.5): Distinguishes retryable (5xx, network) from non-retryable (4xx, timeout) errors
- **Credential Security** (Req 7.5, 7.6): Passes credentials as environment variables only and clears them after execution
- **Performance Metrics** (Req 12.2, 12.5): Collects min/max/avg response times and success rates
- **Threshold Validation** (Req 12.3): Validates performance against configured thresholds

## Usage

```typescript
import { TestExecutor } from './test-executor';
import { TestFramework, Environment } from './models/enums';

const executor = new TestExecutor();

const tests = {
  testFiles: [
    {
      path: 'tests/api/test_users.py',
      content: '...',
      testCount: 5,
      coveredEndpoints: ['/users', '/users/:id'],
    },
  ],
  framework: TestFramework.PYTEST_REQUESTS,
  requiredEnvVars: ['API_BASE_URL', 'API_TOKEN'],
  setupCommands: ['pip install requests pytest'],
  runCommand: 'pytest tests/api/ -v',
  warnings: [],
};

const config = {
  environment: Environment.STAGING,
  timeoutSeconds: 300,
  retryCount: 3,
  retryBackoffSeconds: [1, 2, 4],
  allowDestructiveOps: false,
  credentials: {
    API_BASE_URL: 'http://api.example.com',
    API_TOKEN: 'secret-token',
  },
};

const results = await executor.executeTests(tests, config);
```

## Docker Images

The executor automatically selects the appropriate Docker image based on the test framework:

- **pytest+requests** / **pytest+httpx**: `python:3.11-slim`
- **jest+supertest**: `node:18-alpine`
- **postman+newman**: `postman/newman:alpine`

## Timeout Behavior

When a test exceeds the configured timeout:

1. SIGTERM is sent to the container (30-second grace period)
2. If container doesn't stop, SIGKILL is sent
3. Container is forcefully removed
4. Timeout error is returned in results

## Retry Logic

Network errors and 5xx server errors trigger automatic retry with exponential backoff:

- Attempt 1: Immediate
- Attempt 2: After 1 second
- Attempt 3: After 2 seconds
- Attempt 4: After 4 seconds

Non-retryable errors (4xx, timeouts, authentication failures) fail immediately.

## Performance Metrics

The executor collects and returns:

- **minResponseTimeMs**: Fastest test execution time
- **maxResponseTimeMs**: Slowest test execution time
- **avgResponseTimeMs**: Average test execution time
- **successRate**: Percentage of tests that passed (0.0 to 1.0)
- **requestsPerSecond**: Throughput (optional)

## Security

- Credentials are passed to containers as environment variables only
- Credentials are never written to files or command arguments
- Credentials are cleared from memory after execution
- Containers run with security constraints (no-new-privileges, dropped capabilities)

## Error Handling

The executor handles various error scenarios:

- **Network errors**: Retried with exponential backoff
- **Timeout errors**: Container terminated gracefully, then forcefully
- **Container creation failures**: Reported immediately
- **Image pull failures**: Automatic retry with progress tracking
- **Cleanup failures**: Logged but don't block execution

## Cleanup

Containers are always cleaned up, even on error:

1. Stop container if still running (5-second timeout)
2. Remove container forcefully
3. Clear credentials from memory

Cleanup failures are logged but don't throw errors to ensure execution continues.

## Requirements Mapping

- **3.1**: Create fresh Docker container for each test
- **3.2**: Container includes required HTTP client tools
- **3.3**: Tests execute inside container, not on host
- **3.4**: Timeout enforcement with SIGTERM/SIGKILL
- **3.5**: Container cleanup on all exit paths
- **3.6**: Capture stdout and stderr output
- **3.7**: Retry mechanism for network errors
- **6.6**: Framework-appropriate Docker images
- **7.5**: Pass credentials as environment variables
- **7.6**: Clear credentials after execution
- **10.1**: Retry with exponential backoff
- **10.2**: Maximum 3 retry attempts
- **10.4**: Distinguish timeout from network errors
- **10.5**: Distinguish 5xx (retryable) from 4xx (non-retryable)
- **12.2**: Measure response times
- **12.3**: Validate performance thresholds
- **12.4**: Support load test scenarios
- **12.5**: Report performance metrics
