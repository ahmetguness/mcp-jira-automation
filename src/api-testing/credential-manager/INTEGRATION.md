# CredentialManager Integration Guide

This document describes how the CredentialManager is integrated with other modules in the API Endpoint Testing Transformation system.

## Overview

The CredentialManager provides secure credential handling across the entire system, ensuring:
- **Requirement 7.1**: Credentials sourced only from environment variables
- **Requirement 7.2**: Credentials never logged
- **Requirement 7.3**: Credentials never committed to SCM
- **Requirement 7.7**: Multi-method authentication support (OAuth, Bearer, Basic Auth, API Key)

## Integration Points

### 1. TestExecutor Integration

**File**: `src/api-testing/test-executor/TestExecutor.ts`

**Changes Made**:
- Added import for CredentialManager
- Updated `parseTestResults()` to redact credentials from test output before parsing
- Enhanced `clearCredentials()` to use best-effort credential clearing

**Code Example**:
```typescript
// Redact credentials from test output
const credentialValues = Object.values(_tests.requiredEnvVars || []);
const redactedStdout = CredentialManager.redactCredentials(result.stdout, credentialValues);

// Parse using redacted output
const testCases = this.parseTestCases(redactedStdout);
```

**Requirements Satisfied**:
- 7.2: Credentials never logged (output is redacted before parsing)
- 7.6: Credentials cleared after execution

### 2. TestReporter Integration

**File**: `src/api-testing/test-reporter/TestReporter.ts`

**Changes Made**:
- Added import for CredentialManager
- Updated `reportToJira()` to redact credentials from Jira comments
- Updated `commitToScm()` to validate and redact credentials before committing test scripts

**Code Example**:
```typescript
// Redact credentials from Jira comments
const comment = this.formatJiraComment(results);
const redactedComment = CredentialManager.redactCredentials(comment);
await this.postJiraComment(taskKey, redactedComment);

// Validate no hardcoded credentials before committing
const validation = CredentialManager.validateNoHardcodedCredentials(testFile.content);
if (!validation.valid) {
  throw new Error(`Cannot commit: contains hardcoded credentials`);
}

// Redact any remaining credentials
const redactedContent = CredentialManager.redactCredentials(testFile.content);
```

**Requirements Satisfied**:
- 7.2: Credentials never logged (Jira comments are redacted)
- 7.3: Credentials never committed to SCM (validation + redaction before commit)

### 3. TestScriptGenerator Integration

**File**: `src/api-testing/test-script-generator/TestScriptGenerator.ts`

**Changes Made**:
- Added import for CredentialManager
- Updated `generateAuthConfig()` to use CredentialManager for environment variable placeholders
- Updated `parseAiResponse()` to validate generated test scripts for hardcoded credentials

**Code Example**:
```typescript
// Generate environment variable placeholders
const tsPlaceholder = CredentialManager.getEnvVarPlaceholder(authType, 'typescript');
const pyPlaceholder = CredentialManager.getEnvVarPlaceholder(authType, 'python');

// Validate generated test scripts
const validation = CredentialManager.validateNoHardcodedCredentials(testFile.content);
if (!validation.valid) {
  logger.warn(`Generated test contains potential hardcoded credentials`, {
    issues: validation.issues,
  });
}
```

**Requirements Satisfied**:
- 7.1: Credentials sourced from environment (placeholders generated correctly)
- 7.4: Test scripts use environment variable placeholders

## CredentialManager API

### Core Methods

#### 1. `getCredentials(config: CredentialConfig): Credentials`
Retrieves credentials from environment variables based on authentication type.

**Supported Auth Types**:
- `AuthType.BEARER`: Reads `API_TOKEN`, `BEARER_TOKEN`, or `ACCESS_TOKEN`
- `AuthType.BASIC`: Reads `API_USERNAME` and `API_PASSWORD`
- `AuthType.API_KEY`: Reads `API_KEY` or `X_API_KEY`
- `AuthType.OAUTH`: Reads `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_TOKEN_URL`, `OAUTH_ACCESS_TOKEN`

#### 2. `buildAuthHeader(credentials: Credentials): string | null`
Builds the Authorization header value for a request.

**Returns**:
- Bearer: `"Bearer <token>"`
- Basic: `"Basic <base64-encoded-username:password>"`
- OAuth: `"Bearer <oauth-access-token>"`
- API Key: `null` (use `getApiKeyHeader()` instead)

#### 3. `getApiKeyHeader(credentials: Credentials, headerName?: string): { name: string; value: string } | null`
Gets the API key header name and value.

**Default header name**: `X-API-Key`

#### 4. `redactCredentials(text: string, knownCredentials?: string[]): string`
Redacts credentials from text using pattern matching and known credential values.

**Patterns Detected**:
- Bearer tokens
- API keys
- Passwords
- Secrets
- Authorization headers

#### 5. `redactCredentialsFromObject(obj: Record<string, unknown>, knownCredentials?: string[]): Record<string, unknown>`
Recursively redacts credentials from an object (for logging).

