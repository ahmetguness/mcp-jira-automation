/**
 * EndpointParser - Extracts API endpoint specifications from Jira task descriptions
 * Feature: api-endpoint-testing-transformation
 * Requirements: 1.2, 1.3
 */

import type { EndpointSpec, ValidationResult, JiraTask } from '../models/types.js';
import { HttpMethod, AuthType } from '../models/enums.js';
import * as yaml from 'yaml';

/**
 * Parses API endpoint specifications from multiple formats:
 * - JSON blocks
 * - YAML blocks
 * - Markdown tables
 */
export class EndpointParser {
  /**
   * Parse endpoint specifications from task description
   * Supports JSON, YAML, and Markdown table formats
   * 
   * @param taskDescription - The Jira task description containing endpoint specs
   * @returns Array of parsed endpoint specifications
   */
  parseEndpoints(taskDescription: string): EndpointSpec[] {
    const endpoints: EndpointSpec[] = [];

    // Try parsing JSON format
    const jsonEndpoints = this.parseJsonFormat(taskDescription);
    endpoints.push(...jsonEndpoints);

    // Try parsing YAML format
    const yamlEndpoints = this.parseYamlFormat(taskDescription);
    endpoints.push(...yamlEndpoints);

    // Try parsing Markdown table format
    const markdownEndpoints = this.parseMarkdownTableFormat(taskDescription);
    endpoints.push(...markdownEndpoints);

    return endpoints;
  }

  /**
   * Parse JSON format endpoint specifications
   * Looks for JSON code blocks in the description
   */
  private parseJsonFormat(description: string): EndpointSpec[] {
    const endpoints: EndpointSpec[] = [];
    
    // Match JSON code blocks: ```json ... ``` or ``` ... ```
    const jsonBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
    let match;

    while ((match = jsonBlockRegex.exec(description)) !== null) {
      try {
        const jsonContent = match[1]?.trim();
        if (!jsonContent) continue;
        
        const parsed: unknown = JSON.parse(jsonContent);
        
        // Handle both single object and array of objects
        const items = Array.isArray(parsed) ? parsed : [parsed];
        
        for (const item of items) {
          if (this.isValidEndpointObject(item)) {
            const endpoint = this.convertToEndpointSpec(item);
            if (endpoint) {
              endpoints.push(endpoint);
            }
          }
        }
      } catch {
        // Skip invalid JSON blocks
        continue;
      }
    }

    return endpoints;
  }

  /**
   * Parse YAML format endpoint specifications
   * Looks for YAML code blocks in the description
   */
  private parseYamlFormat(description: string): EndpointSpec[] {
    const endpoints: EndpointSpec[] = [];
    
    // Match YAML code blocks: ```yaml ... ``` or ```yml ... ```
    const yamlBlockRegex = /```(?:yaml|yml)\s*\n([\s\S]*?)\n```/g;
    let match;

    while ((match = yamlBlockRegex.exec(description)) !== null) {
      try {
        const yamlContent = match[1]?.trim();
        if (!yamlContent) continue;
        
        const parsed: unknown = yaml.parse(yamlContent);
        
        // Handle both single object and array of objects
        const items = Array.isArray(parsed) ? parsed : [parsed];
        
        for (const item of items) {
          if (this.isValidEndpointObject(item)) {
            const endpoint = this.convertToEndpointSpec(item);
            if (endpoint) {
              endpoints.push(endpoint);
            }
          }
        }
      } catch {
        // Skip invalid YAML blocks
        continue;
      }
    }

    return endpoints;
  }

