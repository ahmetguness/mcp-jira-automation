/**
 * Test framework templates
 * Feature: api-endpoint-testing-transformation
 * Requirements: 6.1, 6.2, 6.3
 */

import type { TestFramework } from '../models/types.js';

/**
 * Get framework-specific template instructions
 */
export function getFrameworkTemplate(framework: TestFramework): string {
  switch (framework) {
    case 'jest+supertest':
      return getJestSupertestTemplate();
    case 'pytest+requests':
      return getPytestRequestsTemplate();
    case 'pytest+httpx':
      return getPytestHttpxTemplate();
    case 'postman+newman':
      return getPostmanTemplate();
    default:
      return getJestSupertestTemplate(); // Default to Jest
  }
}

/**
 * Jest + Supertest template (Node.js/TypeScript)
 */
function getJestSupertestTemplate(): string {
  return `
## Framework: Jest + Supertest (TypeScript/Node.js)

### Template Structure:
\`\`\`typescript
import request from 'supertest';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || '';

describe('API Endpoint Tests', () => {
  describe('GET /api/resource', () => {
    it('should return 200 on successful request', async () => {
      const startTime = Date.now();
      const response = await request(API_BASE_URL)
        .get('/api/resource')
        .set('Authorization', \`Bearer \${API_TOKEN}\`)
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000); // Performance check
      expect(response.body).toHaveProperty('data');
    });

    it('should return 401 when unauthorized', async () => {
      await request(API_BASE_URL)
        .get('/api/resource')
        .expect(401);
    });
  });
});
\`\`\`

### Key Points:
- Use \`process.env\` for all credentials and base URLs
- Measure response time for performance testing
- Use \`.expect()\` for status code assertions
- Use Jest matchers for response validation
- Group tests by endpoint using nested \`describe\` blocks
`;
}

/**
 * Pytest + Requests template (Python)
 */
function getPytestRequestsTemplate(): string {
  return `
## Framework: Pytest + Requests (Python)

### Template Structure:
\`\`\`python
import os
import time
import pytest
import requests

API_BASE_URL = os.getenv('API_BASE_URL', 'http://localhost:3000')
API_TOKEN = os.getenv('API_TOKEN', '')

class TestApiEndpoints:
    def test_get_resource_success(self):
        """Test successful GET request returns 200"""
        headers = {'Authorization': f'Bearer {API_TOKEN}'}
        
        start_time = time.time()
        response = requests.get(f'{API_BASE_URL}/api/resource', headers=headers)
        response_time = (time.time() - start_time) * 1000  # Convert to ms
        
        assert response.status_code == 200
        assert response_time < 1000, f"Response time {response_time}ms exceeds threshold"
        assert 'data' in response.json()
    
    def test_get_resource_unauthorized(self):
        """Test GET request without auth returns 401"""
        response = requests.get(f'{API_BASE_URL}/api/resource')
        assert response.status_code == 401
\`\`\`

### Key Points:
- Use \`os.getenv()\` for all credentials and base URLs
- Measure response time using \`time.time()\`
- Use pytest assertions (\`assert\`)
- Group tests in classes for organization
- Use descriptive test method names with docstrings
`;
}

/**
 * Pytest + HTTPX template (Python async)
 */
function getPytestHttpxTemplate(): string {
  return `
## Framework: Pytest + HTTPX (Python Async)

### Template Structure:
\`\`\`python
import os
import time
import pytest
import httpx

API_BASE_URL = os.getenv('API_BASE_URL', 'http://localhost:3000')
API_TOKEN = os.getenv('API_TOKEN', '')

@pytest.mark.asyncio
class TestApiEndpoints:
    async def test_get_resource_success(self):
        """Test successful GET request returns 200"""
        headers = {'Authorization': f'Bearer {API_TOKEN}'}
        
        async with httpx.AsyncClient() as client:
            start_time = time.time()
            response = await client.get(f'{API_BASE_URL}/api/resource', headers=headers)
            response_time = (time.time() - start_time) * 1000
            
            assert response.status_code == 200
            assert response_time < 1000
            assert 'data' in response.json()
    
    async def test_get_resource_unauthorized(self):
        """Test GET request without auth returns 401"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f'{API_BASE_URL}/api/resource')
            assert response.status_code == 401
\`\`\`

### Key Points:
- Use \`@pytest.mark.asyncio\` decorator for async tests
- Use \`httpx.AsyncClient()\` for async HTTP requests
- Use \`async/await\` syntax
- Measure response time for performance testing
- Use pytest assertions
`;
}

