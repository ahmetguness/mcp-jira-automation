/**
 * JiraListener class - Monitors Jira for new API testing tasks
 * Feature: api-endpoint-testing-transformation
 * Requirements: 1.1
 */

import type { JiraTask, WebhookConfig } from '../models/types.js';
import { createLogger } from '../../logger.js';
import crypto from 'crypto';

const log = createLogger('api-testing:jira-listener');

/**
 * Configuration for JiraListener
 */
export interface JiraListenerConfig {
  /** Jira base URL (e.g., "https://company.atlassian.net") */
  jiraBaseUrl: string;
  /** Jira user email */
  jiraEmail: string;
  /** Jira API token */
  jiraApiToken: string;
  /** Bot user identifier (display name or account ID) */
  botUserIdentifier: string;
  /** Polling interval in seconds (default: 60) */
  pollingIntervalSeconds?: number;
  /** JQL override for custom queries */
  jqlOverride?: string;
  /** Webhook secret for signature verification (optional) */
  webhookSecret?: string;
}

/**
 * JiraListener - Monitors Jira for API testing tasks assigned to bot user
 * 
 * This class provides polling functionality to retrieve tasks assigned to the bot user
 * and retrieve full task details for processing.
 */
export class JiraListener {
  private config: JiraListenerConfig;
  private pollingInterval: number;
  private isPolling: boolean = false;
  private pollingTimer: NodeJS.Timeout | null = null;

  constructor(config: JiraListenerConfig) {
    this.config = config;
    this.pollingInterval = (config.pollingIntervalSeconds ?? 60) * 1000; // Convert to milliseconds
    
    log.info('JiraListener initialized', {
      baseUrl: config.jiraBaseUrl,
      botUser: config.botUserIdentifier,
      pollingIntervalSeconds: config.pollingIntervalSeconds ?? 60,
    });
  }

  /**
   * Poll Jira for tasks assigned to bot user
   * Requirements: 1.1 - Retrieve tasks assigned to "AI Cyber Bot" user
   * 
   * @returns Array of JiraTask objects assigned to the bot user
   */
  async pollTasks(): Promise<JiraTask[]> {
    log.debug('Polling for tasks assigned to bot user');

    try {
      const jql = this.buildJql();
      const searchUrl = `${this.config.jiraBaseUrl}/rest/api/3/search`;
      
      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          jql,
          maxResults: 50,
          fields: ['summary', 'description', 'status', 'assignee', 'project', 'labels', 'created', 'updated', 'customfield_*'],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error('Failed to poll Jira tasks', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        issues: Array<{
          key: string;
          fields: {
            summary: string;
            description?: string;
            status: { name: string };
            assignee?: { displayName: string };
            project: { key: string };
            labels?: string[];
            created: string;
            updated: string;
            [key: string]: unknown;
          };
        }>;
      };

      const tasks: JiraTask[] = data.issues.map((issue) => this.parseJiraIssue(issue));
      
      log.info(`Found ${tasks.length} task(s) assigned to bot user`);
      return tasks;
    } catch (error) {
      log.error('Error polling Jira tasks', { error: String(error) });
      throw error;
    }
  }

