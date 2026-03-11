/**
 * Unit tests for EndpointParser
 * Feature: api-endpoint-testing-transformation
 * Requirements: 1.2, 1.3
 */

import { describe, it, expect } from 'vitest';
import { EndpointParser } from '../../src/api-testing/endpoint-parser/EndpointParser.js';
import { HttpMethod, AuthType } from '../../src/api-testing/models/enums.js';

describe('EndpointParser', () => {
  const parser = new EndpointParser();

  describe('JSON format parsing', () => {
    it('should parse single endpoint from JSON block', () => {
      const description = `
Test this API endpoint:

\`\`\`json
{
  "url": "/api/users",
  "method": "GET",
  "headers": {
    "Content-Type": "application/json"
  },
  "expectedStatus": 200
}
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/users');
      expect(endpoints[0]?.method).toBe(HttpMethod.GET);
      expect(endpoints[0]?.headers['Content-Type']).toBe('application/json');
      expect(endpoints[0]?.expectedStatus).toBe(200);
    });

    it('should parse multiple endpoints from JSON array', () => {
      const description = `
\`\`\`json
[
  {
    "url": "/api/users",
    "method": "GET",
    "expectedStatus": 200
  },
  {
    "url": "/api/users",
    "method": "POST",
    "expectedStatus": 201,
    "requestBody": {
      "name": "John Doe"
    }
  }
]
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(2);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[1]).toBeDefined();
      expect(endpoints[0]?.method).toBe(HttpMethod.GET);
      expect(endpoints[1]?.method).toBe(HttpMethod.POST);
      expect(endpoints[1]?.requestBody).toEqual({ name: 'John Doe' });
    });

    it('should handle JSON with various field name variations', () => {
      const description = `
\`\`\`json
{
  "path": "/api/products",
  "httpMethod": "POST",
  "auth": "bearer",
  "body": {
    "name": "Product"
  }
}
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/products');
      expect(endpoints[0]?.method).toBe(HttpMethod.POST);
      expect(endpoints[0]?.authType).toBe(AuthType.BEARER);
    });
  });

  describe('YAML format parsing', () => {
    it('should parse single endpoint from YAML block', () => {
      const description = `
\`\`\`yaml
url: /api/users
method: GET
headers:
  Content-Type: application/json
expectedStatus: 200
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/users');
      expect(endpoints[0]?.method).toBe(HttpMethod.GET);
      expect(endpoints[0]?.expectedStatus).toBe(200);
    });

    it('should parse multiple endpoints from YAML array', () => {
      const description = `
\`\`\`yml
- url: /api/users
  method: GET
  expectedStatus: 200
- url: /api/users
  method: POST
  expectedStatus: 201
  requestBody:
    name: John Doe
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(2);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[1]).toBeDefined();
      expect(endpoints[0]?.method).toBe(HttpMethod.GET);
      expect(endpoints[1]?.method).toBe(HttpMethod.POST);
    });

    it('should handle YAML with authentication', () => {
      const description = `
\`\`\`yaml
url: https://api.example.com/secure
method: POST
authType: bearer
testScenarios:
  - success
  - unauthorized
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.authType).toBe(AuthType.BEARER);
      expect(endpoints[0]?.testScenarios).toContain('success');
      expect(endpoints[0]?.testScenarios).toContain('unauthorized');
    });
  });

  describe('Markdown table format parsing', () => {
    it('should parse endpoints from markdown table', () => {
      const description = `
Test these endpoints:

| URL | Method | Status | Headers |
|-----|--------|--------|---------|
| /api/users | GET | 200 | {"Content-Type": "application/json"} |
| /api/users | POST | 201 | {"Content-Type": "application/json"} |
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(2);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[1]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/users');
      expect(endpoints[0]?.method).toBe(HttpMethod.GET);
      expect(endpoints[0]?.expectedStatus).toBe(200);
      expect(endpoints[1]?.method).toBe(HttpMethod.POST);
      expect(endpoints[1]?.expectedStatus).toBe(201);
    });

    it('should handle table with various column names', () => {
      const description = `
| Endpoint | HTTP Method | Expected Status | Auth |
|----------|-------------|-----------------|------|
| /api/products | GET | 200 | bearer |
| /api/products | DELETE | 204 | bearer |
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(2);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[1]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/products');
      expect(endpoints[0]?.authType).toBe(AuthType.BEARER);
      expect(endpoints[1]?.method).toBe(HttpMethod.DELETE);
      expect(endpoints[1]?.expectedStatus).toBe(204);
    });

    it('should parse table with test scenarios', () => {
      const description = `
| URL | Method | Scenarios |
|-----|--------|-----------|
| /api/login | POST | success,unauthorized,invalid_credentials |
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.testScenarios).toContain('success');
      expect(endpoints[0]?.testScenarios).toContain('unauthorized');
      expect(endpoints[0]?.testScenarios).toContain('invalid_credentials');
    });
  });

  describe('Mixed format parsing', () => {
    it('should parse endpoints from multiple formats in same description', () => {
      const description = `
First endpoint in JSON:
\`\`\`json
{
  "url": "/api/users",
  "method": "GET"
}
\`\`\`

Second endpoint in YAML:
\`\`\`yaml
url: /api/products
method: POST
\`\`\`

Third endpoint in table:
| URL | Method |
|-----|--------|
| /api/orders | GET |
      `;

      const endpoints = parser.parseEndpoints(description);
      
      expect(endpoints).toHaveLength(3);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[1]).toBeDefined();
      expect(endpoints[2]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/users');
      expect(endpoints[1]?.url).toBe('/api/products');
      expect(endpoints[2]?.url).toBe('/api/orders');
    });
  });

  describe('validateEndpointSpec', () => {
    it('should validate valid endpoint spec', () => {
      const spec = {
        url: '/api/users',
        method: HttpMethod.GET,
        headers: {},
        expectedStatus: 200,
        testScenarios: ['success'],
      };

      const result = parser.validateEndpointSpec(spec);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing URL', () => {
      const spec = {
        url: '',
        method: HttpMethod.GET,
        headers: {},
        expectedStatus: 200,
        testScenarios: ['success'],
      };

      const result = parser.validateEndpointSpec(spec);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URL is required');
    });

    it('should detect invalid URL format', () => {
      const spec = {
        url: 'not-a-valid-url',
        method: HttpMethod.GET,
        headers: {},
        expectedStatus: 200,
        testScenarios: ['success'],
      };

      const result = parser.validateEndpointSpec(spec);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid URL format'))).toBe(true);
    });

    it('should detect invalid status code', () => {
      const spec = {
        url: '/api/users',
        method: HttpMethod.GET,
        headers: {},
        expectedStatus: 999,
        testScenarios: ['success'],
      };

      const result = parser.validateEndpointSpec(spec);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid expected status code'))).toBe(true);
    });

    it('should warn about request body on GET request', () => {
      const spec = {
        url: '/api/users',
        method: HttpMethod.GET,
        headers: {},
        requestBody: { data: 'test' },
        expectedStatus: 200,
        testScenarios: ['success'],
      };

      const result = parser.validateEndpointSpec(spec);
      
      expect(result.warnings.some(w => w.includes('Request body provided for GET'))).toBe(true);
    });
  });

  describe('extractBaseUrl', () => {
    it('should extract base URL from task description', () => {
      const task = {
        key: 'TEST-123',
        summary: 'Test',
        description: 'Base URL: https://api.example.com\n\nTest endpoints...',
        assignee: 'bot',
        status: 'Open',
        projectKey: 'TEST',
        customFields: {},
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const baseUrl = parser.extractBaseUrl(task);
      
      expect(baseUrl).toBe('https://api.example.com');
    });

    it('should extract base URL from custom fields', () => {
      const task = {
        key: 'TEST-123',
        summary: 'Test',
        description: 'Test endpoints...',
        assignee: 'bot',
        status: 'Open',
        projectKey: 'TEST',
        customFields: {
          baseUrl: 'https://api.example.com',
        },
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const baseUrl = parser.extractBaseUrl(task);
      
      expect(baseUrl).toBe('https://api.example.com');
    });

    it('should handle various base URL patterns in description', () => {
      const patterns = [
        'base_url: https://api.example.com',
        'baseUrl: https://api.example.com',
        'api_base_url: https://api.example.com',
        'Base URL = https://api.example.com',
      ];

      for (const pattern of patterns) {
        const task = {
          key: 'TEST-123',
          summary: 'Test',
          description: pattern,
          assignee: 'bot',
          status: 'Open',
          projectKey: 'TEST',
          customFields: {},
          labels: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const baseUrl = parser.extractBaseUrl(task);
        expect(baseUrl).toBe('https://api.example.com');
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty description', () => {
      const endpoints = parser.parseEndpoints('');
      expect(endpoints).toHaveLength(0);
    });

    it('should handle description with no endpoint specs', () => {
      const description = 'This is just a regular task description with no endpoints.';
      const endpoints = parser.parseEndpoints(description);
      expect(endpoints).toHaveLength(0);
    });

    it('should skip invalid JSON blocks', () => {
      const description = `
\`\`\`json
{ invalid json here
\`\`\`

\`\`\`json
{
  "url": "/api/users",
  "method": "GET"
}
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/users');
    });

    it('should skip invalid YAML blocks', () => {
      const description = `
\`\`\`yaml
invalid: yaml: here:
\`\`\`

\`\`\`yaml
url: /api/users
method: GET
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.url).toBe('/api/users');
    });

    it('should handle full URLs', () => {
      const description = `
\`\`\`json
{
  "url": "https://api.example.com/users",
  "method": "GET"
}
\`\`\`
      `;

      const endpoints = parser.parseEndpoints(description);
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toBeDefined();
      expect(endpoints[0]?.url).toBe('https://api.example.com/users');
    });

    it('should handle various HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
      
      for (const method of methods) {
        const description = `
\`\`\`json
{
  "url": "/api/test",
  "method": "${method}"
}
\`\`\`
        `;

        const endpoints = parser.parseEndpoints(description);
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0]).toBeDefined();
        expect(endpoints[0]?.method).toBe(method);
      }
    });

    it('should handle various auth types', () => {
      const authTypes = [
        { input: 'bearer', expected: AuthType.BEARER },
        { input: 'basic', expected: AuthType.BASIC },
        { input: 'api_key', expected: AuthType.API_KEY },
        { input: 'oauth', expected: AuthType.OAUTH },
        { input: 'none', expected: AuthType.NONE },
      ];

      for (const { input, expected } of authTypes) {
        const description = `
\`\`\`json
{
  "url": "/api/test",
  "method": "GET",
  "authType": "${input}"
}
\`\`\`
        `;

        const endpoints = parser.parseEndpoints(description);
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0]).toBeDefined();
        expect(endpoints[0]?.authType).toBe(expected);
      }
    });
  });

  describe('formatErrorCommentForJira', () => {
    it('should format error message for missing URL', () => {
      const validationResults = [
        {
          spec: {
            url: '',
            method: HttpMethod.GET,
            headers: {},
            expectedStatus: 200,
            testScenarios: ['success'],
          },
          validation: {
            valid: false,
            errors: ['URL is required'],
            warnings: [],
          },
        },
      ];

      const errorComment = parser.formatErrorCommentForJira(validationResults, '');
      
      expect(errorComment).toContain('❌ *Invalid Endpoint Specification*');
      expect(errorComment).toContain('URL is required');
      expect(errorComment).toContain('*JSON Format:*');
      expect(errorComment).toContain('*YAML Format:*');
      expect(errorComment).toContain('*Markdown Table Format:*');
      expect(errorComment).toContain('*Required Fields:*');
    });

    it('should format error message for invalid URL format', () => {
      const validationResults = [
        {
          spec: {
            url: 'not-a-valid-url',
            method: HttpMethod.GET,
            headers: {},
            expectedStatus: 200,
            testScenarios: ['success'],
          },
          validation: {
            valid: false,
            errors: ['Invalid URL format: not-a-valid-url'],
            warnings: [],
          },
        },
      ];

      const errorComment = parser.formatErrorCommentForJira(validationResults, '');
      
      expect(errorComment).toContain('Invalid URL format: not-a-valid-url');
      expect(errorComment).toContain('URL: `not-a-valid-url`');
    });

    it('should format error message for multiple endpoints with errors', () => {
      const validationResults = [
        {
          spec: {
            url: '',
            method: HttpMethod.GET,
            headers: {},
            expectedStatus: 200,
            testScenarios: ['success'],
          },
          validation: {
            valid: false,
            errors: ['URL is required'],
            warnings: [],
          },
        },
        {
          spec: {
            url: '/api/users',
            method: HttpMethod.GET,
            headers: {},
            expectedStatus: 999,
            testScenarios: ['success'],
          },
          validation: {
            valid: false,
            errors: ['Invalid expected status code: 999'],
            warnings: [],
          },
        },
      ];

      const errorComment = parser.formatErrorCommentForJira(validationResults, '');
      
      expect(errorComment).toContain('*Endpoint 1:*');
      expect(errorComment).toContain('URL is required');
      expect(errorComment).toContain('*Endpoint 2:*');
      expect(errorComment).toContain('Invalid expected status code: 999');
    });

    it('should include warnings in error message', () => {
      const validationResults = [
        {
          spec: {
            url: '/api/users',
            method: HttpMethod.GET,
            headers: {},
            requestBody: { data: 'test' },
            expectedStatus: 200,
            testScenarios: ['success'],
          },
          validation: {
            valid: false,
            errors: ['Some error'],
            warnings: ['Request body provided for GET method (typically not used)'],
          },
        },
      ];

      const errorComment = parser.formatErrorCommentForJira(validationResults, '');
      
      expect(errorComment).toContain('_Warnings:_');
      expect(errorComment).toContain('⚠️ Request body provided for GET method');
    });

    it('should return empty string when no errors', () => {
      const validationResults = [
        {
          spec: {
            url: '/api/users',
            method: HttpMethod.GET,
            headers: {},
            expectedStatus: 200,
            testScenarios: ['success'],
          },
          validation: {
            valid: true,
            errors: [],
            warnings: [],
          },
        },
      ];

      const errorComment = parser.formatErrorCommentForJira(validationResults, '');
      
      expect(errorComment).toBe('');
    });

    it('should include all format examples', () => {
      const validationResults = [
        {
          spec: {
            url: '',
            method: HttpMethod.GET,
            headers: {},
            expectedStatus: 200,
            testScenarios: ['success'],
          },
          validation: {
            valid: false,
            errors: ['URL is required'],
            warnings: [],
          },
        },
      ];

      const errorComment = parser.formatErrorCommentForJira(validationResults, '');
      
      // Check JSON example
      expect(errorComment).toContain('"url": "/api/users"');
      expect(errorComment).toContain('"method": "GET"');
      
      // Check YAML example
      expect(errorComment).toContain('url: /api/users');
      expect(errorComment).toContain('method: GET');
      
      // Check Markdown table example
      expect(errorComment).toContain('| URL | Method | Status | Auth |');
      expect(errorComment).toContain('| /api/users | GET | 200 | bearer |');
    });

    it('should list required and optional fields', () => {
      const validationResults = [
        {
          spec: {
            url: '',
            method: HttpMethod.GET,
            headers: {},
            expectedStatus: 200,
            testScenarios: ['success'],
          },
          validation: {
            valid: false,
            errors: ['URL is required'],
            warnings: [],
          },
        },
      ];

      const errorComment = parser.formatErrorCommentForJira(validationResults, '');
      
      expect(errorComment).toContain('*Required Fields:*');
      expect(errorComment).toContain('`url` or `path`');
      expect(errorComment).toContain('`method`');
      expect(errorComment).toContain('*Optional Fields:*');
      expect(errorComment).toContain('`headers`');
      expect(errorComment).toContain('`requestBody`');
      expect(errorComment).toContain('`authType`');
    });
  });

  describe('parseAndValidateEndpoints', () => {
    it('should parse and validate endpoints', () => {
      const description = `
\`\`\`json
{
  "url": "/api/users",
  "method": "GET",
  "expectedStatus": 200
}
\`\`\`
      `;

      const result = parser.parseAndValidateEndpoints(description);
      
      expect(result.endpoints).toHaveLength(1);
      expect(result.validationResults).toHaveLength(1);
      expect(result.hasErrors).toBe(false);
      expect(result.validationResults[0]).toBeDefined();
      expect(result.validationResults[0]?.validation.valid).toBe(true);
    });

    it('should detect errors in endpoints', () => {
      const description = `
\`\`\`json
{
  "url": "",
  "method": "GET"
}
\`\`\`
      `;

      const result = parser.parseAndValidateEndpoints(description);
      
      expect(result.endpoints).toHaveLength(0); // Invalid endpoints filtered out
      expect(result.validationResults).toHaveLength(1);
      expect(result.hasErrors).toBe(true);
      expect(result.validationResults[0]).toBeDefined();
      expect(result.validationResults[0]?.validation.valid).toBe(false);
      expect(result.validationResults[0]?.validation.errors).toContain('URL is required');
    });

    it('should handle mixed valid and invalid endpoints', () => {
      const description = `
\`\`\`json
[
  {
    "url": "/api/users",
    "method": "GET"
  },
  {
    "url": "",
    "method": "POST"
  },
  {
    "url": "/api/products",
    "method": "GET"
  }
]
\`\`\`
      `;

      const result = parser.parseAndValidateEndpoints(description);
      
      expect(result.endpoints).toHaveLength(2); // Only valid endpoints
      expect(result.validationResults).toHaveLength(3); // All endpoints validated
      expect(result.hasErrors).toBe(true);
      expect(result.endpoints[0]).toBeDefined();
      expect(result.endpoints[1]).toBeDefined();
      expect(result.endpoints[0]?.url).toBe('/api/users');
      expect(result.endpoints[1]?.url).toBe('/api/products');
    });

    it('should return empty arrays when no endpoints found', () => {
      const description = 'No endpoints here';

      const result = parser.parseAndValidateEndpoints(description);
      
      expect(result.endpoints).toHaveLength(0);
      expect(result.validationResults).toHaveLength(0);
      expect(result.hasErrors).toBe(false);
    });
  });
});
