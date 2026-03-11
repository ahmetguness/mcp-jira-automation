/**
 * Unit tests for ApiTestOrchestrator
 * Feature: api-endpoint-testing-transformation
 * Requirements: All requirements (integration)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiTestOrchestrator, PipelineStage } from '../../src/api-testing/orchestrator/ApiTestOrchestrator.js';
import type { JiraTask } from '../../src/api-testing/models/types.js';

describe('ApiTestOrchestrator', () => {
  let orchestrator: ApiTestOrchestrator;

  beforeEach(() => {
    // Mock global.fetch to prevent real HTTP requests and Chinese error messages
    global.fetch = vi.fn((url: string | URL | Request) => {
      const urlString = typeof url === 'string' 
        ? url 
        : url instanceof Request 
          ? url.url 
          : url.toString();
      
      // Mock Jira API comment posting
      if (urlString.includes('/rest/api/3/issue/') && urlString.includes('/comment')) {
        // Return 404 with English error message for non-existent issues
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(JSON.stringify({
            errorMessages: ["Issue does not exist or you do not have permission to view it."],
            errors: {}
          })),
        } as Response);
      }
      
      // Default successful response for other Jira API calls
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });

    orchestrator = new ApiTestOrchestrator({
      jira: {
        jiraBaseUrl: 'https://test.atlassian.net',
        jiraEmail: 'test@example.com',
        jiraApiToken: 'test-token',
        botUserIdentifier: 'Test Bot',
      },
      repository: {
        defaultRepositoryUrl: 'https://github.com/test/repo',
        defaultBranch: 'main',
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should create orchestrator with valid configuration', () => {
      expect(orchestrator).toBeDefined();
    });

    it('should initialize with default values', () => {
      const config = {
        jira: {
          jiraBaseUrl: 'https://test.atlassian.net',
          jiraEmail: 'test@example.com',
          jiraApiToken: 'test-token',
          botUserIdentifier: 'Test Bot',
        },
      };
      
      const orch = new ApiTestOrchestrator(config);
      expect(orch).toBeDefined();
    });
  });

  describe('start and stop', () => {
    it('should start orchestrator in manual mode', () => {
      expect(() => orchestrator.start()).not.toThrow();
    });

    it('should stop orchestrator', () => {
      orchestrator.start();
      expect(() => orchestrator.stop()).not.toThrow();
    });

    it('should not start if already running', () => {
      orchestrator.start();
      orchestrator.start(); // Should log warning but not throw
      orchestrator.stop();
    });

    it('should not stop if not running', () => {
      expect(() => orchestrator.stop()).not.toThrow();
    });
  });

  describe('processTask', () => {
    it('should handle task with no endpoints', async () => {
      const task: JiraTask = {
        key: 'TEST-1',
        summary: 'Test task',
        description: 'No endpoints here',
        assignee: 'Test Bot',
        status: 'In Progress',
        projectKey: 'TEST',
        customFields: {},
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await orchestrator.processTask(task);
      
      expect(result.success).toBe(false);
      expect(result.stage).toBe(PipelineStage.PARSING);
      expect(result.error).toContain('No valid endpoints');
    });

    it('should handle task with invalid endpoint specification', async () => {
      const task: JiraTask = {
        key: 'TEST-2',
        summary: 'Test task',
        description: `
\`\`\`json
{
  "url": "not-a-valid-url",
  "method": "INVALID_METHOD"
}
\`\`\`
        `,
        assignee: 'Test Bot',
        status: 'In Progress',
        projectKey: 'TEST',
        customFields: {},
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await orchestrator.processTask(task);
      
      expect(result.success).toBe(false);
      expect(result.stage).toBe(PipelineStage.VALIDATION);
    });

    it('should process task with valid endpoint specification', async () => {
      const task: JiraTask = {
        key: 'TEST-3',
        summary: 'Test task',
        description: `
\`\`\`json
{
  "url": "https://api.example.com/users",
  "method": "GET",
  "expectedStatus": 200
}
\`\`\`
        `,
        assignee: 'Test Bot',
        status: 'In Progress',
        projectKey: 'TEST',
        customFields: {},
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await orchestrator.processTask(task);
      
      // Should complete all stages (even with placeholder implementations)
      expect(result.taskKey).toBe('TEST-3');
      expect(result.endpoints).toBeDefined();
      expect(result.endpoints?.length).toBeGreaterThan(0);
    });
  });

  describe('pipeline stages', () => {
    it('should have all pipeline stages defined', () => {
      expect(PipelineStage.TASK_RECEIVED).toBe('task_received');
      expect(PipelineStage.PARSING).toBe('parsing');
      expect(PipelineStage.VALIDATION).toBe('validation');
      expect(PipelineStage.REPOSITORY_RESOLUTION).toBe('repository_resolution');
      expect(PipelineStage.CONTEXT_RETRIEVAL).toBe('context_retrieval');
      expect(PipelineStage.TEST_GENERATION).toBe('test_generation');
      expect(PipelineStage.TEST_EXECUTION).toBe('test_execution');
      expect(PipelineStage.REPORTING).toBe('reporting');
      expect(PipelineStage.COMPLETED).toBe('completed');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      const task: JiraTask = {
        key: 'TEST-4',
        summary: 'Test task',
        description: 'Test',
        assignee: 'Test Bot',
        status: 'In Progress',
        projectKey: 'TEST',
        customFields: {},
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await orchestrator.processTask(task);
      
      // Should not throw, should return error result
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
