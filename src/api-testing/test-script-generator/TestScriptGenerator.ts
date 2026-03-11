/**
 * Test Script Generator Module
 * AI-powered test script generation for API endpoints
 * Feature: api-endpoint-testing-transformation
 */

import type { Config } from '../../config.js';
import type { AiProvider } from '../../ai/provider.js';
import { createAiProvider } from '../../ai/index.js';
import type {
  TestContext,
  EndpointSpec,
  GeneratedTests,
  StructuredPrompt,
  StructuredResponse,
  FileContent,
} from '../models/types.js';
import { TestFramework, Environment, AuthType } from '../models/types.js';
import type { TestPlan } from '../strategy/TestStrategyManager.js';
import { createLogger } from '../../logger.js';
import { CredentialManager } from '../credential-manager/index.js';
import {
  getFrameworkTemplate,
  getFrameworkSetupCommands,
  getFrameworkRunCommand,
} from './templates.js';

const logger = createLogger('test-script-generator');

/**
 * TestScriptGenerator class
 * Generates comprehensive API test scripts using AI
 */
export class TestScriptGenerator {
  private aiProvider: AiProvider;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.aiProvider = createAiProvider(config);
  }

  /**
   * Select appropriate test framework
   * Requirements: 6.4, 6.5
   * 
   * Priority:
   * 1. Explicit framework from task description
   * 2. Detected framework from repository
   * 3. Default to jest+supertest
   */
  selectFramework(
    context: TestContext,
    explicitFramework?: TestFramework
  ): TestFramework {
    // Use explicit framework if provided
    if (explicitFramework) {
      logger.info(`Using explicit framework: ${explicitFramework}`);
      return explicitFramework;
    }

    // Use detected framework from context
    if (context.detectedFramework) {
      logger.info(`Using detected framework: ${context.detectedFramework}`);
      return context.detectedFramework;
    }

    // Default to jest+supertest for TypeScript/Node.js projects
    logger.info('No framework specified, defaulting to jest+supertest');
    return TestFramework.JEST_SUPERTEST;
  }

  /**
   * Parse framework from task description
   * Requirements: 6.4
   */
  parseFrameworkFromDescription(description: string): TestFramework | undefined {
    const lowerDesc = description.toLowerCase();

    // Check for explicit framework mentions
    if (lowerDesc.includes('jest') && lowerDesc.includes('supertest')) {
      return TestFramework.JEST_SUPERTEST;
    }
    if (lowerDesc.includes('pytest') && lowerDesc.includes('httpx')) {
      return TestFramework.PYTEST_HTTPX;
    }
    if (lowerDesc.includes('pytest') && lowerDesc.includes('requests')) {
      return TestFramework.PYTEST_REQUESTS;
    }
    if (lowerDesc.includes('postman') || lowerDesc.includes('newman')) {
      return TestFramework.POSTMAN_NEWMAN;
    }

    // Check for language-based hints
    if (lowerDesc.includes('python')) {
      return TestFramework.PYTEST_REQUESTS;
    }
    if (lowerDesc.includes('typescript') || lowerDesc.includes('node')) {
      return TestFramework.JEST_SUPERTEST;
    }

    return undefined;
  }

  /**
   * Generate test scripts for given endpoints using AI
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.4, 7.7, 12.1, 12.4
   */
  async generateTests(
    context: TestContext,
    testPlan: TestPlan,
    framework: TestFramework,
    labels?: string[]
  ): Promise<GeneratedTests> {
    logger.info(`Generating tests for ${testPlan.targetEndpoints.length} endpoints using ${framework}`);

    // Build structured prompt for AI
    const prompt = this.buildPrompt(context, testPlan, framework, labels);

    // Call AI provider with the prompt
    const aiResponse = await this.callAiProvider(prompt, labels);

    // Parse AI response into structured format
    const structuredResponse = this.parseAiResponse(aiResponse, framework);

    // Convert to GeneratedTests format
    const generatedTests: GeneratedTests = {
      testFiles: structuredResponse.testFiles,
      framework,
      requiredEnvVars: structuredResponse.executionHints.requiredEnvVars,
      setupCommands: structuredResponse.executionHints.setupCommands,
      runCommand: structuredResponse.executionHints.runCommand,
      warnings: structuredResponse.warnings,
    };

    logger.info(
      `Generated ${generatedTests.testFiles.length} test files with ${generatedTests.testFiles.reduce((sum, f) => sum + f.testCount, 0)} total tests`
    );

    return generatedTests;
  }

  /**
   * Build structured prompt for AI test generation
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 12.1, 12.4
   */
  buildPrompt(
    context: TestContext,
    testPlan: TestPlan,
    framework: TestFramework,
    labels?: string[]
  ): StructuredPrompt {
    // Determine environment from config or default to staging
    const envStr = process.env.ENVIRONMENT || 'staging';
    const environment = envStr as Environment;

    // Check if performance/load testing is requested
    const includePerformance = this.isPerformanceTestRequested(context, labels);
    const includeLoadTests = this.isLoadTestRequested(labels);

    logger.info(`Performance testing: ${includePerformance}, Load testing: ${includeLoadTests}`);

    // Parse custom scenarios from documentation if available
    const customScenarios: string[] = [];
    if (context.documentation && context.documentation.length > 0) {
      for (const doc of context.documentation) {
        customScenarios.push(...this.parseCustomScenarios(doc.content));
      }
    }

    // Add custom scenarios to endpoints that don't already have them
    const enrichedEndpoints = testPlan.targetEndpoints.map((endpoint) => {
      if (customScenarios.length > 0 && endpoint.testScenarios.length === 0) {
        return {
          ...endpoint,
          testScenarios: [...endpoint.testScenarios, ...customScenarios],
        };
      }
      return endpoint;
    });

    // Build structured prompt
    const prompt: StructuredPrompt = {
      task: 'generate_api_tests',
      framework,
      endpoints: enrichedEndpoints,
      context: {
        existingTests: this.formatExistingTests(context.existingTests),
        apiSpec: this.formatApiSpecs(context.apiSpecifications),
        documentation: this.formatDocumentation(context.documentation),
      },
      environment,
      constraints: {
        allowedTestPaths: ['tests/api/', '__tests__/api/', 'test/api/'],
        forbiddenOperations: this.getForbiddenOperations(envStr),
        requiredValidations: ['status_code', 'response_schema'],
        globalCoverageRequirements: testPlan.globalCoverageRequirements,
      },
      testRules: {
        includeSuccessCases: testPlan.strategyConstraints.requireNegativeTests ? true : true, // Usually always true
        includeErrorCases: testPlan.strategyConstraints.requireNegativeTests,
        includeAuthTests: testPlan.strategyConstraints.requireAuthTests,
        includeValidationTests: testPlan.strategyConstraints.requireContractValidation,
      },
    };

    return prompt;
  }

  /**
   * Parse AI response into structured format
   * Requirements: 2.1
   */
  parseAiResponse(response: string, framework?: TestFramework): StructuredResponse {
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1]! : response;

      const parsed = JSON.parse(jsonStr.trim()) as Record<string, unknown>;

      // Validate required fields
      if (!parsed.summary || !Array.isArray(parsed.testFiles)) {
        throw new Error('Invalid AI response: missing required fields');
      }

      // Use framework-specific defaults if not provided
      const executionHints = parsed.executionHints as Record<string, unknown> | undefined;
      const setupCommands = (executionHints?.setupCommands as string[]) || 
        (framework ? getFrameworkSetupCommands(framework) : ['npm install']);
      const runCommand = (executionHints?.runCommand as string) || 
        (framework ? getFrameworkRunCommand(framework) : this.getDefaultRunCommand((parsed.testFiles as Array<Record<string, unknown>>)[0]?.path as string));

      // Requirement 7.1, 7.4: Validate no hardcoded credentials in generated tests
      const testFiles = (parsed.testFiles as Array<Record<string, unknown>>).map((tf) => {
        const testFile = {
          path: tf.path as string,
          content: tf.content as string,
          testCount: (tf.testCount as number) || 0,
          coveredEndpoints: (tf.coveredEndpoints as string[]) || [],
        };
        
        // Validate no hardcoded credentials
        const validation = CredentialManager.validateNoHardcodedCredentials(testFile.content);
        if (!validation.valid) {
          logger.warn(`Generated test file ${testFile.path} contains potential hardcoded credentials`, {
            issues: validation.issues,
          });
          // Log warning but don't fail - AI might have used acceptable patterns
        }
        
        return testFile;
      });

      return {
        summary: parsed.summary as string,
        testFiles,
        executionHints: {
          requiredEnvVars: (executionHints?.requiredEnvVars as string[]) || [],
          setupCommands,
          runCommand,
        },
        warnings: (parsed.warnings as string[]) || [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to parse AI response', { error: errorMessage });
      throw new Error(`Failed to parse AI response: ${errorMessage}`, { cause: error });
    }
  }

  /**
   * Call AI provider with structured prompt
   */
  private async callAiProvider(prompt: StructuredPrompt, labels?: string[]): Promise<string> {
    // Convert structured prompt to text format for AI
    const promptText = this.convertPromptToText(prompt, labels);

    // Use the AI provider's analyze method
    // Note: We're adapting the existing AI provider interface
    const analysis = await this.aiProvider.analyze({
      issue: {
        key: 'API-TEST',
        summary: 'Generate API test scripts',
        description: promptText,
        issueType: 'Task',
        status: 'In Progress',
        assignee: 'ai-bot',
        repository: null,
      },
      repo: {
        name: prompt.context.apiSpec ? 'api-repository' : 'unknown',
        defaultBranch: 'main',
      },
      sourceFiles: [],
      testFiles: [],
    });

    // Return the plan which contains the AI's response
    return analysis.plan || analysis.summary;
  }

  /**
   * Generate performance test scenarios
   * Requirements: 12.1, 12.4
   */
  private generatePerformanceScenarios(
    endpoint: EndpointSpec,
    includeLoadTests: boolean = false
  ): string[] {
    const scenarios: string[] = [];

    // Response time measurement
    scenarios.push('performance_response_time');

    // Performance threshold validation
    if (endpoint.performanceThresholdMs) {
      scenarios.push(`performance_threshold_${endpoint.performanceThresholdMs}ms`);
    }

    // Load test scenarios (concurrent requests)
    if (includeLoadTests) {
      scenarios.push('load_test_10_concurrent');
      scenarios.push('load_test_50_concurrent');
      scenarios.push('load_test_throughput');
    }

    return scenarios;
  }

  /**
   * Check if performance testing is requested
   */
  private isPerformanceTestRequested(context: TestContext, labels?: string[]): boolean {
    // Check labels
    if (labels && (labels.includes('performance-test') || labels.includes('load-test'))) {
      return true;
    }

    // Check documentation for performance keywords
    if (context.documentation) {
      for (const doc of context.documentation) {
        const content = doc.content.toLowerCase();
        if (content.includes('performance') || content.includes('load test') || content.includes('response time')) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if load testing is requested
   */
  private isLoadTestRequested(labels?: string[]): boolean {
    return labels ? labels.includes('load-test') : false;
  }

  /**
   * Parse custom test scenarios from task description
   * Requirements: 2.7
   */
  private parseCustomScenarios(taskDescription: string): string[] {
    const customScenarios: string[] = [];

    // Look for custom scenario markers in task description
    const scenarioPatterns = [
      /test scenario[s]?:\s*(.+)/gi,
      /custom scenario[s]?:\s*(.+)/gi,
      /additional test[s]?:\s*(.+)/gi,
      /special case[s]?:\s*(.+)/gi,
    ];

    for (const pattern of scenarioPatterns) {
      const matches = taskDescription.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          // Split by comma, semicolon, or newline
          const scenarios = match[1].split(/[,;\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
          customScenarios.push(...scenarios);
        }
      }
    }

    return customScenarios;
  }

  /**
   * Generate authentication configuration for tests
   * Requirements: 2.4, 7.4, 7.7
   */
  private generateAuthConfig(endpoint: EndpointSpec): string {
    if (!endpoint.authType || endpoint.authType === AuthType.NONE) {
      return '';
    }

    let authConfig = '\n## Authentication Configuration:\n\n';

    const authType = endpoint.authType;
    
    // Requirement 7.4: Use CredentialManager to get environment variable placeholders
    const tsPlaceholder = CredentialManager.getEnvVarPlaceholder(authType, 'typescript');
    const pyPlaceholder = CredentialManager.getEnvVarPlaceholder(authType, 'python');
    
    if (authType === AuthType.BEARER) {
      authConfig += `- Type: Bearer Token\n`;
      authConfig += `- Environment Variable: \${API_TOKEN} or \${BEARER_TOKEN}\n`;
      authConfig += `- TypeScript: ${tsPlaceholder}\n`;
      authConfig += `- Python: ${pyPlaceholder}\n`;
      authConfig += `- Header: Authorization: Bearer \${API_TOKEN}\n`;
    } else if (authType === AuthType.BASIC) {
      authConfig += `- Type: Basic Authentication\n`;
      authConfig += `- Environment Variables: \${API_USERNAME}, \${API_PASSWORD}\n`;
      authConfig += `- TypeScript: process.env.API_USERNAME, process.env.API_PASSWORD\n`;
      authConfig += `- Python: os.environ.get('API_USERNAME'), os.environ.get('API_PASSWORD')\n`;
      authConfig += `- Header: Authorization: Basic base64(\${API_USERNAME}:\${API_PASSWORD})\n`;
    } else if (authType === AuthType.API_KEY) {
      authConfig += `- Type: API Key\n`;
      authConfig += `- Environment Variable: \${API_KEY}\n`;
      authConfig += `- TypeScript: ${tsPlaceholder}\n`;
      authConfig += `- Python: ${pyPlaceholder}\n`;
      authConfig += `- Header: X-API-Key: \${API_KEY} (or as specified in endpoint headers)\n`;
    } else if (authType === AuthType.OAUTH) {
      authConfig += `- Type: OAuth 2.0\n`;
      authConfig += `- Environment Variables: \${OAUTH_CLIENT_ID}, \${OAUTH_CLIENT_SECRET}, \${OAUTH_TOKEN_URL}\n`;
      authConfig += `- TypeScript: process.env.OAUTH_CLIENT_ID, process.env.OAUTH_CLIENT_SECRET\n`;
      authConfig += `- Python: os.environ.get('OAUTH_CLIENT_ID'), os.environ.get('OAUTH_CLIENT_SECRET')\n`;
      authConfig += `- Flow: Client Credentials or Authorization Code\n`;
      authConfig += `- Token retrieval should be done in test setup\n`;
    } else {
      authConfig += `- Type: ${String(authType)}\n`;
      authConfig += `- Use appropriate environment variables for credentials\n`;
    }

    authConfig += `\nIMPORTANT: Never hardcode credentials. Always use environment variable placeholders.\n`;
    authConfig += `CRITICAL: Use CredentialManager.getEnvVarPlaceholder() to generate correct placeholders.\n`;

    return authConfig;
  }

  /**
   * Generate comprehensive test scenarios for an endpoint
   * Requirements: 2.2, 2.3, 2.5, 2.6, 12.1, 12.4
   */
  private generateTestScenarios(
    endpoint: EndpointSpec,
    includePerformance: boolean = false,
    includeLoadTests: boolean = false
  ): string[] {
    const scenarios: string[] = [];

    // Success scenarios (200/201)
    if (endpoint.expectedStatus >= 200 && endpoint.expectedStatus < 300) {
      scenarios.push(`success_${endpoint.expectedStatus}`);
    }

    // Error scenarios
    scenarios.push('error_400_bad_request');
    scenarios.push('error_401_unauthorized');
    scenarios.push('error_404_not_found');
    scenarios.push('error_500_internal_server_error');

    // Request validation scenarios
    if (endpoint.requestBody) {
      scenarios.push('validation_missing_required_fields');
      scenarios.push('validation_invalid_data_types');
    }

    // Response validation scenarios
    if (endpoint.expectedResponseSchema) {
      scenarios.push('validation_response_schema');
      scenarios.push('validation_response_data_types');
    }

    // Performance scenarios
    if (includePerformance) {
      scenarios.push(...this.generatePerformanceScenarios(endpoint, includeLoadTests));
    }

    // Add custom scenarios from endpoint spec
    if (endpoint.testScenarios && endpoint.testScenarios.length > 0) {
      scenarios.push(...endpoint.testScenarios);
    }

    return scenarios;
  }

  /**
   * Convert structured prompt to text format for AI
   */
  private convertPromptToText(prompt: StructuredPrompt, labels?: string[]): string {
    let text = `# API Test Generation Task\n\n`;
    text += `## Framework: ${prompt.framework}\n\n`;
    text += `## Environment: ${prompt.environment}\n\n`;

    // Check for performance/load testing
    const includePerformance = labels?.includes('performance-test') || false;
    const includeLoadTests = labels?.includes('load-test') || false;

    if (includePerformance) {
      text += `## Performance Testing: ENABLED\n`;
      text += `- Measure response time for all requests\n`;
      text += `- Validate against performance thresholds if specified\n`;
      if (includeLoadTests) {
        text += `- Include load test scenarios with concurrent requests\n`;
      }
      text += `\n`;
    }

    text += `## Endpoints to Test:\n\n`;
    for (const endpoint of prompt.endpoints) {
      text += `### ${endpoint.method} ${endpoint.url}\n`;
      text += `- Expected Status: ${endpoint.expectedStatus}\n`;
      if (endpoint.authType) {
        text += `- Authentication: ${endpoint.authType}\n`;
      }
      if (endpoint.performanceThresholdMs) {
        text += `- Performance Threshold: ${endpoint.performanceThresholdMs}ms\n`;
      }
      
      // Generate comprehensive test scenarios
      const scenarios = this.generateTestScenarios(endpoint, includePerformance, includeLoadTests);
      text += `- Test Scenarios: ${scenarios.join(', ')}\n`;
      
      if (Object.keys(endpoint.headers).length > 0) {
        text += `- Headers: ${JSON.stringify(endpoint.headers, null, 2)}\n`;
      }
      if (endpoint.requestBody) {
        text += `- Request Body: ${JSON.stringify(endpoint.requestBody, null, 2)}\n`;
      }
      if (endpoint.expectedResponseSchema) {
        text += `- Expected Response Schema: ${JSON.stringify(endpoint.expectedResponseSchema, null, 2)}\n`;
      }
      
      // Add authentication configuration
      const authConfig = this.generateAuthConfig(endpoint);
      if (authConfig) {
        text += authConfig;
      }
      
      text += `\n`;
    }

    if (prompt.context.apiSpec) {
      text += `## API Specification:\n\n${prompt.context.apiSpec}\n\n`;
    }

    if (prompt.context.existingTests) {
      text += `## Existing Tests (for reference):\n\n${prompt.context.existingTests}\n\n`;
    }

    if (prompt.context.documentation) {
      text += `## Documentation:\n\n${prompt.context.documentation}\n\n`;
    }

    text += `## Test Generation Rules:\n\n`;
    text += `- Include success cases (200/201): ${prompt.testRules.includeSuccessCases}\n`;
    text += `- Include error cases (400/401/404/500): ${prompt.testRules.includeErrorCases}\n`;
    text += `- Include authentication tests: ${prompt.testRules.includeAuthTests}\n`;
    text += `- Include validation tests: ${prompt.testRules.includeValidationTests}\n\n`;

    text += `## Constraints:\n\n`;
    text += `- Allowed test paths: ${prompt.constraints.allowedTestPaths.join(', ')}\n`;
    text += `- Forbidden operations: ${prompt.constraints.forbiddenOperations.join(', ')}\n`;
    text += `- Required validations: ${prompt.constraints.requiredValidations.join(', ')}\n`;
    
    if (prompt.constraints.globalCoverageRequirements && prompt.constraints.globalCoverageRequirements.length > 0) {
      text += `\n### Global Coverage Requirements:\n`;
      for (const req of prompt.constraints.globalCoverageRequirements) {
        text += `- ${req}\n`;
      }
    }
    text += `\n`;

    text += `## Instructions:\n\n`;
    text += `Generate comprehensive test scripts for the above endpoints using the ${prompt.framework} framework.\n`;
    text += `Include:\n`;
    text += `1. Success test cases (200/201 responses)\n`;
    text += `2. Error test cases (400, 401, 404, 500 responses)\n`;
    text += `3. Authentication handling with environment variable placeholders\n`;
    text += `4. Request and response validation\n`;
    text += `5. Performance measurement (response time)\n`;
    text += `6. Custom test scenarios if specified\n\n`;

    // Add framework-specific template
    text += getFrameworkTemplate(prompt.framework);
    text += `\n`;

    text += `Respond with a JSON object in this format:\n`;
    text += `\`\`\`json\n`;
    text += `{\n`;
    text += `  "summary": "Brief summary of generated tests",\n`;
    text += `  "testFiles": [\n`;
    text += `    {\n`;
    text += `      "path": "tests/api/test_users.ts",\n`;
    text += `      "content": "// Complete test file content",\n`;
    text += `      "testCount": 8,\n`;
    text += `      "coveredEndpoints": ["GET /api/users", "POST /api/users"]\n`;
    text += `    }\n`;
    text += `  ],\n`;
    text += `  "executionHints": {\n`;
    text += `    "requiredEnvVars": ["API_BASE_URL", "API_TOKEN"],\n`;
    text += `    "setupCommands": ["npm install"],\n`;
    text += `    "runCommand": "npm test"\n`;
    text += `  },\n`;
    text += `  "warnings": []\n`;
    text += `}\n`;
    text += `\`\`\`\n`;

    return text;
  }

  /**
   * Format existing tests for context
   */
  private formatExistingTests(tests: FileContent[]): string {
    if (!tests || tests.length === 0) {
      return 'No existing tests found.';
    }

    let formatted = '';
    for (const test of tests.slice(0, 3)) {
      // Limit to 3 examples
      formatted += `File: ${test.path}\n`;
      formatted += `\`\`\`\n${test.content.substring(0, 500)}...\n\`\`\`\n\n`;
    }
    return formatted;
  }

  /**
   * Format API specifications for context
   */
  private formatApiSpecs(specs: FileContent[]): string {
    if (!specs || specs.length === 0) {
      return 'No API specifications found.';
    }

    let formatted = '';
    for (const spec of specs) {
      formatted += `File: ${spec.path}\n`;
      formatted += `\`\`\`\n${spec.content.substring(0, 1000)}...\n\`\`\`\n\n`;
    }
    return formatted;
  }

  /**
   * Format documentation for context
   */
  private formatDocumentation(docs: FileContent[]): string {
    if (!docs || docs.length === 0) {
      return 'No documentation found.';
    }

    let formatted = '';
    for (const doc of docs.slice(0, 2)) {
      // Limit to 2 docs
      formatted += `File: ${doc.path}\n`;
      formatted += `\`\`\`\n${doc.content.substring(0, 500)}...\n\`\`\`\n\n`;
    }
    return formatted;
  }

  /**
   * Get forbidden operations based on environment
   */
  private getForbiddenOperations(environment: string): string[] {
    if (environment === 'production') {
      return ['DELETE', 'PUT /admin', 'POST /admin', 'destructive operations'];
    }
    return [];
  }

  /**
   * Get default run command based on test file path
   */
  private getDefaultRunCommand(testFilePath?: string): string {
    if (!testFilePath) {
      return 'npm test';
    }

    if (testFilePath.endsWith('.py')) {
      return 'pytest tests/api/ -v';
    } else if (testFilePath.endsWith('.ts') || testFilePath.endsWith('.js')) {
      return 'npm test';
    } else if (testFilePath.endsWith('.json')) {
      return 'newman run tests/api/';
    }

    return 'npm test';
  }
}
