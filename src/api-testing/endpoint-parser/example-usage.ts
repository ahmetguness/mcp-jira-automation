/**
 * Example usage of EndpointParser with error reporting
 * Feature: api-endpoint-testing-transformation
 * Requirements: 1.4
 * 
 * This file demonstrates how to use the EndpointParser to parse and validate
 * endpoint specifications, and how to format error messages for Jira.
 */

import { EndpointParser } from './EndpointParser.js';
import type { JiraTask } from '../models/types.js';

/**
 * Example: Process a Jira task and report errors if specifications are invalid
 * 
 * This function demonstrates the complete workflow:
 * 1. Parse endpoints from task description
 * 2. Validate each endpoint
 * 3. If errors exist, format an error comment for Jira
 * 4. Return valid endpoints or error message
 */
export async function processTaskEndpoints(
  task: JiraTask,
  jiraClient: { addComment: (taskKey: string, comment: string) => Promise<void> }
): Promise<{ success: boolean; endpoints?: any[]; errorComment?: string }> {
  const parser = new EndpointParser();
  
  // Parse and validate endpoints
  const result = parser.parseAndValidateEndpoints(task.description);
  
  // If there are errors, format error comment and post to Jira
  if (result.hasErrors) {
    const errorComment = parser.formatErrorCommentForJira(
      result.validationResults,
      task.description
    );
    
    // Post error comment to Jira
    await jiraClient.addComment(task.key, errorComment);
    
    return {
      success: false,
      errorComment,
    };
  }
  
  // If no errors, return valid endpoints
  return {
    success: true,
    endpoints: result.endpoints,
  };
}

/**
 * Example task with invalid endpoint specification
 */
export const exampleInvalidTask: JiraTask = {
  key: 'TEST-123',
  summary: 'Test API endpoints',
  description: `
Please test these endpoints:

\`\`\`json
{
  "url": "",
  "method": "INVALID_METHOD",
  "expectedStatus": 999
}
\`\`\`
  `,
  assignee: 'bot',
  status: 'Open',
  projectKey: 'TEST',
  customFields: {},
  labels: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Example task with valid endpoint specification
 */
export const exampleValidTask: JiraTask = {
  key: 'TEST-124',
  summary: 'Test API endpoints',
  description: `
Please test these endpoints:

\`\`\`json
{
  "url": "/api/users",
  "method": "GET",
  "headers": {
    "Content-Type": "application/json"
  },
  "expectedStatus": 200,
  "authType": "bearer",
  "testScenarios": ["success", "unauthorized"]
}
\`\`\`
  `,
  assignee: 'bot',
  status: 'Open',
  projectKey: 'TEST',
  customFields: {},
  labels: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Example: Run the parser on both valid and invalid tasks
 */
export function demonstrateErrorReporting(): void {
  const parser = new EndpointParser();
  
  console.log('=== Processing Invalid Task ===');
  const invalidResult = parser.parseAndValidateEndpoints(exampleInvalidTask.description);
  console.log('Has errors:', invalidResult.hasErrors);
  console.log('Valid endpoints:', invalidResult.endpoints.length);
  
  if (invalidResult.hasErrors) {
    const errorComment = parser.formatErrorCommentForJira(
      invalidResult.validationResults,
      exampleInvalidTask.description
    );
    console.log('\nError comment that would be posted to Jira:');
    console.log(errorComment);
  }
  
  console.log('\n=== Processing Valid Task ===');
  const validResult = parser.parseAndValidateEndpoints(exampleValidTask.description);
  console.log('Has errors:', validResult.hasErrors);
  console.log('Valid endpoints:', validResult.endpoints.length);
  console.log('Endpoint URL:', validResult.endpoints[0]?.url);
}
