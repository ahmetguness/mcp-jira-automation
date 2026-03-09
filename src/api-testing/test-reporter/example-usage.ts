/**
 * Example usage of TestReporter
 * Feature: api-endpoint-testing-transformation
 */

import { TestReporter } from './TestReporter.js';
import type { TestResults, RepositoryInfo, TestFile, CommitConfig } from '../models/types.js';
import { TestStatus, ScmProvider } from '../models/enums.js';
import { createScmProvider } from '../../scm/index.js';
import type { Config } from '../../config.js';
import type { McpManager } from '../../mcp/manager.js';

/**
 * Example: Report test results to Jira
 */
async function exampleReportToJira() {
  // Initialize reporter
  const reporter = new TestReporter({
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://company.atlassian.net',
    jiraEmail: process.env.JIRA_EMAIL || 'bot@company.com',
    jiraApiToken: process.env.JIRA_API_TOKEN || 'your-api-token',
    maxRetryAttempts: 3,
  });

  // Example test results
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
      {
        name: 'POST /api/users creates user',
        endpoint: 'POST /api/users',
        status: TestStatus.PASSED,
        durationMs: 250,
        requestDetails: {
          body: { name: 'John Doe', email: 'john@example.com' },
        },
        responseDetails: {
          id: 123,
          name: 'John Doe',
          email: 'john@example.com',
        },
      },
      {
        name: 'GET /api/users/:id returns user',
        endpoint: 'GET /api/users/123',
        status: TestStatus.PASSED,
        durationMs: 95,
      },
      {
        name: 'DELETE /api/users/:id removes user',
        endpoint: 'DELETE /api/users/123',
        status: TestStatus.PASSED,
        durationMs: 180,
      },
      {
        name: 'GET /api/users/:id handles not found',
        endpoint: 'GET /api/users/999',
        status: TestStatus.FAILED,
        durationMs: 85,
        errorMessage: 'Expected status 404, got 500',
        responseDetails: {
          error: 'Internal Server Error',
        },
      },
    ],
    performanceMetrics: {
      minResponseTimeMs: 85,
      maxResponseTimeMs: 250,
      avgResponseTimeMs: 146,
      successRate: 0.8,
    },
  };

  try {
    // Report results to Jira
    await reporter.reportToJira('PROJ-123', results);
    console.log('✅ Results reported to Jira');

    // Update task status
    await reporter.updateTaskStatus('PROJ-123', results, 0);
    console.log('✅ Task status updated');
  } catch (error) {
    console.error('❌ Error reporting results:', error);
  }
}

/**
 * Example: Generate and save Markdown report
 */
async function exampleGenerateMarkdownReport() {
  const reporter = new TestReporter({
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://company.atlassian.net',
    jiraEmail: process.env.JIRA_EMAIL || 'bot@company.com',
    jiraApiToken: process.env.JIRA_API_TOKEN || 'your-api-token',
  });

  const results: TestResults = {
    totalTests: 3,
    passedTests: 2,
    failedTests: 1,
    skippedTests: 0,
    durationSeconds: 8.2,
    timestamp: new Date(),
    testCases: [
      {
        name: 'GET /api/health returns 200',
        endpoint: 'GET /api/health',
        status: TestStatus.PASSED,
        durationMs: 45,
        responseDetails: { status: 'healthy' },
      },
      {
        name: 'POST /api/login authenticates user',
        endpoint: 'POST /api/login',
        status: TestStatus.PASSED,
        durationMs: 320,
        requestDetails: {
          username: 'testuser',
          password: '[REDACTED]',
        },
        responseDetails: {
          token: '[REDACTED]',
          expiresIn: 3600,
        },
      },
      {
        name: 'GET /api/protected requires auth',
        endpoint: 'GET /api/protected',
        status: TestStatus.FAILED,
        durationMs: 65,
        errorMessage: 'Expected status 401, got 500',
        responseDetails: {
          error: 'Internal Server Error',
        },
      },
    ],
    performanceMetrics: {
      minResponseTimeMs: 45,
      maxResponseTimeMs: 320,
      avgResponseTimeMs: 143,
      successRate: 0.67,
    },
  };

  try {
    // Generate Markdown report
    const markdown = reporter.generateMarkdownReport(results, 'PROJ-456');
    console.log('Generated Markdown report:');
    console.log(markdown);

    // Save to file
    await reporter.saveMarkdownReport(markdown, 'PROJ-456', 'docs/api-tests');
    console.log('✅ Markdown report saved to docs/api-tests/');
  } catch (error) {
    console.error('❌ Error generating report:', error);
  }
}

/**
 * Example: Handle permanently failed tests
 */
