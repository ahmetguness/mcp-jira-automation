/**
 * Example usage of CredentialManager
 * Feature: api-endpoint-testing-transformation
 */

import { CredentialManager } from './CredentialManager.js';
import { AuthType } from '../models/enums.js';

// Example 1: Get credentials from environment for Bearer token authentication
console.log('=== Example 1: Bearer Token Authentication ===');
try {
  const bearerCreds = CredentialManager.getCredentials({
    authType: AuthType.BEARER,
  });
  
  console.log('Credentials loaded:', Object.keys(bearerCreds.values));
  
  // Build authorization header
  const authHeader = CredentialManager.buildAuthHeader(bearerCreds);
  console.log('Authorization header:', authHeader ? '[PRESENT]' : '[MISSING]');
  
  // Clear credentials after use
  CredentialManager.clearCredentials(bearerCreds);
  console.log('Credentials cleared');
} catch (error) {
  console.error('Error:', (error as Error).message);
}

// Example 2: Get credentials for Basic authentication
console.log('\n=== Example 2: Basic Authentication ===');
try {
  const basicCreds = CredentialManager.getCredentials({
    authType: AuthType.BASIC,
  });
  
  console.log('Credentials loaded:', Object.keys(basicCreds.values));
  
  const authHeader = CredentialManager.buildAuthHeader(basicCreds);
  console.log('Authorization header:', authHeader ? '[PRESENT]' : '[MISSING]');
  
  CredentialManager.clearCredentials(basicCreds);
} catch (error) {
  console.error('Error:', (error as Error).message);
}

// Example 3: Get credentials for API Key authentication
console.log('\n=== Example 3: API Key Authentication ===');
try {
  const apiKeyCreds = CredentialManager.getCredentials({
    authType: AuthType.API_KEY,
  });
  
  console.log('Credentials loaded:', Object.keys(apiKeyCreds.values));
  
  const apiKeyHeader = CredentialManager.getApiKeyHeader(apiKeyCreds);
  console.log('API Key header:', apiKeyHeader ? `${apiKeyHeader.name}: [PRESENT]` : '[MISSING]');
  
  CredentialManager.clearCredentials(apiKeyCreds);
} catch (error) {
  console.error('Error:', (error as Error).message);
}

// Example 4: Redact credentials from text
console.log('\n=== Example 4: Credential Redaction ===');
const logMessage = `
Request sent to API:
URL: https://api.example.com/users
Headers:
  Authorization: Bearer abc123token456
  X-API-Key: secret-key-789
Response: 200 OK
`;

const redactedLog = CredentialManager.redactCredentials(logMessage);
console.log('Original log (truncated):', logMessage.substring(0, 100) + '...');
console.log('Redacted log:', redactedLog);

// Example 5: Redact credentials from object
console.log('\n=== Example 5: Object Redaction ===');
const requestData = {
  url: '/api/users',
  method: 'GET',
  headers: {
    Authorization: 'Bearer abc123token456',
    'X-API-Key': 'secret-key-789',
    'Content-Type': 'application/json',
  },
  timestamp: new Date().toISOString(),
};

const redactedData = CredentialManager.redactCredentialsFromObject(requestData);
console.log('Redacted request data:', JSON.stringify(redactedData, null, 2));

// Example 6: Check if text contains credentials
console.log('\n=== Example 6: Credential Detection ===');
const testCases = [
  'This is a safe log message',
  'Authorization: Bearer abc123token',
  'API_KEY=secret123',
  'password=mypassword123',
];

for (const testCase of testCases) {
  const hasCredentials = CredentialManager.containsCredentials(testCase);
  console.log(`"${testCase}" contains credentials: ${hasCredentials}`);
}

// Example 7: Validate test script for hardcoded credentials
console.log('\n=== Example 7: Test Script Validation ===');
const testScript1 = `
const token = process.env.API_TOKEN;
const response = await fetch('/api/users', {
  headers: { Authorization: \`Bearer \${token}\` }
});
`;

const testScript2 = `
const token = 'hardcoded-token-123';
const response = await fetch('/api/users', {
  headers: { Authorization: \`Bearer \${token}\` }
});
`;

const validation1 = CredentialManager.validateNoHardcodedCredentials(testScript1);
console.log('Test script 1 (env var):', validation1.valid ? 'VALID' : 'INVALID');
if (!validation1.valid) {
  console.log('Issues:', validation1.issues);
}

const validation2 = CredentialManager.validateNoHardcodedCredentials(testScript2);
console.log('Test script 2 (hardcoded):', validation2.valid ? 'VALID' : 'INVALID');
if (!validation2.valid) {
  console.log('Issues:', validation2.issues);
}

// Example 8: Get environment variable placeholders
console.log('\n=== Example 8: Environment Variable Placeholders ===');
const authTypes = [AuthType.BEARER, AuthType.BASIC, AuthType.API_KEY, AuthType.OAUTH];

for (const authType of authTypes) {
  const tsPlaceholder = CredentialManager.getEnvVarPlaceholder(authType, 'typescript');
  const pyPlaceholder = CredentialManager.getEnvVarPlaceholder(authType, 'python');
  
  console.log(`${authType}:`);
  console.log(`  TypeScript: ${tsPlaceholder}`);
  console.log(`  Python: ${pyPlaceholder}`);
}

// Example 9: Custom environment variable mapping
console.log('\n=== Example 9: Custom Environment Variables ===');
try {
  const customCreds = CredentialManager.getCredentials({
    authType: AuthType.BEARER,
    customEnvVars: {
      CUSTOM_TOKEN: 'MY_CUSTOM_API_TOKEN',
    },
  });
  
  console.log('Custom credentials loaded:', Object.keys(customCreds.values));
  CredentialManager.clearCredentials(customCreds);
} catch (error) {
  console.error('Error:', (error as Error).message);
}

console.log('\n=== Examples Complete ===');
