/**
 * ApiTestOrchestrator - Main orchestration module for API endpoint testing
 * Feature: api-endpoint-testing-transformation
 * Requirements: All requirements (integration)
 * 
 * This module connects all components together in a pipeline:
 * Jira → Parse → Resolve → Retrieve → Generate → Execute → Report
 */

import type {
  JiraTask,
  EndpointSpec,
  RepositoryInfo,
  TestContext,
  GeneratedTests,
  TestResults,
  ExecutionConfig,
  CommitConfig,
  ValidationResult,
} from '../models/types.js';
import { TestFramework } from '../models/enums.js';
import { JiraListener, type JiraListenerConfig } from '../jira-listener/JiraListener.js';
import { EndpointParser } from '../endpoint-parser/EndpointParser.js';
import { RepositoryResolver, type RepositoryResolverConfig } from '../repository-resolver/RepositoryResolver.js';
import { ApprovalManager } from '../approval-manager/ApprovalManager.js';
import { createLogger } from '../../logger.js';

const log = createLogger('api-testing:orchestrator');

/**
 * Configuration for the orchestrator
 */
export interface OrchestratorConfig {
  /** Jira listener configuration */
  jira: JiraListenerConfig;
  
  /** Repository resolver configuration */
  repository?: RepositoryResolverConfig;
  
  /** Execution configuration */
  execution?: Partial<ExecutionConfig>;
  
  /** Commit configuration */
  commit?: Partial<CommitConfig>;
  
  /** Whether to require approval before running tests (default: false) */
  requireApproval?: boolean;
  
  /** Whether to enable continuous polling (default: false) */
  enablePolling?: boolean;
  
  /** Polling interval in seconds (default: 60) */
  pollingIntervalSeconds?: number;
}

/**
 * Result of processing a single task
 */
export interface TaskProcessingResult {
  taskKey: string;
  success: boolean;
  stage: PipelineStage;
  error?: string;
  endpoints?: EndpointSpec[];
  repository?: RepositoryInfo;
  testResults?: TestResults;
}

/**
 * Pipeline stages for error tracking
 */
export enum PipelineStage {
  TASK_RECEIVED = 'task_received',
  PARSING = 'parsing',
  VALIDATION = 'validation',
  REPOSITORY_RESOLUTION = 'repository_resolution',
  CONTEXT_RETRIEVAL = 'context_retrieval',
  TEST_GENERATION = 'test_generation',
  TEST_EXECUTION = 'test_execution',
  REPORTING = 'reporting',
  COMPLETED = 'completed',
}

/**
 * ApiTestOrchestrator - Main pipeline orchestrator
 * 
 * Coordinates the entire API testing workflow:
 * 1. Listen for Jira tasks (using JiraListener)
 * 2. Parse endpoints (using EndpointParser)
 * 3. Resolve repository (using RepositoryResolver)
 * 4. Retrieve context (using ContextRetrieval - placeholder)
 * 5. Generate tests (using TestScriptGenerator - placeholder)
 * 6. Execute tests (using TestExecutor - placeholder)
 * 7. Report results (using TestReporter - placeholder)
 */
export class ApiTestOrchestrator {
  private config: OrchestratorConfig;
  private jiraListener: JiraListener;
  private endpointParser: EndpointParser;
  private repositoryResolver: RepositoryResolver;
  private approvalManager: ApprovalManager;
  private isRunning: boolean = false;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    
    // Initialize components
    this.jiraListener = new JiraListener(config.jira);
    this.endpointParser = new EndpointParser();
    this.repositoryResolver = new RepositoryResolver(config.repository);
    
    // Initialize approval manager
    this.approvalManager = new ApprovalManager({
      jiraBaseUrl: config.jira.jiraBaseUrl,
      jiraEmail: config.jira.jiraEmail,
      jiraApiToken: config.jira.jiraApiToken,
      requireApproval: config.requireApproval ?? false,
    });