async function examplePermanentFailure() {
  const reporter = new TestReporter({
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://company.atlassian.net',
    jiraEmail: process.env.JIRA_EMAIL || 'bot@company.com',
    jiraApiToken: process.env.JIRA_API_TOKEN || 'your-api-token',
    maxRetryAttempts: 3,
  });

  const results: TestResults = {
    totalTests: 1,
    passedTests: 0,
    failedTests: 1,
    skippedTests: 0,
    durationSeconds: 2.5,
    timestamp: new Date(),
    testCases: [
      {
        name: 'GET /api/broken endpoint',
        endpoint: 'GET /api/broken',
        status: TestStatus.FAILED,
        durationMs: 2500,
        errorMessage: 'Connection timeout after 2500ms',
      },
    ],
  };

  try {
    // Report results
    await reporter.reportToJira('PROJ-789', results);
    
    // Update status with retry count = 3 (max retries reached)
    // This will add the "permanently-failed" label
    await reporter.updateTaskStatus('PROJ-789', results, 3);
    console.log('✅ Task marked as permanently failed after 3 retries');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Example: Commit test artifacts to SCM
 */
async function exampleCommitToScm(config: Config, mcp: McpManager) {
  // Create SCM provider
  const scmProvider = createScmProvider(config, mcp);
  
  // Initialize reporter with SCM provider
  const reporter = new TestReporter({
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://company.atlassian.net',
    jiraEmail: process.env.JIRA_EMAIL || 'bot@company.com',
    jiraApiToken: process.env.JIRA_API_TOKEN || 'your-api-token',
    scmProvider,
  });

  // Repository information
  const repo: RepositoryInfo = {
    url: 'owner/repo', // Format depends on SCM provider
    provider: ScmProvider.GITHUB,
    branch: 'main',
    authToken: process.env.GITHUB_TOKEN || '',
    cloneDepth: 1,
  };

  // Generated test files
  const testFiles: TestFile[] = [
    {
      path: 'tests/api/test_users.py',
      content: `
import pytest
import requests

def test_get_users():
    response = requests.get('https://api.example.com/users')
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_create_user():
    response = requests.post('https://api.example.com/users', json={
        'name': 'John Doe',
        'email': 'john@example.com'
    })
    assert response.status_code == 201
    assert response.json()['name'] == 'John Doe'
      `.trim(),
      testCount: 2,
      coveredEndpoints: ['GET /api/users', 'POST /api/users'],
    },
    {
      path: 'tests/api/test_auth.py',
      content: `
import pytest
import requests

def test_login():
    response = requests.post('https://api.example.com/login', json={
        'username': 'testuser',
        'password': 'testpass'
    })
    assert response.status_code == 200
    assert 'token' in response.json()
      `.trim(),
      testCount: 1,
      coveredEndpoints: ['POST /api/login'],
    },
  ];

  // Test results
  const results: TestResults = {
    totalTests: 3,
    passedTests: 3,
    failedTests: 0,
    skippedTests: 0,
    durationSeconds: 5.2,
    timestamp: new Date(),
    testCases: [
      {
        name: 'test_get_users',
        endpoint: 'GET /api/users',
        status: TestStatus.PASSED,
        durationMs: 120,
      },
      {
        name: 'test_create_user',
        endpoint: 'POST /api/users',
        status: TestStatus.PASSED,
        durationMs: 250,
      },
      {
        name: 'test_login',
        endpoint: 'POST /api/login',
        status: TestStatus.PASSED,
        durationMs: 180,
      },
    ],
    performanceMetrics: {
      minResponseTimeMs: 120,
      maxResponseTimeMs: 250,
      avgResponseTimeMs: 183,
      successRate: 1.0,
    },
  };

  // Commit configuration
  const commitConfig: CommitConfig = {
    commitTestScripts: true,
    commitTestResults: true,
    createPullRequest: true,
    branchPrefix: 'api-test',
  };

  try {
    // Commit test artifacts to SCM
    const result = await reporter.commitToScm(
      repo,
      testFiles,
      results,
      commitConfig,
      'PROJ-123'
    );

    if (result.success) {
      console.log('✅ Test artifacts committed successfully');
      console.log(`   Branch: ${result.branchName}`);
      if (result.pullRequestUrl) {
        console.log(`   Pull Request: ${result.pullRequestUrl}`);
      }
    } else {
      console.error('❌ Failed to commit test artifacts:', result.error);
    }
  } catch (error) {
    console.error('❌ Error committing to SCM:', error);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Example 1: Report to Jira ===\n');
  await exampleReportToJira();
  
  console.log('\n=== Example 2: Generate Markdown Report ===\n');
  await exampleGenerateMarkdownReport();
  
  console.log('\n=== Example 3: Handle Permanent Failure ===\n');
  await examplePermanentFailure();
}

export {
  exampleReportToJira,
  exampleGenerateMarkdownReport,
  examplePermanentFailure,
  exampleCommitToScm,
};
