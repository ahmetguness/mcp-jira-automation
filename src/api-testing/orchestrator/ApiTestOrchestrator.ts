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
import { TestScriptGenerator } from '../test-script-generator/TestScriptGenerator.js';
import { TestExecutor } from '../test-executor/TestExecutor.js';
import { TestReporter } from '../test-reporter/TestReporter.js';
import { ContextRetrieval } from '../context-retrieval/ContextRetrieval.js';
import { SpecDetector } from '../specification/SpecDetector.js';
import { TestStrategyManager, type TestPlan } from '../strategy/TestStrategyManager.js';
import { createLogger } from '../../logger.js';
import type { Config } from '../../config.js';

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

  /** Global app config */
  appConfig: Config;
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
  private testScriptGenerator: TestScriptGenerator;
  private testExecutor: TestExecutor;
  private testReporter: TestReporter;
  private contextRetrieval: ContextRetrieval;
  private specDetector: SpecDetector;
  private strategyManager: TestStrategyManager;
  private isRunning: boolean = false;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    
    // Initialize components
    this.jiraListener = new JiraListener(config.jira);
    this.endpointParser = new EndpointParser();
    this.repositoryResolver = new RepositoryResolver(config.repository);
    
    this.testScriptGenerator = new TestScriptGenerator(config.appConfig);
    this.testExecutor = new TestExecutor();
    this.testReporter = new TestReporter({
      jiraBaseUrl: config.jira.jiraBaseUrl,
      jiraEmail: config.jira.jiraEmail,
      jiraApiToken: config.jira.jiraApiToken,
      scmProvider: undefined // Will be set in app.ts if SCM exists
    });

    this.contextRetrieval = new ContextRetrieval();
    this.specDetector = new SpecDetector();
    this.strategyManager = new TestStrategyManager();
    
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

      // Stage 4: Retrieve context
      currentStage = PipelineStage.CONTEXT_RETRIEVAL;
      log.debug(`[${task.key}] Stage: Retrieving context`);
      
      const context = await this.retrieveContext(repository, parseResult.endpoints);
      log.info(`[${task.key}] Retrieved context: ${context.apiSpecifications.length} API specs, ${context.existingTests.length} existing tests`);

      // Stage 4.5: Construct test plan
      log.debug(`[${task.key}] Stage: Constructing test plan`);
      const discoveredSpecs = this.specDetector.parseSpecifications(context.apiSpecifications);
      const testPlan = this.strategyManager.generateTestPlan(parseResult.endpoints, discoveredSpecs, context);

      // Stage 5: Generate tests
      currentStage = PipelineStage.TEST_GENERATION;
      log.debug(`[${task.key}] Stage: Generating tests`);
      
      const generatedTests = await this.generateTests(context, testPlan);
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

      // Stage 6: Execute tests
      currentStage = PipelineStage.TEST_EXECUTION;
      log.debug(`[${task.key}] Stage: Executing tests`);
      
      const testResults = await this.executeTests(generatedTests, repository);
      log.info(`[${task.key}] Tests executed: ${testResults.passedTests}/${testResults.totalTests} passed`);

      // Stage 7: Report results
      currentStage = PipelineStage.REPORTING;
      log.debug(`[${task.key}] Stage: Reporting results`);
      
      await this.reportResults(task, testResults, generatedTests, repository);
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
   * Retrieve context from repository
   * Requirements: 11.2 - Only retrieve test-relevant files
   */
  private async retrieveContext(
    _repository: RepositoryInfo,
    _endpoints: EndpointSpec[]
  ): Promise<TestContext> {
    log.info('Retrieving relevant files from repository...');
    return await this.contextRetrieval.retrieveContext(_repository, _endpoints);
  }

  /**
   * Generate test scripts
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
   */
  private async generateTests(
    _context: TestContext,
    _testPlan: TestPlan
  ): Promise<GeneratedTests> {
    log.info('Generating tests...');
    
    // Select framework
    const framework = this.testScriptGenerator.selectFramework(_context);

    // Call actual generator
    return await this.testScriptGenerator.generateTests(_context, _testPlan, framework);
  }

  /**
   * Execute tests in Docker container
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
   */
  private async executeTests(
    _generatedTests: GeneratedTests,
    _repository: RepositoryInfo
  ): Promise<TestResults> {
    log.info('Executing tests...');
    
    // Convert to ExecutionConfig which requires credentials object
    // You should dynamically build credentials mapping here
    const executionConfig: ExecutionConfig = {
      ...this.config.execution,
      environment: this.config.execution?.environment ?? ('staging' as any),
      credentials: {}, // Need logic to map requiredEnvVars to CredentialManager/Secrets
      timeoutSeconds: this.config.execution?.timeoutSeconds ?? 300,
      retryCount: this.config.execution?.retryCount ?? 0,
      retryBackoffSeconds: this.config.execution?.retryBackoffSeconds ?? [1, 2, 4],
      allowDestructiveOps: this.config.execution?.allowDestructiveOps ?? false,
    };

    return await this.testExecutor.executeTests(_generatedTests, executionConfig);
  }

  /**
   * Report results to Jira and SCM
   * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
   */
  private async reportResults(
    _task: JiraTask,
    _testResults: TestResults,
    _generatedTests: GeneratedTests,
    _repository: RepositoryInfo
  ): Promise<void> {
    log.info(`Reporting test results for task ${_task.key}...`);
    
    // Post to Jira
    await this.testReporter.reportToJira(_task.key, _testResults);
    
    // Update issue state
    await this.testReporter.updateTaskStatus(_task.key, _testResults);

    // Commit to SCM if commit config is provided and there are test files
    if (this.config.commit && _generatedTests.testFiles.length > 0) {
      await this.testReporter.commitToScm(
        _repository, 
        _generatedTests.testFiles, 
        _testResults, 
        this.config.commit as CommitConfig, 
        _task.key
      );
    }
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
