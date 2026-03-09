/**
 * ApprovalManager - Handles approval workflow for API tests
 * Feature: api-endpoint-testing-transformation
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 * 
 * This module implements an optional approval workflow where:
 * - When REQUIRE_APPROVAL=true: Generate test plan, post to Jira, wait for approval
 * - When REQUIRE_APPROVAL=false: Execute tests automatically
 */

import type { EndpointSpec, GeneratedTests } from '../models/types.js';
import { createLogger } from '../../logger.js';

const log = createLogger('api-testing:approval-manager');

/**
 * Configuration for approval manager
 */
export interface ApprovalManagerConfig {
  /** Jira base URL */
  jiraBaseUrl: string;
  
  /** Jira email for authentication */
  jiraEmail: string;
  
  /** Jira API token */
  jiraApiToken: string;
  
  /** Whether approval is required before running tests (default: false) */
  requireApproval?: boolean;
}

/**
 * Test plan to be posted to Jira for approval
 */
export interface TestPlan {
  endpoints: Array<{
    url: string;
    method: string;
    scenarios: string[];
  }>;
  framework: string;
  estimatedTestCount: number;
  requiredEnvVars: string[];
}

/**
 * ApprovalManager - Manages approval workflow for API tests
 * 
 * Requirements:
 * - 9.1: Post test plan to Jira when REQUIRE_APPROVAL=true
 * - 9.2: List endpoints and scenarios in test plan
 * - 9.3: Set task status to "Approval Pending"
 * - 9.4: Execute tests when status changes to "Approved"
 * - 9.5: Skip approval when REQUIRE_APPROVAL=false
 */
export class ApprovalManager {
  private config: ApprovalManagerConfig;
  private requireApproval: boolean;

  constructor(config: ApprovalManagerConfig) {
    this.config = config;
    this.requireApproval = config.requireApproval ?? false;
    
    log.info('ApprovalManager initialized', {
      requireApproval: this.requireApproval,
    });
  }

  /**
   * Check if approval is required
   * Requirements: 9.5 - Skip approval when REQUIRE_APPROVAL=false
   * 
   * @returns true if approval is required, false otherwise
   */
  isApprovalRequired(): boolean {
    return this.requireApproval;
  }

  /**
   * Generate test plan from endpoints and generated tests
   * Requirements: 9.2 - List endpoints and scenarios in test plan
   * 
   * @param endpoints - Parsed endpoint specifications
   * @param generatedTests - Generated test files and metadata
   * @returns Test plan with endpoint and scenario information
   */
  generateTestPlan(endpoints: EndpointSpec[], generatedTests: GeneratedTests): TestPlan {
    log.debug('Generating test plan', {
      endpointCount: endpoints.length,
      testFileCount: generatedTests.testFiles.length,
    });

    const testPlan: TestPlan = {
      endpoints: endpoints.map(endpoint => ({
        url: endpoint.url,
        method: endpoint.method,
        scenarios: endpoint.testScenarios,
      })),
      framework: generatedTests.framework,
      estimatedTestCount: generatedTests.testFiles.reduce(
        (sum, file) => sum + file.testCount,
        0
      ),
      requiredEnvVars: generatedTests.requiredEnvVars,
    };

    log.info('Test plan generated', {
      endpointCount: testPlan.endpoints.length,
      estimatedTestCount: testPlan.estimatedTestCount,
    });

    return testPlan;
  }

  /**
   * Format test plan as Markdown for Jira comment
   * Requirements: 9.1, 9.2 - Post test plan with endpoint and scenario list
   * 
   * @param testPlan - Test plan to format
   * @returns Markdown-formatted test plan
   */
  formatTestPlanForJira(testPlan: TestPlan): string {
    const lines: string[] = [
      '🔍 *API Test Plan - Approval Required*',
      '',
      'The following API tests are ready to be executed. Please review and approve.',
      '',
      '## Test Summary',
      '',
      `- **Framework:** ${testPlan.framework}`,
      `- **Total Endpoints:** ${testPlan.endpoints.length}`,
      `- **Estimated Test Count:** ${testPlan.estimatedTestCount}`,
      '',
      '## Endpoints to Test',
      '',
    ];

    // List each endpoint with its scenarios
    testPlan.endpoints.forEach((endpoint, index) => {
      lines.push(`### ${index + 1}. ${endpoint.method} ${endpoint.url}`);
      lines.push('');
      lines.push('**Test Scenarios:**');
      endpoint.scenarios.forEach(scenario => {
        lines.push(`- ${scenario}`);
      });
      lines.push('');
    });

    // Add required environment variables
    if (testPlan.requiredEnvVars.length > 0) {
      lines.push('## Required Environment Variables');
      lines.push('');
      testPlan.requiredEnvVars.forEach(envVar => {
        lines.push(`- \`${envVar}\``);
      });
      lines.push('');
    }

    // Add approval instructions
    lines.push('## Approval Instructions');
    lines.push('');
    lines.push('To approve and execute these tests:');
    lines.push('1. Review the endpoints and test scenarios above');
    lines.push('2. Ensure all required environment variables are configured');
    lines.push('3. Change the task status to **"Approved"**');
    lines.push('');
    lines.push('The tests will execute automatically once approved.');

    return lines.join('\n');
  }

