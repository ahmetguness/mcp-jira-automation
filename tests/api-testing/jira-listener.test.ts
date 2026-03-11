/**
 * Unit tests for JiraListener
 * Feature: api-endpoint-testing-transformation
 * Requirements: 1.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JiraListener, type JiraListenerConfig } from '../../src/api-testing/jira-listener/index.js';
import { createHmac } from 'crypto';

describe('JiraListener', () => {
  let config: JiraListenerConfig;
  let listener: JiraListener;

  beforeEach(() => {
    config = {
      jiraBaseUrl: 'https://test.atlassian.net',
      jiraEmail: 'test@example.com',
      jiraApiToken: 'test-token',
      botUserIdentifier: 'AI Cyber Bot',
      pollingIntervalSeconds: 1, // Short interval for testing
    };
    listener = new JiraListener(config);
  });

  afterEach(() => {
    listener.stopPolling();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(listener).toBeDefined();
    });

    it('should use default polling interval if not provided', () => {
      const configWithoutInterval = {
        jiraBaseUrl: 'https://test.atlassian.net',
        jiraEmail: 'test@example.com',
        jiraApiToken: 'test-token',
        botUserIdentifier: 'AI Cyber Bot',
      };
      const listenerWithDefaults = new JiraListener(configWithoutInterval);
      expect(listenerWithDefaults).toBeDefined();
    });
  });

  describe('pollTasks', () => {
    it('should fetch tasks assigned to bot user', async () => {
      const mockResponse = {
        issues: [
          {
            key: 'TEST-123',
            fields: {
              summary: 'Test API endpoint',
              description: 'Test description',
              status: { name: 'To Do' },
              assignee: { displayName: 'AI Cyber Bot' },
              project: { key: 'TEST' },
              labels: ['api-test'],
              created: '2024-01-01T00:00:00.000Z',
              updated: '2024-01-01T00:00:00.000Z',
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const tasks = await listener.pollTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBeDefined();
      expect(tasks[0]?.key).toBe('TEST-123');
      expect(tasks[0]?.summary).toBe('Test API endpoint');
      expect(tasks[0]?.description).toBe('Test description');
      expect(tasks[0]?.status).toBe('To Do');
      expect(tasks[0]?.assignee).toBe('AI Cyber Bot');
      expect(tasks[0]?.projectKey).toBe('TEST');
      expect(tasks[0]?.labels).toEqual(['api-test']);
    });

    it('should return empty array when no tasks found', async () => {
      const mockResponse = {
        issues: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const tasks = await listener.pollTasks();

      expect(tasks).toHaveLength(0);
    });

    it('should handle missing optional fields', async () => {
      const mockResponse = {
        issues: [
          {
            key: 'TEST-456',
            fields: {
              summary: 'Minimal task',
              status: { name: 'In Progress' },
              project: { key: 'TEST' },
              created: '2024-01-01T00:00:00.000Z',
              updated: '2024-01-01T00:00:00.000Z',
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const tasks = await listener.pollTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBeDefined();
      expect(tasks[0]?.description).toBe('');
      expect(tasks[0]?.assignee).toBe('Unassigned');
      expect(tasks[0]?.labels).toEqual([]);
    });

    it('should throw error on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid credentials'),
      } as Response);

      await expect(listener.pollTasks()).rejects.toThrow('Jira API error: 401 Unauthorized');
    });

    it('should extract custom fields', async () => {
      const mockResponse = {
        issues: [
          {
            key: 'TEST-789',
            fields: {
              summary: 'Task with custom fields',
              status: { name: 'To Do' },
              project: { key: 'TEST' },
              created: '2024-01-01T00:00:00.000Z',
              updated: '2024-01-01T00:00:00.000Z',
              customfield_10001: 'https://github.com/org/repo',
              customfield_10002: 'staging',
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const tasks = await listener.pollTasks();

      expect(tasks[0]).toBeDefined();
      expect(tasks[0]?.customFields).toEqual({
        customfield_10001: 'https://github.com/org/repo',
        customfield_10002: 'staging',
      });
    });
  });

  describe('getTaskDetails', () => {
    it('should fetch full task details by key', async () => {
      const mockIssue = {
        key: 'TEST-123',
        fields: {
          summary: 'Test API endpoint',
          description: 'Detailed description',
          status: { name: 'To Do' },
          assignee: { displayName: 'AI Cyber Bot' },
          project: { key: 'TEST' },
          labels: ['api-test', 'urgent'],
          created: '2024-01-01T00:00:00.000Z',
          updated: '2024-01-02T00:00:00.000Z',
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockIssue),
      } as Response);

      const task = await listener.getTaskDetails('TEST-123');

      expect(task).toBeDefined();
      expect(task.key).toBe('TEST-123');
      expect(task.summary).toBe('Test API endpoint');
      expect(task.description).toBe('Detailed description');
      expect(task.labels).toEqual(['api-test', 'urgent']);
    });

    it('should throw error when task not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Issue does not exist'),
      } as Response);

      await expect(listener.getTaskDetails('INVALID-999')).rejects.toThrow('Jira API error: 404 Not Found');
    });
  });

  describe('startPolling and stopPolling', () => {
    it('should start and stop polling', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const mockResponse = {
        issues: [
          {
            key: 'TEST-123',
            fields: {
              summary: 'Test task',
              status: { name: 'To Do' },
              project: { key: 'TEST' },
              created: '2024-01-01T00:00:00.000Z',
              updated: '2024-01-01T00:00:00.000Z',
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      listener.startPolling(handler);

      // Wait for first poll cycle
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();

      listener.stopPolling();
    });

    it('should handle errors in handler without stopping polling', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler error'));
      const mockResponse = {
        issues: [
          {
            key: 'TEST-123',
            fields: {
              summary: 'Test task',
              status: { name: 'To Do' },
              project: { key: 'TEST' },
              created: '2024-01-01T00:00:00.000Z',
              updated: '2024-01-01T00:00:00.000Z',
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      listener.startPolling(handler);

      // Wait for first poll cycle
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();

      listener.stopPolling();
    });

    it('should not start polling if already polling', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      listener.startPolling(handler);
      listener.startPolling(handler); // Second call should be ignored

      listener.stopPolling();
    });

    it('should handle stop polling when not started', () => {
      expect(() => listener.stopPolling()).not.toThrow();
    });
  });

  describe('JQL query building', () => {
    it('should use custom JQL when provided', async () => {
      const customConfig = {
        ...config,
        jqlOverride: 'project = TEST AND status = "To Do"',
      };
      const customListener = new JiraListener(customConfig);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ issues: [] }),
      } as Response);
      global.fetch = mockFetch;

      await customListener.pollTasks();

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs).toBeDefined();
      const requestBody = JSON.parse(callArgs?.[1].body as string);
      expect(requestBody.jql).toBe('project = TEST AND status = "To Do"');
    });

    it('should use default JQL when no override provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ issues: [] }),
      } as Response);
      global.fetch = mockFetch;

      await listener.pollTasks();

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs).toBeDefined();
      const requestBody = JSON.parse(callArgs?.[1].body as string);
      expect(requestBody.jql).toContain('assignee = "AI Cyber Bot"');
      expect(requestBody.jql).toContain('statusCategory != Done');
    });
  });

  describe('setupWebhook', () => {
    it('should set up webhook with provided callback URL', async () => {
      const mockWebhookResponse = {
        self: 'https://test.atlassian.net/rest/webhooks/1.0/webhook/12345',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWebhookResponse),
      } as Response);

      const callbackUrl = 'https://example.com/webhook';
      const webhookConfig = await listener.setupWebhook(callbackUrl);

      expect(webhookConfig.url).toBe(callbackUrl);
      expect(webhookConfig.secret).toBeDefined();
      expect(webhookConfig.secret.length).toBeGreaterThan(0);
      expect(webhookConfig.events).toEqual(['jira:issue_updated']);
    });

    it('should set up webhook with custom events', async () => {
      const mockWebhookResponse = {
        self: 'https://test.atlassian.net/rest/webhooks/1.0/webhook/12345',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWebhookResponse),
      } as Response);

      const callbackUrl = 'https://example.com/webhook';
      const customEvents = ['jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted'];
      const webhookConfig = await listener.setupWebhook(callbackUrl, customEvents);

      expect(webhookConfig.events).toEqual(customEvents);
    });

    it('should use configured webhook secret if provided', async () => {
      const configWithSecret = {
        ...config,
        webhookSecret: 'my-secret-key',
      };
      const listenerWithSecret = new JiraListener(configWithSecret);

      const mockWebhookResponse = {
        self: 'https://test.atlassian.net/rest/webhooks/1.0/webhook/12345',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWebhookResponse),
      } as Response);

      const callbackUrl = 'https://example.com/webhook';
      const webhookConfig = await listenerWithSecret.setupWebhook(callbackUrl);

      expect(webhookConfig.secret).toBe('my-secret-key');
    });

    it('should throw error on webhook setup failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('Insufficient permissions'),
      } as Response);

      const callbackUrl = 'https://example.com/webhook';
      await expect(listener.setupWebhook(callbackUrl)).rejects.toThrow('Jira webhook setup error: 403 Forbidden');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', () => {
      const secret = 'test-secret';
      const payload = '{"webhookEvent":"jira:issue_updated"}';
      
      // Generate valid signature
      const signature = createHmac('sha256', secret).update(payload).digest('hex');

      const isValid = listener.verifyWebhookSignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });

    it('should reject invalid webhook signature', () => {
      const secret = 'test-secret';
      const payload = '{"webhookEvent":"jira:issue_updated"}';
      const invalidSignature = 'invalid-signature-12345678901234567890123456789012';

      const isValid = listener.verifyWebhookSignature(payload, invalidSignature, secret);
      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const secret = 'test-secret';
      const wrongSecret = 'wrong-secret';
      const payload = '{"webhookEvent":"jira:issue_updated"}';
      
      const signature = createHmac('sha256', wrongSecret).update(payload).digest('hex');

      const isValid = listener.verifyWebhookSignature(payload, signature, secret);
      expect(isValid).toBe(false);
    });

    it('should handle errors gracefully', () => {
      const isValid = listener.verifyWebhookSignature('payload', 'short', 'secret');
      expect(isValid).toBe(false);
    });
  });

  describe('handleWebhookCallback', () => {
    it('should process valid webhook for bot-assigned task', async () => {
      const webhookPayload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'TEST-123',
          fields: {
            summary: 'Test API endpoint',
            description: 'Test description',
            status: { name: 'To Do' },
            assignee: { displayName: 'AI Cyber Bot' },
            project: { key: 'TEST' },
            labels: ['api-test'],
            created: '2024-01-01T00:00:00.000Z',
            updated: '2024-01-01T00:00:00.000Z',
          },
        },
      };

      const task = await listener.handleWebhookCallback(JSON.stringify(webhookPayload));

      expect(task).not.toBeNull();
      expect(task?.key).toBe('TEST-123');
      expect(task?.summary).toBe('Test API endpoint');
      expect(task?.assignee).toBe('AI Cyber Bot');
    });

    it('should verify signature when secret is configured', async () => {
      const configWithSecret = {
        ...config,
        webhookSecret: 'test-secret',
      };
      const listenerWithSecret = new JiraListener(configWithSecret);

      const webhookPayload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'TEST-123',
          fields: {
            summary: 'Test task',
            status: { name: 'To Do' },
            assignee: { displayName: 'AI Cyber Bot' },
            project: { key: 'TEST' },
            created: '2024-01-01T00:00:00.000Z',
            updated: '2024-01-01T00:00:00.000Z',
          },
        },
      };

      const payload = JSON.stringify(webhookPayload);
      const signature = createHmac('sha256', 'test-secret').update(payload).digest('hex');

      const task = await listenerWithSecret.handleWebhookCallback(payload, signature);

      expect(task).not.toBeNull();
      expect(task?.key).toBe('TEST-123');
    });

    it('should reject webhook with invalid signature', async () => {
      const configWithSecret = {
        ...config,
        webhookSecret: 'test-secret',
      };
      const listenerWithSecret = new JiraListener(configWithSecret);

      const webhookPayload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'TEST-123',
          fields: {
            summary: 'Test task',
            status: { name: 'To Do' },
            assignee: { displayName: 'AI Cyber Bot' },
            project: { key: 'TEST' },
            created: '2024-01-01T00:00:00.000Z',
            updated: '2024-01-01T00:00:00.000Z',
          },
        },
      };

      const payload = JSON.stringify(webhookPayload);
      const invalidSignature = 'invalid-signature-12345678901234567890123456789012';

      await expect(listenerWithSecret.handleWebhookCallback(payload, invalidSignature))
        .rejects.toThrow('Invalid webhook signature');
    });

    it('should ignore webhook for task not assigned to bot', async () => {
      const webhookPayload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: 'TEST-456',
          fields: {
            summary: 'Task for someone else',
            status: { name: 'To Do' },
            assignee: { displayName: 'Other User' },
            project: { key: 'TEST' },
            created: '2024-01-01T00:00:00.000Z',
            updated: '2024-01-01T00:00:00.000Z',
          },
        },
      };

      const task = await listener.handleWebhookCallback(JSON.stringify(webhookPayload));

      expect(task).toBeNull();
    });

    it('should ignore webhook without issue data', async () => {
      const webhookPayload = {
        webhookEvent: 'jira:project_created',
      };

      const task = await listener.handleWebhookCallback(JSON.stringify(webhookPayload));

      expect(task).toBeNull();
    });

    it('should handle malformed webhook payload', async () => {
      const invalidPayload = 'not valid json {';

      await expect(listener.handleWebhookCallback(invalidPayload))
        .rejects.toThrow();
    });
  });
});