  /**
   * Get full task details for a specific task key
   * Requirements: 1.1 - Retrieve full task information
   * 
   * @param taskKey - Jira task key (e.g., "PROJ-123")
   * @returns Full JiraTask details
   */
  async getTaskDetails(taskKey: string): Promise<JiraTask> {
    log.debug(`Getting task details for ${taskKey}`);

    try {
      const issueUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}`;
      
      const response = await fetch(issueUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error(`Failed to get task details for ${taskKey}`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
      }

      const issue = await response.json() as {
        key: string;
        fields: {
          summary: string;
          description?: string;
          status: { name: string };
          assignee?: { displayName: string };
          project: { key: string };
          labels?: string[];
          created: string;
          updated: string;
          [key: string]: unknown;
        };
      };

      const task = this.parseJiraIssue(issue);
      log.debug(`Retrieved task details for ${taskKey}`, { summary: task.summary });
      
      return task;
    } catch (error) {
      log.error(`Error getting task details for ${taskKey}`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Start continuous polling with a callback handler
   * 
   * @param handler - Callback function to handle each discovered task
   */
  startPolling(handler: (task: JiraTask) => Promise<void>): void {
    if (this.isPolling) {
      log.warn('Polling already started');
      return;
    }

    this.isPolling = true;
    log.info('Starting continuous polling');

    const poll = async () => {
      if (!this.isPolling) return;

      try {
        const tasks = await this.pollTasks();
        
        for (const task of tasks) {
          if (!this.isPolling) break;
          
          try {
            await handler(task);
          } catch (error) {
            log.error(`Error handling task ${task.key}`, { error: String(error) });
          }
        }
      } catch (error) {
        log.error('Error in polling cycle', { error: String(error) });
      }

      if (this.isPolling) {
        this.pollingTimer = setTimeout(poll, this.pollingInterval);
      }
    };

    // Start first poll immediately
    void poll();
  }

  /**
   * Stop continuous polling
   */
  stopPolling(): void {
    if (!this.isPolling) {
      log.warn('Polling not started');
      return;
    }

    this.isPolling = false;
    
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    log.info('Polling stopped');
  }

  /**
   * Set up webhook for real-time notifications
   * Requirements: 1.1 - Support webhook-based real-time notifications
   * 
   * @param callbackUrl - The URL where Jira should send webhook events
   * @param events - Array of Jira events to subscribe to (default: ['jira:issue_updated'])
   * @returns WebhookConfig with URL, secret, and subscribed events
   */
  async setupWebhook(callbackUrl: string, events: string[] = ['jira:issue_updated']): Promise<WebhookConfig> {
    log.info('Setting up webhook', { callbackUrl, events });

    // Generate a secure secret for signature verification if not provided
    const secret = this.config.webhookSecret ?? crypto.randomBytes(32).toString('hex');

    try {
      const webhookUrl = `${this.config.jiraBaseUrl}/rest/webhooks/1.0/webhook`;
      
      const webhookPayload = {
        name: `API Testing Bot Webhook - ${Date.now()}`,
        url: callbackUrl,
        events,
        filters: {
          'issue-related-events-section': `assignee = "${this.config.botUserIdentifier}"`,
        },
        excludeBody: false,
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(webhookPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error('Failed to set up webhook', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Jira webhook setup error: ${response.status} ${response.statusText}`);
      }

      const webhookData = await response.json() as { self: string };
      
      log.info('Webhook set up successfully', { 
        webhookUrl: webhookData.self,
        callbackUrl,
        events,
      });

      return {
        url: callbackUrl,
        secret,
        events,
      };
    } catch (error) {
      log.error('Error setting up webhook', { error: String(error) });
      throw error;
    }
  }

  /**
   * Verify webhook signature for security
   * Requirements: 1.1 - Signature verification for webhook security
   * 
   * @param payload - The raw webhook payload body
   * @param signature - The signature from the webhook request header
   * @param secret - The webhook secret used for verification
   * @returns true if signature is valid, false otherwise
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    try {
      // Jira uses HMAC-SHA256 for webhook signatures
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        log.warn('Webhook signature verification failed');
      }

      return isValid;
    } catch (error) {
      log.error('Error verifying webhook signature', { error: String(error) });
      return false;
    }
  }

  /**
   * Handle incoming webhook callback
   * Requirements: 1.1 - Process webhook events for real-time task updates
   * 
   * @param payload - The webhook payload from Jira
   * @param signature - The signature from the webhook request header (optional)
   * @returns Parsed JiraTask if the webhook is for a task assignment/update, null otherwise
   */
  async handleWebhookCallback(payload: string, signature?: string): Promise<JiraTask | null> {
    log.debug('Handling webhook callback');

    try {
      // Verify signature if secret is configured and signature is provided
      if (this.config.webhookSecret && signature) {
        const isValid = this.verifyWebhookSignature(payload, signature, this.config.webhookSecret);
        if (!isValid) {
          log.error('Webhook signature verification failed - rejecting webhook');
          throw new Error('Invalid webhook signature');
        }
      }

      // Parse webhook payload
      const webhookData = JSON.parse(payload) as {
        webhookEvent: string;
        issue?: {
          key: string;
          fields: {
            summary: string;
            description?: string;
            status: { name: string };
            assignee?: { displayName: string };
            project: { key: string };
            labels?: string[];
            created: string;
            updated: string;
            [key: string]: unknown;
          };
        };
      };

      log.debug('Webhook event received', { event: webhookData.webhookEvent });

      // Only process issue-related events
      if (!webhookData.issue) {
        log.debug('Webhook event does not contain issue data - ignoring');
        return null;
      }

      // Check if the issue is assigned to the bot user
      const assignee = webhookData.issue.fields.assignee?.displayName;
      if (assignee !== this.config.botUserIdentifier) {
        log.debug('Issue not assigned to bot user - ignoring', { assignee });
        return null;
      }

      // Parse and return the task
      const task = this.parseJiraIssue(webhookData.issue);
      log.info('Webhook processed successfully', { taskKey: task.key, event: webhookData.webhookEvent });
      
      return task;
    } catch (error) {
      log.error('Error handling webhook callback', { error: String(error) });
      throw error;
    }
  }

  /**
   * Build JQL query for fetching bot-assigned tasks
   * 
   * @returns JQL query string
   */
  private buildJql(): string {
    if (this.config.jqlOverride) {
      return this.config.jqlOverride;
    }

    // Default JQL: tasks assigned to bot user, not done, without failure labels
    return `assignee = "${this.config.botUserIdentifier}" AND statusCategory != Done ORDER BY created DESC`;
  }

  /**
   * Parse Jira API issue response into JiraTask model
   * 
   * @param issue - Raw Jira API issue object
   * @returns Parsed JiraTask
   */
  private parseJiraIssue(issue: {
    key: string;
    fields: {
      summary: string;
      description?: string;
      status: { name: string };
      assignee?: { displayName: string };
      project: { key: string };
      labels?: string[];
      created: string;
      updated: string;
      [key: string]: unknown;
    };
  }): JiraTask {
    // Extract custom fields (any field starting with customfield_)
    const customFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(issue.fields)) {
      if (key.startsWith('customfield_')) {
        customFields[key] = value;
      }
    }

    return {
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.fields.description ?? '',
      assignee: issue.fields.assignee?.displayName ?? 'Unassigned',
      status: issue.fields.status.name,
      projectKey: issue.fields.project.key,
      customFields,
      labels: issue.fields.labels ?? [],
      createdAt: new Date(issue.fields.created),
      updatedAt: new Date(issue.fields.updated),
    };
  }
}