  /**
   * Parse Markdown table format endpoint specifications
   * Looks for tables with endpoint information
   */
  private parseMarkdownTableFormat(description: string): EndpointSpec[] {
    const endpoints: EndpointSpec[] = [];
    
    // Match markdown tables
    const lines = description.split('\n');
    let inTable = false;
    let headers: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      const trimmedLine = line.trim();
      
      // Check if this is a table header
      if (trimmedLine.includes('|') && !inTable) {
        headers = trimmedLine.split('|').map(h => h.trim().toLowerCase()).filter(h => h);
        
        // Check if next line is separator (|---|---|)
        const nextLine = lines[i + 1];
        if (i + 1 < lines.length && nextLine && nextLine.includes('---')) {
          inTable = true;
          i++; // Skip separator line
          continue;
        }
      }
      
      // Parse table rows
      if (inTable && trimmedLine.includes('|')) {
        const values = trimmedLine.split('|').map(v => v.trim()).filter(v => v);
        
        if (values.length === headers.length && headers.length > 0) {
          const rowData: Record<string, string> = {};
          headers.forEach((header, index) => {
            const value = values[index];
            if (value !== undefined) {
              rowData[header] = value;
            }
          });
          
          const endpoint = this.convertTableRowToEndpointSpec(rowData);
          if (endpoint) {
            endpoints.push(endpoint);
          }
        }
      } else if (inTable && !trimmedLine.includes('|') && trimmedLine !== '') {
        // End of table (non-empty line without |)
        inTable = false;
        headers = [];
      }
    }

