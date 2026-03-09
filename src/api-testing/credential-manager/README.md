# Credential Manager

Secure credential handling for API endpoint testing.

## Overview

The CredentialManager ensures that credentials are handled securely throughout the API testing system:

- **Requirement 7.1**: Credentials are sourced only from environment variables (never hardcoded)
- **Requirement 7.2**: Credentials are never logged
- **Requirement 7.3**: Credentials are never committed to SCM
- **Requirement 7.7**: Support for multiple authentication methods (OAuth, Bearer Token, Basic Auth, API Key)

## Features

### 1. Credential Sourcing from Environment

```typescript
import { CredentialManager } from './credential-manager';
import { AuthType } from './models/enums';

// Get credentials for Bearer token authentication
const credentials = CredentialManager.getCredentials({
  authType: AuthType.BEARER,
});

// Get credentials with custom environment variable names
const customCredentials = CredentialManager.getCredentials({
  authType: AuthType.BEARER,
  envVarNames: ['MY_CUSTOM_TOKEN'],
});
```

### 2. Credential Redaction

```typescript
// Redact credentials from log messages
const logMessage = 'Authorization: Bearer abc123token';
const redacted = CredentialManager.redactCredentials(logMessage);
// Result: 'Authorization: [REDACTED]'

// Redact credentials from objects
const requestData = {
  url: '/api/users',
  headers: {
    Authorization: 'Bearer abc123token',
  },
};
const redactedData = CredentialManager.redactCredentialsFromObject(requestData);
// Result: { url: '/api/users', headers: { Authorization: '[REDACTED]' } }
```

### 3. Multi-Method Authentication Support

```typescript
// Bearer Token
const bearerCreds = CredentialManager.getCredentials({
  authType: AuthType.BEARER,
});
const authHeader = CredentialManager.buildAuthHeader(bearerCreds);
// Result: 'Bearer <token>'

// Basic Auth
const basicCreds = CredentialManager.getCredentials({
  authType: AuthType.BASIC,
});
const basicAuthHeader = CredentialManager.buildAuthHeader(basicCreds);
// Result: 'Basic <base64-encoded-username:password>'

// API Key
const apiKeyCreds = CredentialManager.getCredentials({
  authType: AuthType.API_KEY,
});
const apiKeyHeader = CredentialManager.getApiKeyHeader(apiKeyCreds);
// Result: { name: 'X-API-Key', value: '<api-key>' }

// OAuth
const oauthCreds = CredentialManager.getCredentials({
  authType: AuthType.OAUTH,
});
const oauthHeader = CredentialManager.buildAuthHeader(oauthCreds);
// Result: 'Bearer <oauth-access-token>'
```

### 4. Credential Validation

```typescript
// Check if text contains credentials
const hasCredentials = CredentialManager.containsCredentials(
  'Authorization: Bearer abc123'
);
// Result: true

// Validate test scripts don't have hardcoded credentials
const validation = CredentialManager.validateNoHardcodedCredentials(testScript);
if (!validation.valid) {
  console.error('Hardcoded credentials found:', validation.issues);
}
```

### 5. Credential Cleanup

```typescript
// Clear credentials from memory after use
CredentialManager.clearCredentials(credentials);
```

## Environment Variables

### Bearer Token Authentication
- `API_TOKEN` (primary)
- `BEARER_TOKEN` (fallback)
- `ACCESS_TOKEN` (fallback)

### Basic Authentication
- `API_USERNAME` (required)
- `API_PASSWORD` (required)

### API Key Authentication
- `API_KEY` (primary)
- `X_API_KEY` (fallback)

### OAuth Authentication
- `OAUTH_CLIENT_ID` (required)
- `OAUTH_CLIENT_SECRET` (required)
- `OAUTH_TOKEN_URL` (required)
- `OAUTH_ACCESS_TOKEN` (optional, if already obtained)

## Integration with Other Modules

### TestExecutor Integration

The TestExecutor uses CredentialManager to:
- Source credentials from environment
- Pass credentials securely to Docker containers
- Clear credentials after test execution

```typescript
// In TestExecutor
const credentials = CredentialManager.getCredentials({
  authType: endpoint.authType,
});

// Build environment variables for container
const envVars = Object.entries(credentials.values).map(
  ([key, value]) => `${key}=${value}`
);

// After execution
CredentialManager.clearCredentials(credentials);
```

### TestReporter Integration

The TestReporter uses CredentialManager to:
- Redact credentials from Jira comments
- Redact credentials from test results
- Prevent credentials in SCM commits

```typescript
// In TestReporter
const comment = this.formatJiraComment(results);
const redactedComment = CredentialManager.redactCredentials(comment);
await this.postJiraComment(taskKey, redactedComment);
```

### TestScriptGenerator Integration

The TestScriptGenerator uses CredentialManager to:
- Generate test scripts with environment variable placeholders
- Validate generated scripts don't contain hardcoded credentials

```typescript
// In TestScriptGenerator
const placeholder = CredentialManager.getEnvVarPlaceholder(
  endpoint.authType,
  'typescript'
);
// Result: 'process.env.API_TOKEN'

// Validate generated script
const validation = CredentialManager.validateNoHardcodedCredentials(
  generatedScript
);
```

## Security Best Practices

1. **Never hardcode credentials**: Always use environment variables
2. **Redact before logging**: Use `redactCredentials()` before logging any data
3. **Redact before committing**: Use `redactCredentials()` before committing to SCM
4. **Clear after use**: Use `clearCredentials()` after test execution
5. **Validate test scripts**: Use `validateNoHardcodedCredentials()` on generated tests

## Example: Complete Workflow

```typescript
import { CredentialManager } from './credential-manager';
import { AuthType } from './models/enums';

// 1. Get credentials from environment
const credentials = CredentialManager.getCredentials({
  authType: AuthType.BEARER,
});

// 2. Build authorization header
const authHeader = CredentialManager.buildAuthHeader(credentials);

// 3. Make API request (example)
const response = await fetch('https://api.example.com/users', {
  headers: {
    Authorization: authHeader,
  },
});

// 4. Log response (with redaction)
const logData = {
  url: 'https://api.example.com/users',
  headers: { Authorization: authHeader },
  status: response.status,
};
const redactedLogData = CredentialManager.redactCredentialsFromObject(logData);
console.log('API Response:', redactedLogData);

// 5. Clear credentials from memory
CredentialManager.clearCredentials(credentials);
```

## Testing

The CredentialManager includes comprehensive unit tests covering:
- Credential sourcing from environment
- Credential redaction in text and objects
- Multi-method authentication support
- Hardcoded credential detection
- Credential cleanup

Run tests with:
```bash
npm test -- credential-manager
```
