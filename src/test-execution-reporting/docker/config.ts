/**
 * Docker Test Execution Configuration
 * 
 * Provides default configuration values and environment variable overrides
 * for Docker-based test execution.
 */

import type { DockerConfiguration, NetworkMode } from './types.js';

// ─── Environment Variable Keys ────────────────────────────────

const ENV_KEYS = {
  DEFAULT_IMAGE: 'DOCKER_TEST_IMAGE',
  IMAGE_REGISTRY: 'DOCKER_TEST_REGISTRY',
  NETWORK_MODE: 'DOCKER_TEST_NETWORK_MODE',
  MEMORY_LIMIT: 'DOCKER_TEST_MEMORY_LIMIT',
  CPU_LIMIT: 'DOCKER_TEST_CPU_LIMIT',
  TIMEOUT: 'DOCKER_TEST_TIMEOUT',
  CLEANUP_RETRIES: 'DOCKER_TEST_CLEANUP_RETRIES',
  CLEANUP_RETRY_DELAY: 'DOCKER_TEST_CLEANUP_RETRY_DELAY',
  PULL_TIMEOUT: 'DOCKER_TEST_PULL_TIMEOUT',
} as const;

// ─── Default Configuration ────────────────────────────────────

/**
 * Default Docker configuration values
 */
export const DEFAULT_CONFIG: DockerConfiguration = {
  defaultImage: 'node:20-alpine',
  networkMode: 'none',
  resourceLimits: {
    memory: '1g',
    cpu: '1.0',
  },
  timeout: 300000, // 5 minutes
  cleanupRetries: 3,
  cleanupRetryDelay: 1000, // 1 second
  pullTimeout: 120000, // 2 minutes
};

// ─── Configuration Validation ─────────────────────────────────

/**
 * Validation error for invalid configuration
 */
export class ConfigurationValidationError extends Error {
  constructor(message: string, public readonly field: string) {
    super(message);
    this.name = 'ConfigurationValidationError';
  }
}

/**
 * Validate network mode value
 */
function validateNetworkMode(value: string): NetworkMode {
  const validModes: NetworkMode[] = ['none', 'bridge', 'host'];
  if (!validModes.includes(value as NetworkMode)) {
    throw new ConfigurationValidationError(
      `Invalid network mode: ${value}. Must be one of: ${validModes.join(', ')}`,
      'networkMode'
    );
  }
  return value as NetworkMode;
}

/**
 * Validate memory limit format
 */
function validateMemoryLimit(value: string): string {
  const memoryPattern = /^\d+[kmg]$/i;
  if (!memoryPattern.test(value)) {
    throw new ConfigurationValidationError(
      `Invalid memory limit: ${value}. Must be in format: <number><unit> (e.g., 512m, 1g)`,
      'memoryLimit'
    );
  }
  return value;
}

/**
 * Validate CPU limit format
 */
function validateCpuLimit(value: string): string {
  const cpuValue = parseFloat(value);
  if (isNaN(cpuValue) || cpuValue <= 0) {
    throw new ConfigurationValidationError(
      `Invalid CPU limit: ${value}. Must be a positive number (e.g., 0.5, 1.0, 2.0)`,
      'cpuLimit'
    );
  }
  return value;
}

/**
 * Validate timeout value
 */
function validateTimeout(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigurationValidationError(
      `Invalid ${field}: ${value}. Must be a positive integer (milliseconds)`,
      field
    );
  }
  return value;
}

/**
 * Validate retry count
 */
function validateRetryCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigurationValidationError(
      `Invalid cleanup retries: ${value}. Must be a non-negative integer`,
      'cleanupRetries'
    );
  }
  return value;
}

/**
 * Validate Docker image name format
 */
