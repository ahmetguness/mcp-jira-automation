/**
 * Example usage of ApprovalManager
 * Feature: api-endpoint-testing-transformation
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { ApprovalManager } from './ApprovalManager.js';
import type { EndpointSpec, GeneratedTests } from '../models/types.js';
import { HttpMethod, TestFramework } from '../models/enums.js';

// Example 1: Initialize ApprovalManager with approval required
const approvalManager = new ApprovalManager({
  jiraBaseUrl: 'https://your-domain.atlassian.net',
  jiraEmail: 'your-email@example.com',
  jiraApiToken: process.env.JIRA_API_TOKEN || '',
  requireApproval: true, // Enable approval mode
});

// Example 2: Check if approval is required
const isApprovalRequired = approvalManager.isApprovalRequired();
console.log('Approval required:', isApprovalRequired);

// Example 3: Generate test plan
const endpoints: EndpointSpec[] = [
  {
    url: 'https://api.example.com/users',
    method: HttpMethod.GET,
    headers: { 'Authorization': 'Bearer ${API_TOKEN}' },
    expectedStatus: 200,
    testScenarios: ['success', 'unauthorized', 'not_found'],
  },
  {
    url: 'https://api.example.com/users',
    method: HttpMethod.POST,
    headers: { 'Authorization': 'Bearer ${API_TOKEN}', 'Content-Type': 'application/json' },
    requestBody: { name: 'John Doe', email: 'john@example.com' },
    expectedStatus: 201,
    testScenarios: ['success', 'validation_error', 'duplicate_email'],
  },
];

const generatedTests: GeneratedTests = {
  testFiles: [
    {
      path: 'tests/api/test_users.py',
      content: '# Test content here',
      testCount: 6,
      coveredEndpoints: ['GET /users', 'POST /users'],
    },
  ],
  framework: TestFramework.PYTEST_REQUESTS,
  requiredEnvVars: ['API_BASE_URL', 'API_TOKEN'],
  setupCommands: ['pip install -r requirements.txt'],
  runCommand: 'pytest tests/api/ -v',
  warnings: [],
};

const testPlan = approvalManager.generateTestPlan(endpoints, generatedTests);
console.log('Test plan:', testPlan);

// Example 4: Format test plan for Jira
const formattedPlan = approvalManager.formatTestPlanForJira(testPlan);
console.log('Formatted test plan:\n', formattedPlan);

// Example 5: Request approval (async)
async function requestApprovalExample() {
  try {
    await approvalManager.requestApproval('PROJ-123', endpoints, generatedTests);
    console.log('Approval requested successfully');
  } catch (error) {
    console.error('Failed to request approval:', error);
  }
}

// Example 6: Check if task is approved (async)
async function checkApprovalExample() {
  try {
    const isApproved = await approvalManager.isTaskApproved('PROJ-123');
    console.log('Task approved:', isApproved);
  } catch (error) {
    console.error('Failed to check approval:', error);
  }
}

// Example 7: Wait for approval (async)
async function waitForApprovalExample() {
  try {
    console.log('Waiting for approval...');
    await approvalManager.waitForApproval(
      'PROJ-123',
      30000, // Poll every 30 seconds
      3600000 // Timeout after 1 hour
    );
    console.log('Approval received!');
  } catch (error) {
    console.error('Approval timeout or error:', error);
  }
}

// Example 8: Approval mode disabled (automatic execution)
const autoApprovalManager = new ApprovalManager({
  jiraBaseUrl: 'https://your-domain.atlassian.net',
  jiraEmail: 'your-email@example.com',
  jiraApiToken: process.env.JIRA_API_TOKEN || '',
  requireApproval: false, // Disable approval mode
});

async function autoExecutionExample() {
  // When approval is not required, these methods return immediately
  await autoApprovalManager.requestApproval('PROJ-124', endpoints, generatedTests);
  // No comment posted, no status change
  
  const isApproved = await autoApprovalManager.isTaskApproved('PROJ-124');
  console.log('Auto-approved:', isApproved); // Always true when approval disabled
  
  await autoApprovalManager.waitForApproval('PROJ-124');
  // Returns immediately without waiting
  
  console.log('Tests can execute immediately');
}

// Run examples (uncomment to test)
// requestApprovalExample();
// checkApprovalExample();
// waitForApprovalExample();
// autoExecutionExample();
