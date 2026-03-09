/**
 * Unit tests for API Testing data models
 * Feature: api-endpoint-testing-transformation
 */

import { describe, it, expect } from 'vitest';
import {
  HttpMethod,
  AuthType,
  TestFramework,
  Environment,
  TestStatus,
  ScmProvider,
  type JiraTask,
  type EndpointSpec,
  type RepositoryInfo,
  type TestContext,
  type GeneratedTests,
  type TestResults,
  type ExecutionConfig,
  type CommitConfig,
} from '../../src/api-testing/models/index.js';

describe('API Testing Enums', () => {
  it('should have correct HttpMethod values', () => {
    expect(HttpMethod.GET).toBe('GET');
    expect(HttpMethod.POST).toBe('POST');
    expect(HttpMethod.PUT).toBe('PUT');
    expect(HttpMethod.PATCH).toBe('PATCH');
    expect(HttpMethod.DELETE).toBe('DELETE');
    expect(HttpMethod.HEAD).toBe('HEAD');
    expect(HttpMethod.OPTIONS).toBe('OPTIONS');
  });

  it('should have correct AuthType values', () => {
    expect(AuthType.BEARER).toBe('bearer');
    expect(AuthType.BASIC).toBe('basic');
    expect(AuthType.API_KEY).toBe('api_key');
    expect(AuthType.OAUTH).toBe('oauth');
    expect(AuthType.NONE).toBe('none');
  });

  it('should have correct TestFramework values', () => {
    expect(TestFramework.PYTEST_REQUESTS).toBe('pytest+requests');
    expect(TestFramework.PYTEST_HTTPX).toBe('pytest+httpx');
    expect(TestFramework.JEST_SUPERTEST).toBe('jest+supertest');
    expect(TestFramework.POSTMAN_NEWMAN).toBe('postman+newman');
  });

  it('should have correct Environment values', () => {
    expect(Environment.LOCAL).toBe('local');
    expect(Environment.DEV).toBe('dev');
    expect(Environment.STAGING).toBe('staging');
    expect(Environment.PRODUCTION).toBe('production');
  });

  it('should have correct TestStatus values', () => {
    expect(TestStatus.PASSED).toBe('passed');
    expect(TestStatus.FAILED).toBe('failed');
    expect(TestStatus.SKIPPED).toBe('skipped');
    expect(TestStatus.ERROR).toBe('error');
  });

  it('should have correct ScmProvider values', () => {
    expect(ScmProvider.GITHUB).toBe('github');
    expect(ScmProvider.GITLAB).toBe('gitlab');
    expect(ScmProvider.BITBUCKET).toBe('bitbucket');
  });
});

describe('API Testing Data Models', () => {
  it('should create a valid JiraTask object', () => {
    const task: JiraTask = {
      key: 'PROJ-123',
      summary: 'Test API endpoint',
      description: 'Test the /api/users endpoint',
      assignee: 'ai-bot',
      status: 'In Progress',
      projectKey: 'PROJ',
      customFields: { repositoryUrl: 'https://github.com/org/repo' },
      labels: ['api-test'],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(task.key).toBe('PROJ-123');
    expect(task.projectKey).toBe('PROJ');
    expect(task.labels).toContain('api-test');
  });

  it('should create a valid EndpointSpec object', () => {
    const endpoint: EndpointSpec = {
      url: 'https://api.example.com/users',
      method: HttpMethod.GET,
      headers: { 'Content-Type': 'application/json' },
      expectedStatus: 200,
      authType: AuthType.BEARER,
      testScenarios: ['success', 'unauthorized'],
    };

    expect(endpoint.url).toBe('https://api.example.com/users');
    expect(endpoint.method).toBe(HttpMethod.GET);
    expect(endpoint.expectedStatus).toBe(200);
    expect(endpoint.testScenarios).toHaveLength(2);
  });

  it('should create a valid RepositoryInfo object', () => {
    const repo: RepositoryInfo = {
      url: 'https://github.com/org/repo',
      provider: ScmProvider.GITHUB,
      branch: 'main',
      authToken: 'token123',
      cloneDepth: 1,
    };

    expect(repo.provider).toBe(ScmProvider.GITHUB);
    expect(repo.branch).toBe('main');
    expect(repo.cloneDepth).toBe(1);
  });

  it('should create a valid TestContext object', () => {
    const context: TestContext = {
      apiSpecifications: [
        { path: 'openapi.yaml', content: 'spec content', size: 1024 },
      ],
      existingTests: [],
      documentation: [
        { path: 'README.md', content: 'docs', size: 512 },
      ],
      configurationFiles: [],
      detectedFramework: TestFramework.PYTEST_REQUESTS,
      repositoryInfo: {
        url: 'https://github.com/org/repo',
        provider: ScmProvider.GITHUB,
        branch: 'main',
        authToken: 'token',
        cloneDepth: 1,
      },
    };

    expect(context.apiSpecifications).toHaveLength(1);
    expect(context.detectedFramework).toBe(TestFramework.PYTEST_REQUESTS);
  });

  it('should create a valid GeneratedTests object', () => {
    const tests: GeneratedTests = {
      testFiles: [
        {
          path: 'tests/api/test_users.py',
          content: 'test content',
          testCount: 5,
          coveredEndpoints: ['/api/users'],
        },
      ],
      framework: TestFramework.PYTEST_REQUESTS,
      requiredEnvVars: ['API_TOKEN', 'API_BASE_URL'],
      setupCommands: ['pip install -r requirements.txt'],
      runCommand: 'pytest tests/api/ -v',
      warnings: [],
    };

    expect(tests.testFiles).toHaveLength(1);
    expect(tests.framework).toBe(TestFramework.PYTEST_REQUESTS);
    expect(tests.requiredEnvVars).toContain('API_TOKEN');
  });

  it('should create a valid TestResults object', () => {
    const results: TestResults = {
      totalTests: 10,
      passedTests: 8,
      failedTests: 2,
      skippedTests: 0,
      durationSeconds: 45.5,
      testCases: [
        {
          name: 'test_get_users',
          endpoint: '/api/users',
          status: TestStatus.PASSED,
          durationMs: 120,
        },
      ],
      timestamp: new Date(),
    };

    expect(results.totalTests).toBe(10);
    expect(results.passedTests).toBe(8);
    expect(results.testCases).toHaveLength(1);
  });

  it('should create a valid ExecutionConfig object', () => {
    const config: ExecutionConfig = {
      environment: Environment.STAGING,
      timeoutSeconds: 300,
      retryCount: 3,
      retryBackoffSeconds: [1, 2, 4],
      allowDestructiveOps: false,
      credentials: { API_TOKEN: 'token123' },
    };

    expect(config.environment).toBe(Environment.STAGING);
    expect(config.timeoutSeconds).toBe(300);
    expect(config.retryBackoffSeconds).toEqual([1, 2, 4]);
  });

  it('should create a valid CommitConfig object', () => {
    const config: CommitConfig = {
      commitTestScripts: true,
      commitTestResults: false,
      createPullRequest: false,
      branchPrefix: 'api-test',
    };

    expect(config.commitTestScripts).toBe(true);
    expect(config.commitTestResults).toBe(false);
    expect(config.branchPrefix).toBe('api-test');
  });
});