    log.info('ApiTestOrchestrator initialized', {
      requireApproval: config.requireApproval ?? false,
      enablePolling: config.enablePolling ?? false,
    });
  }

  /**
   * Start the orchestrator
   * Begins listening for Jira tasks and processing them through the pipeline
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Orchestrator already running');
      return;
    }

    this.isRunning = true;
    log.info('Starting API Test Orchestrator');

    if (this.config.enablePolling) {
      // Start continuous polling
      this.jiraListener.startPolling(async (task) => {
        await this.processTask(task);
      });
      
      log.info('Continuous polling started');
    } else {
      log.info('Orchestrator started in manual mode (polling disabled)');
    }
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    if (!this.isRunning) {
      log.warn('Orchestrator not running');
      return;
    }

    this.isRunning = false;
    this.jiraListener.stopPolling();
    
    log.info('API Test Orchestrator stopped');
  }

  /**
   * Process a single Jira task through the entire pipeline
   * Requirements: All requirements (integration)
   * 
   * @param task - Jira task to process
   * @returns Processing result with success status and details
   */
  async processTask(task: JiraTask): Promise<TaskProcessingResult> {
    log.info(`Processing task ${task.key}`, { summary: task.summary });

    let currentStage = PipelineStage.TASK_RECEIVED;

    try {
      // Stage 1: Parse endpoints from task description
      currentStage = PipelineStage.PARSING;
      log.debug(`[${task.key}] Stage: Parsing endpoints`);
      
      const parseResult = this.endpointParser.parseAndValidateEndpoints(task.description);
      
      // Stage 2: Validate endpoints
      currentStage = PipelineStage.VALIDATION;
      log.debug(`[${task.key}] Stage: Validating endpoints`);
      
      if (parseResult.hasErrors) {
        // Report validation errors to Jira
        await this.reportValidationErrors(task, parseResult.validationResults);
        
        return {
          taskKey: task.key,
          success: false,
          stage: PipelineStage.VALIDATION,
          error: 'Endpoint validation failed',
        };
      }

      if (parseResult.endpoints.length === 0) {
        await this.reportNoEndpointsFound(task);
        
        return {
          taskKey: task.key,
          success: false,
          stage: PipelineStage.PARSING,
          error: 'No valid endpoints found in task description',
        };
      }

      log.info(`[${task.key}] Parsed ${parseResult.endpoints.length} endpoint(s)`);

      // Stage 3: Resolve repository
      currentStage = PipelineStage.REPOSITORY_RESOLUTION;
      log.debug(`[${task.key}] Stage: Resolving repository`);
      
      const repository = this.resolveRepository(task);
      log.info(`[${task.key}] Resolved repository: ${repository.url}`);

      // Stage 4: Retrieve context (placeholder)
      currentStage = PipelineStage.CONTEXT_RETRIEVAL;
      log.debug(`[${task.key}] Stage: Retrieving context`);
      
      const context = this.retrieveContext(repository, parseResult.endpoints);
      log.info(`[${task.key}] Retrieved context: ${context.apiSpecifications.length} API specs, ${context.existingTests.length} existing tests`);

      // Stage 5: Generate tests (placeholder)
      currentStage = PipelineStage.TEST_GENERATION;
      log.debug(`[${task.key}] Stage: Generating tests`);
      
      const generatedTests = this.generateTests(context, parseResult.endpoints);
      log.info(`[${task.key}] Generated ${generatedTests.testFiles.length} test file(s)`);

      // Stage 5.5: Request approval if required
      // Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
      if (this.approvalManager.isApprovalRequired()) {
        log.info(`[${task.key}] Approval required, requesting approval`);
        
        await this.approvalManager.requestApproval(
          task.key,
          parseResult.endpoints,
          generatedTests
        );
        
        log.info(`[${task.key}] Approval requested, waiting for approval`);
        
        // Wait for approval (with 1 hour timeout)
        await this.approvalManager.waitForApproval(task.key);
        
        log.info(`[${task.key}] Approval received, proceeding with test execution`);
      } else {
        log.info(`[${task.key}] Approval not required, proceeding with test execution`);
      }

      // Stage 6: Execute tests (placeholder)
      currentStage = PipelineStage.TEST_EXECUTION;
      log.debug(`[${task.key}] Stage: Executing tests`);
      
      const testResults = this.executeTests(generatedTests, repository);
      log.info(`[${task.key}] Tests executed: ${testResults.passedTests}/${testResults.totalTests} passed`);

      // Stage 7: Report results (placeholder)
      currentStage = PipelineStage.REPORTING;
      log.debug(`[${task.key}] Stage: Reporting results`);
      
      this.reportResults(task, testResults, generatedTests, repository);
      log.info(`[${task.key}] Results reported to Jira and SCM`);

      // Pipeline completed successfully
      currentStage = PipelineStage.COMPLETED;
      log.info(`[${task.key}] Pipeline completed successfully`);

      return {
        taskKey: task.key,
        success: true,
        stage: PipelineStage.COMPLETED,
        endpoints: parseResult.endpoints,
        repository,
        testResults,
      };

    } catch (error) {
      // Handle errors at any pipeline stage
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[${task.key}] Pipeline failed at stage ${currentStage}`, { error: errorMessage });

      // Report error to Jira
      await this.reportPipelineError(task, currentStage, errorMessage);

      return {
        taskKey: task.key,
        success: false,
        stage: currentStage,
        error: errorMessage,
      };
    }
  }

  /**
   * Process a task by key (convenience method)
   * 
   * @param taskKey - Jira task key (e.g., "PROJ-123")
   * @returns Processing result
   */
  async processTaskByKey(taskKey: string): Promise<TaskProcessingResult> {
    log.info(`Fetching task details for ${taskKey}`);
    
    try {
      const task = await this.jiraListener.getTaskDetails(taskKey);
      return await this.processTask(task);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to fetch task ${taskKey}`, { error: errorMessage });
      
      return {
        taskKey,
        success: false,
        stage: PipelineStage.TASK_RECEIVED,
        error: `Failed to fetch task: ${errorMessage}`,
      };
    }
  }

  /**
   * Resolve repository for the task
   * Requirements: 1.1 (implicit - repository needed for context)
   */
  private resolveRepository(task: JiraTask): RepositoryInfo {
    try {
      return this.repositoryResolver.resolveRepository(task);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to resolve repository for ${task.key}`, { error: errorMessage });
      throw new Error(`Repository resolution failed: ${errorMessage}`, { cause: error });
    }
  }

  /**
   * Retrieve context from repository (placeholder)
   * Requirements: 11.2 - Only retrieve test-relevant files
   * 
   * TODO: Implement using ContextRetrieval module
   */
  private retrieveContext(
    _repository: RepositoryInfo,
    _endpoints: EndpointSpec[]
  ): TestContext {
    log.warn('Context retrieval not yet implemented - using placeholder');
    
    // Placeholder: Return empty context
    return {
      apiSpecifications: [],
      existingTests: [],
      documentation: [],
      configurationFiles: [],
      repositoryInfo: _repository,
    };
  }

  /**
   * Generate test scripts (placeholder)
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
   * 
   * TODO: Implement using TestScriptGenerator module
   */
  private generateTests(
    _context: TestContext,
    _endpoints: EndpointSpec[]
  ): GeneratedTests {
    log.warn('Test generation not yet implemented - using placeholder');
    
    // Placeholder: Return empty test generation result
    return {
      testFiles: [],
      framework: _context.detectedFramework ?? TestFramework.PYTEST_REQUESTS,
      requiredEnvVars: ['API_BASE_URL', 'API_TOKEN'],
      setupCommands: ['pip install -r requirements.txt'],
      runCommand: 'pytest tests/api/ -v',
      warnings: ['Test generation not yet implemented'],
    };
  }

  /**
   * Execute tests in Docker container (placeholder)
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
   * 
   * TODO: Implement using TestExecutor module
   */
  private executeTests(
    _generatedTests: GeneratedTests,
    _repository: RepositoryInfo
  ): TestResults {
    log.warn('Test execution not yet implemented - using placeholder');
    
    // Placeholder: Return mock test results
    return {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      durationSeconds: 0,
      testCases: [],
      timestamp: new Date(),
    };
  }

  /**
   * Report results to Jira and SCM (placeholder)
   * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
   * 
   * TODO: Implement using TestReporter module
   */
  private reportResults(
    _task: JiraTask,
    _testResults: TestResults,
    _generatedTests: GeneratedTests,
    _repository: RepositoryInfo
  ): void {
    log.warn('Result reporting not yet implemented - using placeholder');
    
    // Placeholder: Log that reporting would happen here
    log.info(`Would report results for task ${_task.key} to Jira and SCM`);
  }

  /**
   * Report validation errors to Jira
   * Requirements: 1.4 - Report descriptive errors for invalid specifications
   */
  private async reportValidationErrors(
    task: JiraTask,
    validationResults: Array<{ spec?: EndpointSpec; validation: ValidationResult }>
  ): Promise<void> {
    log.info(`Reporting validation errors to Jira for task ${task.key}`);

    try {
      const errorComment = this.endpointParser.formatErrorCommentForJira(
        validationResults,
        task.description
      );

      await this.postJiraComment(task.key, errorComment);
      await this.addJiraLabel(task.key, 'invalid-specification');
      
      log.info(`Validation errors reported to Jira for task ${task.key}`);
    } catch (error) {
      log.error(`Failed to report validation errors to Jira for ${task.key}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - validation error reporting failure shouldn't stop the pipeline
    }
  }

  /**
   * Report that no endpoints were found in task description
   * Requirements: 1.4 - Report descriptive errors
   */
  private async reportNoEndpointsFound(task: JiraTask): Promise<void> {
    log.info(`Reporting no endpoints found to Jira for task ${task.key}`);

    const comment = `❌ *No API Endpoints Found*

No valid API endpoint specifications were found in the task description.

Please provide endpoint specifications in one of the supported formats:
- JSON code blocks
- YAML code blocks
- Markdown tables

See the [documentation](link-to-docs) for examples and format details.`;

    try {
      await this.postJiraComment(task.key, comment);
      await this.addJiraLabel(task.key, 'invalid-specification');
      
      log.info(`No endpoints message posted to Jira for task ${task.key}`);
    } catch (error) {
      log.error(`Failed to report no endpoints to Jira for ${task.key}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Report pipeline error to Jira
   * Requirements: Error handling at each pipeline stage
   */
  private async reportPipelineError(
    task: JiraTask,
    stage: PipelineStage,
    errorMessage: string
  ): Promise<void> {
    log.info(`Reporting pipeline error to Jira for task ${task.key}`);

    const comment = `❌ *Pipeline Error*

The API testing pipeline failed at stage: **${stage}**

**Error:** ${errorMessage}

Please check the task configuration and try again. If the problem persists, contact support.`;

    try {
      await this.postJiraComment(task.key, comment);
      await this.addJiraLabel(task.key, 'pipeline-error');
      
      log.info(`Pipeline error reported to Jira for task ${task.key}`);
    } catch (error) {
      log.error(`Failed to report pipeline error to Jira for ${task.key}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Post a comment to a Jira task
   * 
   * @param taskKey - Jira task key
   * @param comment - Comment text (supports Markdown)
   */
  private async postJiraComment(taskKey: string, comment: string): Promise<void> {
    const commentUrl = `${this.config.jira.jiraBaseUrl}/rest/api/3/issue/${taskKey}/comment`;
    
    const response = await fetch(commentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jira.jiraEmail}:${this.config.jira.jiraApiToken}`).toString('base64')}`,
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
   * Add a label to a Jira task
   * 
   * @param taskKey - Jira task key
   * @param label - Label to add
   */
  private async addJiraLabel(taskKey: string, label: string): Promise<void> {
    const issueUrl = `${this.config.jira.jiraBaseUrl}/rest/api/3/issue/${taskKey}`;
    
    const response = await fetch(issueUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.jira.jiraEmail}:${this.config.jira.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        update: {
          labels: [
            { add: label },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add Jira label: ${response.status} ${errorText}`);
    }

    log.debug(`Added label '${label}' to Jira task ${taskKey}`);
  }
}
