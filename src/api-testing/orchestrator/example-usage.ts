/**
 * Example usage of ApiTestOrchestrator
 * Feature: api-endpoint-testing-transformation
 * 
 * This file demonstrates how to use the orchestrator to process API testing tasks.
 */

import { ApiTestOrchestrator } from './ApiTestOrchestrator.js';

/**
 * Example 1: Process a single task by key
 */
async function processSingleTask() {
  const orchestrator = new ApiTestOrchestrator({
    jira: {
      jiraBaseUrl: 'https://your-company.atlassian.net',
      jiraEmail: 'bot@example.com',
      jiraApiToken: process.env.JIRA_API_TOKEN!,
      botUserIdentifier: 'AI Cyber Bot',
    },
    repository: {
      defaultRepositoryUrl: 'https://github.com/your-org/your-repo',
      defaultBranch: 'main',
      scmAuthToken: process.env.GITHUB_TOKEN,
    },
    appConfig: {} as any,
  });

  // Process a specific task
  const result = await orchestrator.processTaskByKey('PROJ-123');
  
  if (result.success) {
    console.log(`✅ Task ${result.taskKey} processed successfully`);
    console.log(`   Endpoints tested: ${result.endpoints?.length ?? 0}`);
    console.log(`   Tests passed: ${result.testResults?.passedTests ?? 0}/${result.testResults?.totalTests ?? 0}`);
  } else {
    console.error(`❌ Task ${result.taskKey} failed at stage: ${result.stage}`);
    console.error(`   Error: ${result.error}`);
  }
}

/**
 * Example 2: Start continuous polling
 */
async function startContinuousPolling() {
  const orchestrator = new ApiTestOrchestrator({
    jira: {
      jiraBaseUrl: 'https://your-company.atlassian.net',
      jiraEmail: 'bot@example.com',
      jiraApiToken: process.env.JIRA_API_TOKEN!,
      botUserIdentifier: 'AI Cyber Bot',
      pollingIntervalSeconds: 60, // Poll every 60 seconds
    },
    repository: {
      defaultRepositoryUrl: 'https://github.com/your-org/your-repo',
      scmAuthToken: process.env.GITHUB_TOKEN,
    },
    enablePolling: true, // Enable continuous polling
    appConfig: {} as any,
  });

  // Start the orchestrator
  await orchestrator.start();
  
  console.log('🚀 Orchestrator started - polling for tasks...');
  
  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\n⏹️  Stopping orchestrator...');
    orchestrator.stop();
    process.exit(0);
  });
}

/**
 * Example 3: Process task with custom configuration
 */
async function processWithCustomConfig() {
  const orchestrator = new ApiTestOrchestrator({
    jira: {
      jiraBaseUrl: 'https://your-company.atlassian.net',
      jiraEmail: 'bot@example.com',
      jiraApiToken: process.env.JIRA_API_TOKEN!,
      botUserIdentifier: 'AI Cyber Bot',
    },
    repository: {
      // Use project-level mappings
      projectMappings: {
        'PROJ': 'https://github.com/your-org/project-repo',
        'API': 'https://github.com/your-org/api-repo',
      },
      defaultBranch: 'develop',
      scmAuthToken: process.env.GITHUB_TOKEN,
    },
    execution: {
      timeoutSeconds: 600, // 10 minutes timeout
      retryCount: 3,
      retryBackoffSeconds: [1, 2, 4],
    },
    commit: {
      commitTestScripts: true,
      commitTestResults: false,
      createPullRequest: true,
      branchPrefix: 'api-test',
    },
    requireApproval: false, // Auto-execute tests without approval
    appConfig: {} as any,
  });

  const result = await orchestrator.processTaskByKey('PROJ-456');
  
  console.log(`Task ${result.taskKey}: ${result.success ? '✅ Success' : '❌ Failed'}`);
}

// Run examples (uncomment to use)
// processSingleTask().catch(console.error);
// startContinuousPolling().catch(console.error);
// processWithCustomConfig().catch(console.error);