    return endpoints;
  }

  /**
   * Check if an object has the basic structure of an endpoint specification
   */
  private isValidEndpointObject(obj: unknown): obj is Record<string, unknown> {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    
    const record = obj as Record<string, unknown>;
    const hasUrl = 'url' in record || 'path' in record || 'endpoint' in record;
    const hasMethod = 'method' in record || 'httpMethod' in record || 'verb' in record;
    
    return hasUrl && hasMethod;
  }

  /**
   * Convert a parsed object to EndpointSpec
   */
  private convertToEndpointSpec(obj: Record<string, unknown>): EndpointSpec | null {
    try {
      // Extract URL (support multiple field names)
      const url = (obj.url || obj.path || obj.endpoint || '') as string;
      
      // Extract HTTP method (support multiple field names)
      const methodStr = ((obj.method || obj.httpMethod || obj.verb || 'GET') as string).toUpperCase();
      const method = this.parseHttpMethod(methodStr);
      
      // Extract headers
      const headers = (obj.headers || obj.header || {}) as Record<string, unknown>;
      
      // Extract request body
      const requestBody = (obj.requestBody || obj.body || obj.request || obj.data) as Record<string, unknown> | undefined;
      
      // Extract expected status
      const expectedStatus = (obj.expectedStatus || obj.status || obj.expectedStatusCode || 200) as number;
      
      // Extract expected response schema
      const expectedResponseSchema = (obj.expectedResponseSchema || obj.responseSchema || obj.schema) as Record<string, unknown> | undefined;
      
      // Extract auth type
      const authType = (obj.authType || obj.auth || obj.authentication) as string | undefined;
      
      // Extract test scenarios
      const testScenarios = (obj.testScenarios || obj.scenarios || obj.tests || ['success']) as string | string[];
      
      // Extract performance threshold
      const performanceThresholdMs = (obj.performanceThresholdMs || obj.performanceThreshold || obj.timeout) as number | undefined;

      return {
        url,
        method,
        headers: this.normalizeHeaders(headers),
        requestBody: requestBody ? this.normalizeRequestBody(requestBody) : undefined,
        expectedStatus: Number(expectedStatus),
        expectedResponseSchema: expectedResponseSchema || undefined,
        authType: authType ? this.parseAuthType(authType) : undefined,
        testScenarios: Array.isArray(testScenarios) ? testScenarios : [testScenarios],
        performanceThresholdMs: performanceThresholdMs ? Number(performanceThresholdMs) : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Convert a markdown table row to EndpointSpec
   */
  private convertTableRowToEndpointSpec(row: Record<string, string>): EndpointSpec | null {
    try {
      // Extract URL from various possible column names
      const url = row.url || row.path || row.endpoint || row.uri || '';
      
      // Extract HTTP method (handle spaces and underscores)
      const methodStr = (
        row.method || 
        row['http method'] || 
        row.http_method || 
        row['http_method'] ||
        row.verb || 
        row.type || 
        'GET'
      ).toUpperCase();
      const method = this.parseHttpMethod(methodStr);
      
      // Extract headers (may be JSON string)
      let headers: Record<string, string> = {};
      const headersField = row.headers || row.header;
      if (headersField) {
        try {
          headers = JSON.parse(headersField) as Record<string, string>;
        } catch {
          // If not JSON, treat as single header
          headers = { 'Content-Type': headersField };
        }
      }
      
      // Extract request body (may be JSON string)
      let requestBody: Record<string, unknown> | undefined;
      const bodyField = row.body || row.request || row.request_body || row.requestbody;
      if (bodyField) {
        try {
          requestBody = JSON.parse(bodyField) as Record<string, unknown>;
        } catch {
          // If not JSON, skip
          requestBody = undefined;
        }
      }
      
      // Extract expected status (handle spaces and underscores)
      const expectedStatus = Number(
        row.status || 
        row['expected status'] ||
        row.expected_status || 
        row['expected_status'] ||
        row.expectedstatus || 
        200
      );
      
      // Extract auth type
      const authType = row.auth || row.auth_type || row.authtype || row.authentication;
      
      // Extract test scenarios
      let testScenarios = ['success'];
      const scenariosField = row.scenarios || row.test_scenarios || row.testscenarios || row.tests;
      if (scenariosField) {
        testScenarios = scenariosField.split(',').map(s => s.trim());
      }

      return {
        url,
        method,
        headers: this.normalizeHeaders(headers),
        requestBody,
        expectedStatus,
        authType: authType ? this.parseAuthType(authType) : undefined,
        testScenarios,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse HTTP method string to enum
   */
  private parseHttpMethod(method: string): HttpMethod {
    const normalized = method.toUpperCase();
    if (Object.values(HttpMethod).includes(normalized as HttpMethod)) {
      return normalized as HttpMethod;
    }
    return HttpMethod.GET; // Default fallback
  }

  /**
   * Parse auth type string to enum
   */
  private parseAuthType(authType: string): AuthType {
    const normalized = authType.toLowerCase();
    
    // Map common variations to AuthType enum
    const authTypeMap: Record<string, AuthType> = {
      'bearer': AuthType.BEARER,
      'bearer_token': AuthType.BEARER,
      'token': AuthType.BEARER,
      'basic': AuthType.BASIC,
      'basic_auth': AuthType.BASIC,
      'api_key': AuthType.API_KEY,
      'apikey': AuthType.API_KEY,
      'oauth': AuthType.OAUTH,
      'oauth2': AuthType.OAUTH,
      'none': AuthType.NONE,
      'no_auth': AuthType.NONE,
    };
    
    return authTypeMap[normalized] || AuthType.NONE;
  }

  /**
   * Normalize headers to Record<string, string>
   */
  private normalizeHeaders(headers: unknown): Record<string, string> {
    if (!headers || typeof headers !== 'object') {
      return {};
    }
    
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[key] = String(value);
    }
    return normalized;
  }

  /**
   * Normalize request body to Record<string, unknown>
   */
  private normalizeRequestBody(body: unknown): Record<string, unknown> | undefined {
    if (!body) {
      return undefined;
    }
    
    if (typeof body === 'string') {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
    
    if (typeof body === 'object') {
      return body as Record<string, unknown>;
    }
    
    return undefined;
  }

  /**
   * Validate endpoint specification
   * Checks that all required fields are present and valid
   * 
   * @param spec - The endpoint specification to validate
   * @returns Validation result with errors and warnings
   */
  validateEndpointSpec(spec: EndpointSpec): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate URL
    if (!spec.url || spec.url.trim() === '') {
      errors.push('URL is required');
    } else {
      // Check if URL is valid format
      if (!this.isValidUrl(spec.url)) {
        errors.push(`Invalid URL format: ${spec.url}`);
      }
    }

    // Validate HTTP method
    if (!spec.method) {
      errors.push('HTTP method is required');
    } else if (!Object.values(HttpMethod).includes(spec.method)) {
      errors.push(`Invalid HTTP method: ${spec.method}`);
    }

    // Validate headers
    if (spec.headers && typeof spec.headers !== 'object') {
      errors.push('Headers must be a key-value object');
    }

    // Validate request body
    if (spec.requestBody !== undefined) {
      if (typeof spec.requestBody !== 'object') {
        errors.push('Request body must be a valid object');
      }
      
      // Warn if body is provided for GET/HEAD/DELETE
      if ([HttpMethod.GET, HttpMethod.HEAD, HttpMethod.DELETE].includes(spec.method)) {
        warnings.push(`Request body provided for ${spec.method} method (typically not used)`);
      }
    }

    // Validate expected status
    if (spec.expectedStatus < 100 || spec.expectedStatus > 599) {
      errors.push(`Invalid expected status code: ${spec.expectedStatus}`);
    }

    // Validate test scenarios
    if (!spec.testScenarios || spec.testScenarios.length === 0) {
      warnings.push('No test scenarios specified, using default');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Extract base URL from task or environment
   * 
   * @param task - The Jira task
   * @returns Base URL if found, undefined otherwise
   */
  extractBaseUrl(task: JiraTask): string | undefined {
    // Try to extract from task description
    const baseUrlFromDescription = this.extractBaseUrlFromDescription(task.description);
    if (baseUrlFromDescription) {
      return baseUrlFromDescription;
    }

    // Try to extract from custom fields
    if (task.customFields) {
      const baseUrlField = task.customFields.baseUrl || 
                          task.customFields.base_url || 
                          task.customFields.apiBaseUrl ||
                          task.customFields.api_base_url;
      
      if (baseUrlField && typeof baseUrlField === 'string') {
        return baseUrlField;
      }
    }

    // Try to extract from environment variables
    const envBaseUrl = process.env.API_BASE_URL || process.env.BASE_URL;
    if (envBaseUrl) {
      return envBaseUrl;
    }

    return undefined;
  }

  /**
   * Extract base URL from task description
   */
  private extractBaseUrlFromDescription(description: string): string | undefined {
    // Look for patterns like:
    // - base_url: https://api.example.com
    // - baseUrl: https://api.example.com
    // - Base URL: https://api.example.com
    
    const patterns = [
      /base[_\s-]?url\s*[:=]\s*(https?:\/\/[^\s\n]+)/i,
      /api[_\s-]?base[_\s-]?url\s*[:=]\s*(https?:\/\/[^\s\n]+)/i,
      /endpoint[_\s-]?base\s*[:=]\s*(https?:\/\/[^\s\n]+)/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  /**
   * Check if a string is a valid URL
   */
  private isValidUrl(urlString: string): boolean {
    // Allow both full URLs and paths
    if (urlString.startsWith('/')) {
      return true; // Valid path
    }

    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Format validation errors as a Jira comment
   * Requirements: 1.4 - Generate descriptive error messages for invalid specifications
   * 
   * @param validationResults - Array of validation results for each endpoint
   * @param _taskDescription - The original task description (for context)
   * @returns Formatted error message for Jira comment
   */
  formatErrorCommentForJira(
    validationResults: Array<{ spec?: EndpointSpec; validation: ValidationResult }>,
    _taskDescription: string
  ): string {
    const hasErrors = validationResults.some(r => !r.validation.valid);
    
    if (!hasErrors) {
      return ''; // No errors to report
    }

    const errorSections: string[] = [];
    
    // Header
    errorSections.push('❌ *Invalid Endpoint Specification*\n');
    errorSections.push('The following issues were found in your endpoint specifications:\n');

    // List each endpoint with errors
    validationResults.forEach((result, index) => {
      if (!result.validation.valid) {
        errorSections.push(`\n*Endpoint ${index + 1}:*`);
        
        // Show the URL if available
        if (result.spec?.url) {
          errorSections.push(`- URL: \`${result.spec.url}\``);
        }
        
        // List all errors
        result.validation.errors.forEach(error => {
          errorSections.push(`  • ${error}`);
        });
        
        // List warnings if any
        if (result.validation.warnings.length > 0) {
          errorSections.push('\n  _Warnings:_');
          result.validation.warnings.forEach(warning => {
            errorSections.push(`  ⚠️ ${warning}`);
          });
        }
      }
    });

    // Add examples of correct formats
    errorSections.push('\n\n---\n');
    errorSections.push('*Please provide endpoint specifications in one of these formats:*\n');
    
    // JSON format example
    errorSections.push('\n*JSON Format:*');
    errorSections.push('```json');
    errorSections.push(JSON.stringify({
      url: '/api/users',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      expectedStatus: 200,
      authType: 'bearer',
      testScenarios: ['success', 'unauthorized']
    }, null, 2));
    errorSections.push('```\n');

    // YAML format example
    errorSections.push('*YAML Format:*');
    errorSections.push('```yaml');
    errorSections.push('url: /api/users');
    errorSections.push('method: GET');
    errorSections.push('headers:');
    errorSections.push('  Content-Type: application/json');
    errorSections.push('expectedStatus: 200');
    errorSections.push('authType: bearer');
    errorSections.push('testScenarios:');
    errorSections.push('  - success');
    errorSections.push('  - unauthorized');
    errorSections.push('```\n');

    // Markdown table example
    errorSections.push('*Markdown Table Format:*');
    errorSections.push('```');
    errorSections.push('| URL | Method | Status | Auth |');
    errorSections.push('|-----|--------|--------|------|');
    errorSections.push('| /api/users | GET | 200 | bearer |');
    errorSections.push('```\n');

    // Required fields
    errorSections.push('\n*Required Fields:*');
    errorSections.push('• `url` or `path` - The API endpoint URL (full URL or path)');
    errorSections.push('• `method` - HTTP method (GET, POST, PUT, PATCH, DELETE, etc.)');
    errorSections.push('\n*Optional Fields:*');
    errorSections.push('• `headers` - Request headers as key-value pairs');
    errorSections.push('• `requestBody` or `body` - Request body (for POST/PUT/PATCH)');
    errorSections.push('• `expectedStatus` - Expected HTTP status code (default: 200)');
    errorSections.push('• `authType` - Authentication type (bearer, basic, api_key, oauth, none)');
    errorSections.push('• `testScenarios` - Test scenarios to run (default: [\'success\'])');
    errorSections.push('• `performanceThresholdMs` - Maximum acceptable response time in milliseconds');

    return errorSections.join('\n');
  }

  /**
   * Parse and validate endpoints from task description
   * Returns both parsed endpoints and validation results
   * Requirements: 1.2, 1.3, 1.4
   * 
   * @param taskDescription - The Jira task description
   * @returns Object containing endpoints and validation results
   */
  parseAndValidateEndpoints(taskDescription: string): {
    endpoints: EndpointSpec[];
    validationResults: Array<{ spec: EndpointSpec; validation: ValidationResult }>;
    hasErrors: boolean;
  } {
    const endpoints = this.parseEndpoints(taskDescription);
    const validationResults = endpoints.map(spec => ({
      spec,
      validation: this.validateEndpointSpec(spec)
    }));

    const hasErrors = validationResults.some(r => !r.validation.valid);

    return {
      endpoints: validationResults.filter(r => r.validation.valid).map(r => r.spec),
      validationResults,
      hasErrors
    };
  }
}