function validateImageName(value: string): string {
  const trimmed = value.trim();
  
  if (!trimmed || trimmed.length === 0) {
    throw new ConfigurationValidationError(
      'Docker image name cannot be empty',
      'defaultImage'
    );
  }
  
  // Basic validation: image name should not contain invalid characters
  // Note: colon (:) is valid for tags, slash (/) is valid for namespaces
  const invalidChars = /[<>"|?*]/;
  if (invalidChars.test(trimmed)) {
    throw new ConfigurationValidationError(
      `Invalid Docker image name: ${trimmed}. Contains invalid characters`,
      'defaultImage'
    );
  }
  
  return trimmed;
}

// ─── Configuration Loading ────────────────────────────────────

/**
 * Load configuration from environment variables with validation
 * 
 * Environment variables:
 * - DOCKER_TEST_IMAGE: Default Docker image (default: node:20-alpine)
 * - DOCKER_TEST_REGISTRY: Custom registry URL (optional)
 * - DOCKER_TEST_NETWORK_MODE: Network mode (default: none)
 * - DOCKER_TEST_MEMORY_LIMIT: Memory limit (default: 1g)
 * - DOCKER_TEST_CPU_LIMIT: CPU limit (default: 1.0)
 * - DOCKER_TEST_TIMEOUT: Execution timeout in ms (default: 300000)
 * - DOCKER_TEST_CLEANUP_RETRIES: Cleanup retry count (default: 3)
 * - DOCKER_TEST_CLEANUP_RETRY_DELAY: Cleanup retry delay in ms (default: 1000)
 * - DOCKER_TEST_PULL_TIMEOUT: Image pull timeout in ms (default: 120000)
 * 
 * @returns Validated Docker configuration
 * @throws ConfigurationValidationError if any value is invalid
 */
export function loadConfiguration(): DockerConfiguration {
  const config: DockerConfiguration = {
    ...DEFAULT_CONFIG,
    resourceLimits: { ...DEFAULT_CONFIG.resourceLimits },
  };

  // Load and validate default image
  if (process.env[ENV_KEYS.DEFAULT_IMAGE]) {
    const imageValue = process.env[ENV_KEYS.DEFAULT_IMAGE]!.trim();
    if (imageValue) {
      config.defaultImage = validateImageName(imageValue);
    }
  }

  // Load optional image registry
  if (process.env[ENV_KEYS.IMAGE_REGISTRY]) {
    config.imageRegistry = process.env[ENV_KEYS.IMAGE_REGISTRY]!.trim();
  }

  // Load and validate network mode
  if (process.env[ENV_KEYS.NETWORK_MODE]) {
    config.networkMode = validateNetworkMode(process.env[ENV_KEYS.NETWORK_MODE]!);
  }

  // Load and validate memory limit
  if (process.env[ENV_KEYS.MEMORY_LIMIT]) {
    const memoryValue = process.env[ENV_KEYS.MEMORY_LIMIT]!.trim();
    if (memoryValue) {
      config.resourceLimits.memory = validateMemoryLimit(memoryValue);
    }
  }

  // Load and validate CPU limit
  if (process.env[ENV_KEYS.CPU_LIMIT]) {
    const cpuValue = process.env[ENV_KEYS.CPU_LIMIT]!.trim();
    if (cpuValue) {
      config.resourceLimits.cpu = validateCpuLimit(cpuValue);
    }
  }

  // Load and validate timeout
  if (process.env[ENV_KEYS.TIMEOUT]) {
    const timeoutStr = process.env[ENV_KEYS.TIMEOUT]!.trim();
    if (timeoutStr) {
      const timeout = parseInt(timeoutStr, 10);
      config.timeout = validateTimeout(timeout, 'timeout');
    }
  }

  // Load and validate cleanup retries
  if (process.env[ENV_KEYS.CLEANUP_RETRIES]) {
    const retriesStr = process.env[ENV_KEYS.CLEANUP_RETRIES]!.trim();
    if (retriesStr) {
      const retries = parseInt(retriesStr, 10);
      config.cleanupRetries = validateRetryCount(retries);
    }
  }

  // Load and validate cleanup retry delay
  if (process.env[ENV_KEYS.CLEANUP_RETRY_DELAY]) {
    const delayStr = process.env[ENV_KEYS.CLEANUP_RETRY_DELAY]!.trim();
    if (delayStr) {
      const delay = parseInt(delayStr, 10);
      config.cleanupRetryDelay = validateTimeout(delay, 'cleanupRetryDelay');
    }
  }

  // Load and validate pull timeout
  if (process.env[ENV_KEYS.PULL_TIMEOUT]) {
    const pullTimeoutStr = process.env[ENV_KEYS.PULL_TIMEOUT]!.trim();
    if (pullTimeoutStr) {
      const pullTimeout = parseInt(pullTimeoutStr, 10);
      config.pullTimeout = validateTimeout(pullTimeout, 'pullTimeout');
    }
  }

  return config;
}

/**
 * Validate a complete configuration object
 * 
 * @param config - Configuration to validate
 * @throws ConfigurationValidationError if any value is invalid
 */
export function validateConfiguration(config: DockerConfiguration): void {
  validateImageName(config.defaultImage);
  validateNetworkMode(config.networkMode);
  validateMemoryLimit(config.resourceLimits.memory);
  validateCpuLimit(config.resourceLimits.cpu);
  validateTimeout(config.timeout, 'timeout');
  validateRetryCount(config.cleanupRetries);
  validateTimeout(config.cleanupRetryDelay, 'cleanupRetryDelay');
  validateTimeout(config.pullTimeout, 'pullTimeout');
}

/**
 * Get the current configuration (loads from environment)
 * 
 * @returns Current Docker configuration
 */
export function getConfiguration(): DockerConfiguration {
  return loadConfiguration();
}
