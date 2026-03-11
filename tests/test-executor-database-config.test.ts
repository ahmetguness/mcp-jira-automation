/**
 * Unit tests for TestExecutor database configuration
 * Tests Task 3.3: Implement database configuration in TestExecutor
 */

import { describe, it, expect } from 'vitest';
import { TestExecutor } from '../src/api-testing/test-executor/TestExecutor.js';
import { DatabaseType } from '../src/api-testing/models/enums.js';
import type { ExecutionConfig, TestContext } from '../src/api-testing/models/types.js';
import { Environment } from '../src/api-testing/models/enums.js';

describe('TestExecutor - Database Configuration (Task 3.3)', () => {
  describe('buildEnvironmentVariables with database configuration', () => {
    it('should add MONGODB_URL when MongoDB is detected and not provided by user', () => {
      const executor = new TestExecutor();
      const config: ExecutionConfig = {
        environment: Environment.LOCAL,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };
      const context: TestContext = {
        apiSpecifications: [],
        existingTests: [],
        documentation: [],
        configurationFiles: [],
        detectedDatabases: [DatabaseType.MONGODB],
        repositoryInfo: {
          url: 'https://github.com/test/repo',
          provider: 'github' as any,
          branch: 'main',
          authToken: 'token',
          cloneDepth: 1,
        },
      };

      // Access private method via type assertion
      const envVars = (executor as any).buildEnvironmentVariables(config, context);

      expect(envVars).toContain('MONGODB_URL=mongodb://localhost:27017/test');
    });

    it('should add DATABASE_URL when PostgreSQL is detected', () => {
      const executor = new TestExecutor();
      const config: ExecutionConfig = {
        environment: Environment.LOCAL,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };
      const context: TestContext = {
        apiSpecifications: [],
        existingTests: [],
        documentation: [],
        configurationFiles: [],
        detectedDatabases: [DatabaseType.POSTGRESQL],
        repositoryInfo: {
          url: 'https://github.com/test/repo',
          provider: 'github' as any,
          branch: 'main',
          authToken: 'token',
          cloneDepth: 1,
        },
      };

      const envVars = (executor as any).buildEnvironmentVariables(config, context);

      expect(envVars).toContain('DATABASE_URL=postgresql://localhost:5432/test');
    });

    it('should add REDIS_URL when Redis is detected', () => {
      const executor = new TestExecutor();
      const config: ExecutionConfig = {
        environment: Environment.LOCAL,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };
      const context: TestContext = {
        apiSpecifications: [],
        existingTests: [],
        documentation: [],
        configurationFiles: [],
        detectedDatabases: [DatabaseType.REDIS],
        repositoryInfo: {
          url: 'https://github.com/test/repo',
          provider: 'github' as any,
          branch: 'main',
          authToken: 'token',
          cloneDepth: 1,
        },
      };

      const envVars = (executor as any).buildEnvironmentVariables(config, context);

      expect(envVars).toContain('REDIS_URL=redis://localhost:6379');
    });

    it('should add multiple database URLs when multiple databases are detected', () => {
      const executor = new TestExecutor();
      const config: ExecutionConfig = {
        environment: Environment.LOCAL,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };
      const context: TestContext = {
        apiSpecifications: [],
        existingTests: [],
        documentation: [],
        configurationFiles: [],
        detectedDatabases: [DatabaseType.MONGODB, DatabaseType.REDIS],
        repositoryInfo: {
          url: 'https://github.com/test/repo',
          provider: 'github' as any,
          branch: 'main',
          authToken: 'token',
          cloneDepth: 1,
        },
      };

      const envVars = (executor as any).buildEnvironmentVariables(config, context);

      expect(envVars).toContain('MONGODB_URL=mongodb://localhost:27017/test');
      expect(envVars).toContain('REDIS_URL=redis://localhost:6379');
    });

    it('should NOT add database URL if user already provided it (user config takes precedence)', () => {
      const executor = new TestExecutor();
      const config: ExecutionConfig = {
        environment: Environment.LOCAL,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          MONGODB_URL: 'mongodb://custom-host:27017/custom-db',
        },
      };
      const context: TestContext = {
        apiSpecifications: [],
        existingTests: [],
        documentation: [],
        configurationFiles: [],
        detectedDatabases: [DatabaseType.MONGODB],
        repositoryInfo: {
          url: 'https://github.com/test/repo',
          provider: 'github' as any,
          branch: 'main',
          authToken: 'token',
          cloneDepth: 1,
        },
      };

      const envVars = (executor as any).buildEnvironmentVariables(config, context);

      // Should contain user-provided URL
      expect(envVars).toContain('MONGODB_URL=mongodb://custom-host:27017/custom-db');
      // Should NOT contain auto-generated URL
      expect(envVars.filter((v: string) => v.startsWith('MONGODB_URL=')).length).toBe(1);
    });

    it('should not add database URLs when no databases are detected', () => {
      const executor = new TestExecutor();
      const config: ExecutionConfig = {
        environment: Environment.LOCAL,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {},
      };
      const context: TestContext = {
        apiSpecifications: [],
        existingTests: [],
        documentation: [],
        configurationFiles: [],
        detectedDatabases: [],
        repositoryInfo: {
          url: 'https://github.com/test/repo',
          provider: 'github' as any,
          branch: 'main',
          authToken: 'token',
          cloneDepth: 1,
        },
      };

      const envVars = (executor as any).buildEnvironmentVariables(config, context);

      // Should only contain base environment variables
      expect(envVars).toContain('NODE_ENV=test');
      expect(envVars.some((v: string) => v.includes('MONGODB_URL'))).toBe(false);
      expect(envVars.some((v: string) => v.includes('DATABASE_URL'))).toBe(false);
      expect(envVars.some((v: string) => v.includes('REDIS_URL'))).toBe(false);
    });

    it('should work without TestContext (backward compatibility)', () => {
      const executor = new TestExecutor();
      const config: ExecutionConfig = {
        environment: Environment.LOCAL,
        timeoutSeconds: 300,
        retryCount: 3,
        retryBackoffSeconds: [1, 2, 4],
        allowDestructiveOps: false,
        credentials: {
          API_KEY: 'test-key',
        },
      };

      const envVars = (executor as any).buildEnvironmentVariables(config);

      // Should contain base environment variables
      expect(envVars).toContain('NODE_ENV=test');
      expect(envVars).toContain('API_KEY=test-key');
      // Should not crash or add database URLs
      expect(envVars.some((v: string) => v.includes('MONGODB_URL'))).toBe(false);
    });
  });

  describe('getDatabaseConfig', () => {
    it('should return correct config for MongoDB', () => {
      const executor = new TestExecutor();
      const config = (executor as any).getDatabaseConfig(DatabaseType.MONGODB);

      expect(config.envVarName).toBe('MONGODB_URL');
      expect(config.testUrl).toBe('mongodb://localhost:27017/test');
    });

    it('should return correct config for PostgreSQL', () => {
      const executor = new TestExecutor();
      const config = (executor as any).getDatabaseConfig(DatabaseType.POSTGRESQL);

      expect(config.envVarName).toBe('DATABASE_URL');
      expect(config.testUrl).toBe('postgresql://localhost:5432/test');
    });

    it('should return correct config for MySQL', () => {
      const executor = new TestExecutor();
      const config = (executor as any).getDatabaseConfig(DatabaseType.MYSQL);

      expect(config.envVarName).toBe('MYSQL_URL');
      expect(config.testUrl).toBe('mysql://localhost:3306/test');
    });

    it('should return correct config for Redis', () => {
      const executor = new TestExecutor();
      const config = (executor as any).getDatabaseConfig(DatabaseType.REDIS);

      expect(config.envVarName).toBe('REDIS_URL');
      expect(config.testUrl).toBe('redis://localhost:6379');
    });

    it('should return correct config for SQLite', () => {
      const executor = new TestExecutor();
      const config = (executor as any).getDatabaseConfig(DatabaseType.SQLITE);

      expect(config.envVarName).toBe('SQLITE_DATABASE');
      expect(config.testUrl).toBe(':memory:');
    });
  });
});
