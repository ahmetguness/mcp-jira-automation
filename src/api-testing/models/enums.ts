/**
 * Enums for API Endpoint Testing Transformation
 * Feature: api-endpoint-testing-transformation
 */

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
}

export enum AuthType {
  BEARER = 'bearer',
  BASIC = 'basic',
  API_KEY = 'api_key',
  OAUTH = 'oauth',
  NONE = 'none',
}

export enum TestFramework {
  PYTEST_REQUESTS = 'pytest+requests',
  PYTEST_HTTPX = 'pytest+httpx',
  JEST_SUPERTEST = 'jest+supertest',
  POSTMAN_NEWMAN = 'postman+newman',
}

export enum Environment {
  LOCAL = 'local',
  DEV = 'dev',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

export enum TestStatus {
  PASSED = 'passed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  ERROR = 'error',
}

export enum ScmProvider {
  GITHUB = 'github',
  GITLAB = 'gitlab',
  BITBUCKET = 'bitbucket',
}