**Redacts fields containing**:
- password
- token
- secret
- key
- auth

#### 6. `containsCredentials(text: string): boolean`
Checks if text contains potential credentials.

#### 7. `validateNoHardcodedCredentials(testScript: string): { valid: boolean; issues: string[] }`
Validates that a test script doesn't contain hardcoded credentials.

**Detects**:
- Hardcoded passwords
- Hardcoded tokens
- Hardcoded API keys
- Hardcoded secrets
- Hardcoded bearer tokens

#### 8. `clearCredentials(credentials: Credentials): void`
Clears credentials from memory by overwriting values with empty strings.

#### 9. `getEnvVarPlaceholder(authType: AuthType, language: 'typescript' | 'python'): string`
Gets the environment variable placeholder code for test scripts.

**Examples**:
- TypeScript Bearer: `process.env.API_TOKEN`
- Python Bearer: `os.environ.get('API_TOKEN')`

## Environment Variables

### Required Environment Variables by Auth Type

#### Bearer Token
```bash
API_TOKEN=your-bearer-token
# OR
BEARER_TOKEN=your-bearer-token
# OR
ACCESS_TOKEN=your-access-token
```

#### Basic Authentication
```bash
API_USERNAME=your-username
API_PASSWORD=your-password
```

#### API Key
```bash
API_KEY=your-api-key
# OR
X_API_KEY=your-api-key
```

#### OAuth
```bash
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_TOKEN_URL=https://auth.example.com/token
OAUTH_ACCESS_TOKEN=your-access-token  # Optional, if already obtained
```

## Security Best Practices

### 1. Never Hardcode Credentials
❌ **Bad**:
```typescript
const token = 'abc123token';
```

✅ **Good**:
```typescript
const token = process.env.API_TOKEN;
```

### 2. Always Redact Before Logging
❌ **Bad**:
```typescript
console.log('Request headers:', headers);
```

✅ **Good**:
```typescript
const redactedHeaders = CredentialManager.redactCredentialsFromObject(headers);
console.log('Request headers:', redactedHeaders);
```

### 3. Validate Before Committing
❌ **Bad**:
```typescript
await scm.commitFile(testFile.path, testFile.content);
```

✅ **Good**:
```typescript
const validation = CredentialManager.validateNoHardcodedCredentials(testFile.content);
if (!validation.valid) {
  throw new Error('Cannot commit: contains hardcoded credentials');
}
const redactedContent = CredentialManager.redactCredentials(testFile.content);
await scm.commitFile(testFile.path, redactedContent);
```

### 4. Clear After Use
❌ **Bad**:
```typescript
const creds = CredentialManager.getCredentials({ authType: AuthType.BEARER });
// Use credentials...
// Credentials remain in memory
```

✅ **Good**:
```typescript
const creds = CredentialManager.getCredentials({ authType: AuthType.BEARER });
try {
  // Use credentials...
} finally {
  CredentialManager.clearCredentials(creds);
}
```

## Testing

The CredentialManager includes comprehensive functionality for:
- Credential sourcing from environment
- Multi-method authentication support
- Credential redaction in text and objects
- Hardcoded credential detection
- Credential cleanup

To test the integration:

1. Set up environment variables:
```bash
export API_TOKEN=test-token-123
export API_USERNAME=testuser
export API_PASSWORD=testpass
export API_KEY=test-api-key
```

2. Run the example usage:
```bash
npm run build
node dist/api-testing/credential-manager/example-usage.js
```

3. Verify:
- Credentials are loaded from environment
- Authorization headers are built correctly
- Credentials are redacted in logs
- Hardcoded credentials are detected
- Credentials are cleared after use

## Troubleshooting

### Issue: "No credentials found in environment"
**Solution**: Ensure the required environment variables are set for the authentication type being used.

### Issue: "Test file contains hardcoded credentials"
**Solution**: Replace hardcoded values with environment variable references:
- TypeScript: `process.env.VARIABLE_NAME`
- Python: `os.environ.get('VARIABLE_NAME')`

### Issue: Credentials appearing in logs
**Solution**: Ensure all log statements use `CredentialManager.redactCredentials()` or `CredentialManager.redactCredentialsFromObject()` before logging.

### Issue: Credentials committed to SCM
**Solution**: The system should prevent this automatically. If it occurs:
1. Check that `commitToScm()` is using credential validation
2. Verify redaction is applied before committing
3. Review the credential patterns in CredentialManager

## Future Enhancements

Potential improvements for the CredentialManager:

1. **Credential Rotation**: Support for automatic credential rotation
2. **Vault Integration**: Integration with HashiCorp Vault or AWS Secrets Manager
3. **Audit Logging**: Track credential access for security auditing
4. **Custom Patterns**: Allow users to define custom credential patterns
5. **Encryption**: Encrypt credentials in memory (limited by JavaScript capabilities)

## References

- Requirements: 7.1, 7.2, 7.3, 7.7
- Design Document: Section on "Credential Security"
- Task: 15. Implement credential security features