/**
 * Postman Collection template
 */
function getPostmanTemplate(): string {
  return `
## Framework: Postman Collection (Newman)

### Template Structure:
\`\`\`json
{
  "info": {
    "name": "API Tests",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "baseUrl",
      "value": "{{API_BASE_URL}}",
      "type": "string"
    },
    {
      "key": "apiToken",
      "value": "{{API_TOKEN}}",
      "type": "string"
    }
  ],
  "item": [
    {
      "name": "GET /api/resource - Success",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status code is 200', function () {",
              "    pm.response.to.have.status(200);",
              "});",
              "",
              "pm.test('Response time is less than 1000ms', function () {",
              "    pm.expect(pm.response.responseTime).to.be.below(1000);",
              "});",
              "",
              "pm.test('Response has data property', function () {",
              "    var jsonData = pm.response.json();",
              "    pm.expect(jsonData).to.have.property('data');",
              "});"
            ]
          }
        }
      ],
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{apiToken}}"
          }
        ],
        "url": {
          "raw": "{{baseUrl}}/api/resource",
          "host": ["{{baseUrl}}"],
          "path": ["api", "resource"]
        }
      }
    },
    {
      "name": "GET /api/resource - Unauthorized",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status code is 401', function () {",
              "    pm.response.to.have.status(401);",
              "});"
            ]
          }
        }
      ],
      "request": {
        "method": "GET",
        "header": [],
        "url": {
          "raw": "{{baseUrl}}/api/resource",
          "host": ["{{baseUrl}}"],
          "path": ["api", "resource"]
        }
      }
    }
  ]
}
\`\`\`

### Key Points:
- Use collection variables for credentials ({{API_BASE_URL}}, {{API_TOKEN}})
- Add test scripts in the \`event.test\` section
- Use \`pm.test()\` for assertions
- Check response time with \`pm.response.responseTime\`
- Validate response body with \`pm.response.json()\`
`;
}

/**
 * Get setup commands for framework
 */
export function getFrameworkSetupCommands(framework: TestFramework): string[] {
  switch (framework) {
    case 'jest+supertest':
      return ['npm install', 'npm install --save-dev jest supertest @types/jest @types/supertest ts-jest'];
    case 'pytest+requests':
      return ['pip install pytest requests'];
    case 'pytest+httpx':
      return ['pip install pytest httpx pytest-asyncio'];
    case 'postman+newman':
      return ['npm install -g newman'];
    default:
      return ['npm install'];
  }
}

/**
 * Get run command for framework
 */
export function getFrameworkRunCommand(framework: TestFramework): string {
  switch (framework) {
    case 'jest+supertest':
      return 'npm test';
    case 'pytest+requests':
    case 'pytest+httpx':
      return 'pytest tests/api/ -v';
    case 'postman+newman':
      return 'newman run tests/api/collection.json';
    default:
      return 'npm test';
  }
}

/**
 * Get file extension for framework
 */
export function getFrameworkFileExtension(framework: TestFramework): string {
  switch (framework) {
    case 'jest+supertest':
      return '.test.ts';
    case 'pytest+requests':
    case 'pytest+httpx':
      return '.py';
    case 'postman+newman':
      return '.postman_collection.json';
    default:
      return '.test.ts';
  }
}
