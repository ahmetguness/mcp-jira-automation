/**
 * CredentialManager - Secure credential handling for API testing
 * Feature: api-endpoint-testing-transformation
 * Requirements: 7.1, 7.2, 7.3, 7.7
 * 
 * This module ensures credentials are:
 * - Sourced only from environment variables (never hardcoded)
 * - Redacted from all outputs (logs, SCM commits, Jira comments)
 * - Properly handled for multiple authentication methods
 */

import { AuthType } from '../models/enums.js';
import { createLogger } from '../../logger.js';

const log = createLogger('api-testing:credential-manager');

/**
 * Credential configuration for different authentication types
 */
export interface CredentialConfig {
  authType: AuthType;
  envVarNames?: string[]; // Environment variable names to read
  customEnvVars?: Record<string, string>; // Custom environment variable mappings
}

/**
 * Credentials retrieved from environment
 */
export interface Credentials {
  authType: AuthType;
  values: Record<string, string>;
}

/**
 * CredentialManager class
 * Handles secure credential sourcing and redaction
 */
export class CredentialManager {
  private static readonly REDACTED_PLACEHOLDER = '[REDACTED]';

  // Common credential patterns to redact
  private static readonly CREDENTIAL_PATTERNS = [
    /bearer\s+[a-zA-Z0-9_\-.]+/gi,        // \. yerine .
    /token["\s:=]+[a-zA-Z0-9_\-.]+/gi,    // \. yerine .
    /api[_-]?key["\s:=]+[a-zA-Z0-9_\-.]+/gi,  // \. yerine .
    /password["\s:=]+[^\s"']+/gi,
    /secret["\s:=]+[^\s"']+/gi,
    /authorization:\s*[^\n]+/gi,
    /x-api-key:\s*[^\n]+/gi,
  ];

  /**
   * Get credentials from environment variables
   * Requirement 7.1: Read credentials from environment variables only
   * 
   * @param config - Credential configuration specifying auth type and env var names
   * @returns Credentials object with values from environment
   * @throws Error if required environment variables are missing
   */
  static getCredentials(config: CredentialConfig): Credentials {
    log.debug(`Getting credentials for auth type: ${config.authType}`);

    const credentials: Credentials = {
      authType: config.authType,
      values: {},
    };

    // Get environment variable names based on auth type
    const envVarNames = config.envVarNames || this.getDefaultEnvVarNames(config.authType);

    // Read from environment
    for (const envVarName of envVarNames) {
      const value = process.env[envVarName];

      if (!value) {
        log.warn(`Environment variable ${envVarName} not found`);
        continue;
      }

      credentials.values[envVarName] = value;
      log.debug(`Loaded credential from ${envVarName}`);
    }

    // Add custom environment variables if provided
    if (config.customEnvVars) {
      for (const [key, envVarName] of Object.entries(config.customEnvVars)) {
        const value = process.env[envVarName];

        if (value) {
          credentials.values[key] = value;
          log.debug(`Loaded custom credential from ${envVarName} as ${key}`);
        }
      }
    }

    // Validate that we have at least one credential
    if (Object.keys(credentials.values).length === 0 && config.authType !== AuthType.NONE) {
      throw new Error(
        `No credentials found in environment for auth type ${config.authType}. ` +
        `Expected environment variables: ${envVarNames.join(', ')}`
      );
    }

    return credentials;
  }

  /**
   * Get default environment variable names for an auth type
   * Requirement 7.7: Support OAuth, Bearer Token, Basic Auth, API Key authentication
   * 
   * @param authType - Authentication type
   * @returns Array of environment variable names to check
   */
  private static getDefaultEnvVarNames(authType: AuthType): string[] {
    switch (authType) {
      case AuthType.BEARER:
        return ['API_TOKEN', 'BEARER_TOKEN', 'ACCESS_TOKEN'];

      case AuthType.BASIC:
        return ['API_USERNAME', 'API_PASSWORD'];

      case AuthType.API_KEY:
        return ['API_KEY', 'X_API_KEY'];

      case AuthType.OAUTH:
        return [
          'OAUTH_CLIENT_ID',
          'OAUTH_CLIENT_SECRET',
          'OAUTH_TOKEN_URL',
          'OAUTH_ACCESS_TOKEN',
        ];

      case AuthType.NONE:
        return [];

      default:
        log.warn(`Unknown auth type: ${authType as string}, returning empty env var list`);
        return [];
    }
  }

  /**
   * Build authorization header for a request
   * Requirement 7.7: Support multiple authentication methods
   * 
   * @param credentials - Credentials to use
   * @returns Authorization header value
   */
  static buildAuthHeader(credentials: Credentials): string | null {
    switch (credentials.authType) {
      case AuthType.BEARER: {
        const token = credentials.values.API_TOKEN ||
          credentials.values.BEARER_TOKEN ||
          credentials.values.ACCESS_TOKEN;
        return token ? `Bearer ${token}` : null;
      }

      case AuthType.BASIC: {
        const username = credentials.values.API_USERNAME;
        const password = credentials.values.API_PASSWORD;

        if (username && password) {
          const encoded = Buffer.from(`${username}:${password}`).toString('base64');
          return `Basic ${encoded}`;
        }
        return null;
      }

      case AuthType.API_KEY: {
        // API Key is typically passed as a custom header, not Authorization
        // Return null here, caller should use getApiKeyHeader()
        return null;
      }

      case AuthType.OAUTH: {
        const token = credentials.values.OAUTH_ACCESS_TOKEN;
        return token ? `Bearer ${token}` : null;
      }

      case AuthType.NONE:
        return null;

      default:
        log.warn(`Unknown auth type: ${credentials.authType as string}`);
        return null;
    }
  }

  /**
   * Get API key header name and value
   * Requirement 7.7: Support API Key authentication
   * 
   * @param credentials - Credentials to use
   * @param headerName - Custom header name (default: 'X-API-Key')
   * @returns Object with header name and value, or null if not applicable
   */
  static getApiKeyHeader(
    credentials: Credentials,
    headerName: string = 'X-API-Key'
  ): { name: string; value: string } | null {
    if (credentials.authType !== AuthType.API_KEY) {
      return null;
    }

    const apiKey = credentials.values.API_KEY || credentials.values.X_API_KEY;

    if (!apiKey) {
      return null;
    }

    return {
      name: headerName,
      value: apiKey,
    };
  }

  /**
   * Redact credentials from text
   * Requirements: 7.2, 7.3 - Never log or commit credentials
   * 
   * This method:
   * - Replaces credential patterns with [REDACTED]
   * - Redacts authorization headers
   * - Redacts known credential values
   * 
   * @param text - Text that may contain credentials
   * @param knownCredentials - Known credential values to redact
   * @returns Text with credentials redacted
   */
  static redactCredentials(text: string, knownCredentials?: string[]): string {
    let redacted = text;

    // Redact known credential values
    if (knownCredentials) {
      for (const credential of knownCredentials) {
        if (credential && credential.length > 0) {
          // Create a regex that matches the credential value
          // Use word boundaries to avoid partial matches
          const regex = new RegExp(this.escapeRegex(credential), 'gi');
          redacted = redacted.replace(regex, this.REDACTED_PLACEHOLDER);
        }
      }
    }

    // Redact common credential patterns
    for (const pattern of this.CREDENTIAL_PATTERNS) {
      redacted = redacted.replace(pattern, (match) => {
        // Keep the prefix (e.g., "Authorization: ") but redact the value
        const colonIndex = match.indexOf(':');
        if (colonIndex !== -1) {
          return match.substring(0, colonIndex + 1) + ' ' + this.REDACTED_PLACEHOLDER;
        }
        return this.REDACTED_PLACEHOLDER;
      });
    }

    return redacted;
  }

  /**
   * Redact credentials from an object (for logging)
   * Requirements: 7.2 - Never log credentials
   * 
   * @param obj - Object that may contain credentials
   * @param knownCredentials - Known credential values to redact
   * @returns New object with credentials redacted
   */
  static redactCredentialsFromObject(
    obj: Record<string, unknown>,
    knownCredentials?: string[]
  ): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // Check if key indicates a credential field
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('key') ||
        lowerKey.includes('auth')
      ) {
        redacted[key] = this.REDACTED_PLACEHOLDER;
      } else if (typeof value === 'string') {
        // Redact string values that might contain credentials
        redacted[key] = this.redactCredentials(value, knownCredentials);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively redact nested objects
        redacted[key] = this.redactCredentialsFromObject(
          value as Record<string, unknown>,
          knownCredentials
        );
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  /**
   * Check if text contains potential credentials
   * Requirement 7.3 - Prevent credentials in SCM commits
   * 
   * @param text - Text to check
   * @returns True if text appears to contain credentials
   */
  static containsCredentials(text: string): boolean {
    // Check for common credential patterns
    for (const pattern of this.CREDENTIAL_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }

    // Check for base64-encoded strings that might be credentials
    // (Basic auth, JWT tokens, etc.)
    const base64Pattern = /[A-Za-z0-9+/]{40,}={0,2}/g;
    const base64Matches = text.match(base64Pattern);

    if (base64Matches && base64Matches.length > 0) {
      // If we find long base64 strings, it might be a credential
      return true;
    }

    return false;
  }

  /**
   * Clear credentials from memory
   * Requirement 7.6 - Clear credentials after execution
   * 
   * @param credentials - Credentials object to clear
   */
  static clearCredentials(credentials: Credentials): void {
    // Overwrite credential values with empty strings
    for (const key of Object.keys(credentials.values)) {
      credentials.values[key] = '';
    }

    log.debug('Credentials cleared from memory');
  }

  /**
   * Validate that credentials are not hardcoded in test scripts
   * Requirement 7.1 - Never use hardcoded credentials
   * 
   * @param testScript - Test script content to validate
   * @returns Validation result with any issues found
   */
  static validateNoHardcodedCredentials(testScript: string): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check for hardcoded credential patterns
    const hardcodedPatterns = [
      { pattern: /password\s*=\s*["'][^"']+["']/gi, message: 'Hardcoded password found' },
      { pattern: /token\s*=\s*["'][^"']+["']/gi, message: 'Hardcoded token found' },
      { pattern: /api[_-]?key\s*=\s*["'][^"']+["']/gi, message: 'Hardcoded API key found' },
      { pattern: /secret\s*=\s*["'][^"']+["']/gi, message: 'Hardcoded secret found' },
      { pattern: /bearer\s+[a-zA-Z0-9_\-.]{20,}/gi, message: 'Hardcoded bearer token found' },
    ];

    for (const { pattern, message } of hardcodedPatterns) {
      const matches = testScript.match(pattern);
      if (matches) {
        // Check if it's actually an environment variable reference
        const isEnvVar = matches.some(match =>
          match.includes('process.env') ||
          match.includes('$') ||
          match.includes('os.environ') ||
          match.includes('ENV[')
        );

        if (!isEnvVar) {
          issues.push(`${message}: ${matches[0]}`);
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Escape special regex characters
   * 
   * @param str - String to escape
   * @returns Escaped string safe for use in regex
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get environment variable placeholder for test scripts
   * Requirement 7.4 - Use placeholders in generated tests
   * 
   * @param authType - Authentication type
   * @param language - Programming language ('typescript', 'python', etc.)
   * @returns Code snippet for accessing environment variable
   */
  static getEnvVarPlaceholder(authType: AuthType, language: 'typescript' | 'python' = 'typescript'): string {
    const envVarNames = this.getDefaultEnvVarNames(authType);

    if (envVarNames.length === 0) {
      return '';
    }

    const primaryEnvVar = envVarNames[0];

    if (language === 'python') {
      return `os.environ.get('${primaryEnvVar}')`;
    } else {
      return `process.env.${primaryEnvVar}`;
    }
  }
}