  /**
   * Request approval for test execution
   * Requirements: 9.1, 9.2, 9.3 - Post test plan and set status to "Approval Pending"
   * 
   * @param taskKey - Jira task key
   * @param endpoints - Parsed endpoint specifications
   * @param generatedTests - Generated test files and metadata
   * @returns Promise that resolves when approval request is posted
   */
  async requestApproval(
    taskKey: string,
    endpoints: EndpointSpec[],
    generatedTests: GeneratedTests
  ): Promise<void> {
    if (!this.requireApproval) {
      log.debug(`Approval not required for task ${taskKey}, skipping`);
      return;
    }

    log.info(`Requesting approval for task ${taskKey}`);

    try {
      // Generate test plan
      const testPlan = this.generateTestPlan(endpoints, generatedTests);
      const testPlanComment = this.formatTestPlanForJira(testPlan);

      // Post test plan to Jira
      await this.postJiraComment(taskKey, testPlanComment);
      log.info(`Test plan posted to Jira for task ${taskKey}`);

      // Set task status to "Approval Pending"
      await this.setTaskStatus(taskKey, 'Approval Pending');
      log.info(`Task ${taskKey} status set to "Approval Pending"`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to request approval for task ${taskKey}`, { error: errorMessage });
      throw new Error(`Approval request failed: ${errorMessage}`, { cause: error });
    }
  }

  /**
   * Check if a task has been approved
   * Requirements: 9.4 - Execute tests when status changes to "Approved"
   * 
   * @param taskKey - Jira task key
   * @returns Promise that resolves to true if task is approved, false otherwise
   */
  async isTaskApproved(taskKey: string): Promise<boolean> {
    if (!this.requireApproval) {
      // If approval is not required, always return true
      return true;
    }

    log.debug(`Checking approval status for task ${taskKey}`);

    try {
      const status = await this.getTaskStatus(taskKey);
      const isApproved = status === 'Approved';
      
      log.debug(`Task ${taskKey} approval status: ${isApproved ? 'approved' : 'not approved'}`, {
        currentStatus: status,
      });

      return isApproved;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to check approval status for task ${taskKey}`, { error: errorMessage });
      throw new Error(`Approval check failed: ${errorMessage}`, { cause: error });
    }
  }

  /**
   * Wait for task approval (polling-based)
   * Requirements: 9.4 - Execute tests when status changes to "Approved"
   * 
   * @param taskKey - Jira task key
   * @param pollIntervalMs - Polling interval in milliseconds (default: 30000 = 30 seconds)
   * @param timeoutMs - Timeout in milliseconds (default: 3600000 = 1 hour)
   * @returns Promise that resolves when task is approved or rejects on timeout
   */
  async waitForApproval(
    taskKey: string,
    pollIntervalMs: number = 30000,
    timeoutMs: number = 3600000
  ): Promise<void> {
    if (!this.requireApproval) {
      log.debug(`Approval not required for task ${taskKey}, skipping wait`);
      return;
    }

    log.info(`Waiting for approval for task ${taskKey}`, {
      pollIntervalMs,
      timeoutMs,
    });

    const startTime = Date.now();

    while (true) {
      // Check if timeout exceeded
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Approval timeout exceeded for task ${taskKey}`);
      }

      // Check if task is approved
      const isApproved = await this.isTaskApproved(taskKey);
      if (isApproved) {
        log.info(`Task ${taskKey} approved, proceeding with test execution`);
        return;
      }

      // Wait before next poll
      log.debug(`Task ${taskKey} not yet approved, waiting ${pollIntervalMs}ms before next check`);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Post a comment to a Jira task
   * 
   * @param taskKey - Jira task key
   * @param comment - Comment text (Markdown format)
   */
  private async postJiraComment(taskKey: string, comment: string): Promise<void> {
    const commentUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}/comment`;
    
    const response = await fetch(commentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: comment,
                },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to post Jira comment: ${response.status} ${errorText}`);
    }

    log.debug(`Posted comment to Jira task ${taskKey}`);
  }

  /**
   * Set the status of a Jira task
   * 
   * @param taskKey - Jira task key
   * @param status - New status (e.g., "Approval Pending", "Approved")
   */
  private async setTaskStatus(taskKey: string, status: string): Promise<void> {
    // First, get available transitions for the task
    const transitionsUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}/transitions`;
    
    const transitionsResponse = await fetch(transitionsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Accept': 'application/json',
      },
    });

    if (!transitionsResponse.ok) {
      const errorText = await transitionsResponse.text();
      throw new Error(`Failed to get transitions: ${transitionsResponse.status} ${errorText}`);
    }

    const transitionsData = await transitionsResponse.json() as { transitions: Array<{ id: string; name: string; to: { name: string } }> };
    
    // Find the transition that leads to the desired status
    const transition = transitionsData.transitions.find(t => t.to.name === status);
    
    if (!transition) {
      log.warn(`No transition found to status "${status}" for task ${taskKey}`, {
        availableTransitions: transitionsData.transitions.map(t => t.to.name),
      });
      throw new Error(`No transition available to status "${status}"`);
    }

    // Execute the transition
    const response = await fetch(transitionsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        transition: {
          id: transition.id,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set task status: ${response.status} ${errorText}`);
    }

    log.debug(`Set status of task ${taskKey} to "${status}"`);
  }

  /**
   * Get the current status of a Jira task
   * 
   * @param taskKey - Jira task key
   * @returns Current status name
   */
  private async getTaskStatus(taskKey: string): Promise<string> {
    const issueUrl = `${this.config.jiraBaseUrl}/rest/api/3/issue/${taskKey}?fields=status`;
    
    const response = await fetch(issueUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jiraEmail}:${this.config.jiraApiToken}`).toString('base64')}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get task status: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { fields: { status: { name: string } } };
    return data.fields.status.name;
  }
}
