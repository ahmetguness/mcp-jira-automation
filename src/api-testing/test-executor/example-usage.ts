/**
 * Example usage of TestExecutor
 * Feature: api-endpoint-testing-transformation
 */

/* eslint-disable no-console */

import { TestExecutor } from './TestExecutor.js';
import type { GeneratedTests, ExecutionConfig } from '../models/types.js';
import { TestFramework, Environment, TestStatus as TestStatusEnum } from '../models/enums.js';

/**
 * Example: Execute API tests in isolated Docker container
 */
async function executeApiTests() {
  const executor = new TestExecutor();

  // Example generated tests
  const tests: GeneratedTests = {
    testFiles: [
      {
        path: 'tests/api/test_users.py',
        content: `
import requests
import pytest

def test_get_users():
    response = requests.get('http://api.example.com/users')
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_create_user():
    response = requests.post('http://api.example.com/users', json={'name': 'Test User'})
    assert response.status_code == 201
`,
        testCount: 2,
        coveredEndpoints: ['/users'],
      },
    ],
    framework: TestFramework.PYTEST_REQUESTS,
    requiredEnvVars: ['API_BASE_URL', 'API_TOKEN'],
    setupCommands: ['pip install requests pytest'],
    runCommand: 'pytest tests/api/ -v',
    warnings: [],
  };

  // Execution configuration
  const config: ExecutionConfig = {
    environment: Environment.STAGING,
    timeoutSeconds: 300,
    retryCount: 3,
    retryBackoffSeconds: [1, 2, 4],
    allowDestructiveOps: false,
    credentials: {
      API_BASE_URL: 'http://api.example.com',
      API_TOKEN: 'test-token-123',
    },
  };

  try {
    // Execute tests
    const results = await executor.executeTests(tests, config);

    console.log('Test Results:');
    console.log(`Total: ${results.totalTests}`);
    console.log(`Passed: ${results.passedTests}`);
    console.log(`Failed: ${results.failedTests}`);
    console.log(`Duration: ${results.durationSeconds}s`);

    if (results.performanceMetrics) {
      console.log('\nPerformance Metrics:');
      console.log(`Min: ${results.performanceMetrics.minResponseTimeMs}ms`);
      console.log(`Max: ${results.performanceMetrics.maxResponseTimeMs}ms`);
      console.log(`Avg: ${results.performanceMetrics.avgResponseTimeMs}ms`);
      console.log(`Success Rate: ${(results.performanceMetrics.successRate * 100).toFixed(2)}%`);
    }

    // Print test cases
    console.log('\nTest Cases:');
    for (const testCase of results.testCases) {
      const status = testCase.status === TestStatusEnum.PASSED ? '✓' : '✗';
      console.log(`${status} ${testCase.name} - ${testCase.endpoint} (${testCase.durationMs}ms)`);
      if (testCase.errorMessage) {
        console.log(`  Error: ${testCase.errorMessage}`);
      }
    }
  } catch (error) {
    console.error('Test execution failed:', error);
  }
}

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  executeApiTests().catch(console.error);
}
