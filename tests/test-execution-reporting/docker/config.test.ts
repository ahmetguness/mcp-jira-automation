/**
 * Unit tests for Docker configuration
 * 
 * Tests default configuration values, environment variable overrides,
 * and configuration validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_CONFIG,
  ConfigurationValidationError,
  loadConfiguration,
  validateConfiguration,
  getConfiguration,
} from '../../../src/test-execution-reporting/docker/config.js';

describe('Docker Configuration', () => {
  // Store original environment variables
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all Docker-related environment variables before each test
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('DOCKER_TEST_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CONFIG.defaultImage).toBe('node:20-alpine');
      expect(DEFAULT_CONFIG.networkMode).toBe('none');
      expect(DEFAULT_CONFIG.resourceLimits.memory).toBe('1g');
      expect(DEFAULT_CONFIG.resourceLimits.cpu).toBe('1.0');
      expect(DEFAULT_CONFIG.timeout).toBe(300000); // 5 minutes
      expect(DEFAULT_CONFIG.cleanupRetries).toBe(3);
      expect(DEFAULT_CONFIG.cleanupRetryDelay).toBe(1000); // 1 second
      expect(DEFAULT_CONFIG.pullTimeout).toBe(120000); // 2 minutes
    });

    it('should not have imageRegistry by default', () => {
      expect(DEFAULT_CONFIG.imageRegistry).toBeUndefined();
    });
  });

  describe('loadConfiguration', () => {
    it('should return default configuration when no environment variables are set', () => {
      const config = loadConfiguration();
      
      expect(config.defaultImage).toBe('node:20-alpine');
      expect(config.networkMode).toBe('none');
      expect(config.resourceLimits.memory).toBe('1g');
      expect(config.resourceLimits.cpu).toBe('1.0');
      expect(config.timeout).toBe(300000);
      expect(config.cleanupRetries).toBe(3);
      expect(config.cleanupRetryDelay).toBe(1000);
      expect(config.pullTimeout).toBe(120000);
    });

    it('should override default image from environment variable', () => {
      process.env.DOCKER_TEST_IMAGE = 'node:18-alpine';
      
      const config = loadConfiguration();
      
      expect(config.defaultImage).toBe('node:18-alpine');
    });

    it('should set image registry from environment variable', () => {
      process.env.DOCKER_TEST_REGISTRY = 'registry.example.com';
      
      const config = loadConfiguration();
      
      expect(config.imageRegistry).toBe('registry.example.com');
    });

    it('should override network mode from environment variable', () => {
      process.env.DOCKER_TEST_NETWORK_MODE = 'bridge';
      
      const config = loadConfiguration();
      
      expect(config.networkMode).toBe('bridge');
    });

    it('should override memory limit from environment variable', () => {
      process.env.DOCKER_TEST_MEMORY_LIMIT = '2g';
      
      const config = loadConfiguration();
      
      expect(config.resourceLimits.memory).toBe('2g');
    });

    it('should override CPU limit from environment variable', () => {
      process.env.DOCKER_TEST_CPU_LIMIT = '2.0';
      
      const config = loadConfiguration();
      
      expect(config.resourceLimits.cpu).toBe('2.0');
    });

    it('should override timeout from environment variable', () => {
      process.env.DOCKER_TEST_TIMEOUT = '600000';
      
      const config = loadConfiguration();
      
      expect(config.timeout).toBe(600000);
    });

    it('should override cleanup retries from environment variable', () => {
      process.env.DOCKER_TEST_CLEANUP_RETRIES = '5';
      
      const config = loadConfiguration();
      
      expect(config.cleanupRetries).toBe(5);
    });

    it('should override cleanup retry delay from environment variable', () => {
      process.env.DOCKER_TEST_CLEANUP_RETRY_DELAY = '2000';
      
      const config = loadConfiguration();
      
      expect(config.cleanupRetryDelay).toBe(2000);
    });

    it('should override pull timeout from environment variable', () => {
      process.env.DOCKER_TEST_PULL_TIMEOUT = '180000';
      
      const config = loadConfiguration();
      
      expect(config.pullTimeout).toBe(180000);
    });

    it('should override multiple values from environment variables', () => {
      process.env.DOCKER_TEST_IMAGE = 'node:18';
      process.env.DOCKER_TEST_NETWORK_MODE = 'host';
      process.env.DOCKER_TEST_MEMORY_LIMIT = '512m';
      process.env.DOCKER_TEST_TIMEOUT = '180000';
      
      const config = loadConfiguration();
      
      expect(config.defaultImage).toBe('node:18');
      expect(config.networkMode).toBe('host');
      expect(config.resourceLimits.memory).toBe('512m');
      expect(config.timeout).toBe(180000);
    });

    it('should trim whitespace from string values', () => {
      process.env.DOCKER_TEST_IMAGE = '  node:20-alpine  ';
      process.env.DOCKER_TEST_REGISTRY = '  registry.example.com  ';
      
      const config = loadConfiguration();
      
      expect(config.defaultImage).toBe('node:20-alpine');
      expect(config.imageRegistry).toBe('registry.example.com');
    });
  });

  describe('Configuration Validation', () => {
    describe('Image Name Validation', () => {
      it('should use default when empty image name is provided', () => {
        process.env.DOCKER_TEST_IMAGE = '';
        
        const config = loadConfiguration();
        expect(config.defaultImage).toBe('node:20-alpine'); // Falls back to default
      });

      it('should use default when image name with only whitespace is provided', () => {
        process.env.DOCKER_TEST_IMAGE = '   ';
        
        const config = loadConfiguration();
        expect(config.defaultImage).toBe('node:20-alpine'); // Falls back to default
      });

      it('should reject image name with invalid characters', () => {
        process.env.DOCKER_TEST_IMAGE = 'node:20<alpine>';
        
        expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
        expect(() => loadConfiguration()).toThrow('Contains invalid characters');
      });

      it('should accept valid image names', () => {
        const validNames = [
          'node:20-alpine',
          'node:18',
          'custom/image:latest',
          'registry.example.com/namespace/image:tag',
        ];

        validNames.forEach(name => {
          process.env.DOCKER_TEST_IMAGE = name;
          expect(() => loadConfiguration()).not.toThrow();
        });
      });
    });

    describe('Network Mode Validation', () => {
      it('should reject invalid network mode', () => {
        process.env.DOCKER_TEST_NETWORK_MODE = 'invalid';
        
        expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
        expect(() => loadConfiguration()).toThrow('Invalid network mode');
      });

      it('should accept valid network modes', () => {
        const validModes = ['none', 'bridge', 'host'];

        validModes.forEach(mode => {
          process.env.DOCKER_TEST_NETWORK_MODE = mode;
          expect(() => loadConfiguration()).not.toThrow();
        });
      });
    });

    describe('Memory Limit Validation', () => {
      it('should use default for invalid memory limit format', () => {
        const invalidFormats = ['1gb', '512', 'invalid', '1.5g'];

        invalidFormats.forEach(format => {
          // Clear all env vars before each test
          Object.keys(process.env).forEach(key => {
            if (key.startsWith('DOCKER_TEST_')) {
              delete process.env[key];
            }
          });
          
          process.env.DOCKER_TEST_MEMORY_LIMIT = format;
          expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
        });
        
        // Clear all env vars
        Object.keys(process.env).forEach(key => {
          if (key.startsWith('DOCKER_TEST_')) {
            delete process.env[key];
          }
        });
        
        // Empty string should fall back to default
        process.env.DOCKER_TEST_MEMORY_LIMIT = '';
        const config = loadConfiguration();
        expect(config.resourceLimits.memory).toBe('1g');
      });

      it('should accept valid memory limit formats', () => {
        const validFormats = ['512m', '1g', '2G', '256k', '4K'];

        validFormats.forEach(format => {
          process.env.DOCKER_TEST_MEMORY_LIMIT = format;
          expect(() => loadConfiguration()).not.toThrow();
        });
      });
    });

    describe('CPU Limit Validation', () => {
      it('should reject invalid CPU limit', () => {
        const invalidLimits = ['invalid', '-1'];

        invalidLimits.forEach(limit => {
          // Clear all env vars before each test
          Object.keys(process.env).forEach(key => {
            if (key.startsWith('DOCKER_TEST_')) {
              delete process.env[key];
            }
          });
          
          process.env.DOCKER_TEST_CPU_LIMIT = limit;
          expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
        });
        
        // Clear all env vars
        Object.keys(process.env).forEach(key => {
          if (key.startsWith('DOCKER_TEST_')) {
            delete process.env[key];
          }
        });
        
        // Empty string and '0' should fall back to default
        process.env.DOCKER_TEST_CPU_LIMIT = '';
        const config = loadConfiguration();
        expect(config.resourceLimits.cpu).toBe('1.0');
        
        process.env.DOCKER_TEST_CPU_LIMIT = '0';
        expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
      });

      it('should accept valid CPU limits', () => {
        const validLimits = ['0.5', '1.0', '2.0', '4', '0.25'];

        validLimits.forEach(limit => {
          process.env.DOCKER_TEST_CPU_LIMIT = limit;
          expect(() => loadConfiguration()).not.toThrow();
        });
      });
    });

    describe('Timeout Validation', () => {
      it('should reject invalid timeout values', () => {
        const invalidTimeouts = ['invalid', '-1', '0'];

        invalidTimeouts.forEach(timeout => {
          process.env.DOCKER_TEST_TIMEOUT = timeout;
          expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
        });
        
        // '1.5' should be parsed as 1 (parseInt truncates)
        process.env.DOCKER_TEST_TIMEOUT = '1.5';
        const config = loadConfiguration();
        expect(config.timeout).toBe(1);
      });

      it('should accept valid timeout values', () => {
        const validTimeouts = ['1000', '60000', '300000', '600000'];

        validTimeouts.forEach(timeout => {
          process.env.DOCKER_TEST_TIMEOUT = timeout;
          expect(() => loadConfiguration()).not.toThrow();
        });
      });
    });

    describe('Cleanup Retries Validation', () => {
      it('should reject invalid retry counts', () => {
        const invalidCounts = ['invalid', '-1'];

        invalidCounts.forEach(count => {
          process.env.DOCKER_TEST_CLEANUP_RETRIES = count;
          expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
        });
        
        // '1.5' should be parsed as 1 (parseInt truncates)
        process.env.DOCKER_TEST_CLEANUP_RETRIES = '1.5';
        const config = loadConfiguration();
        expect(config.cleanupRetries).toBe(1);
      });

      it('should accept valid retry counts including zero', () => {
        const validCounts = ['0', '1', '3', '5', '10'];

        validCounts.forEach(count => {
          process.env.DOCKER_TEST_CLEANUP_RETRIES = count;
          expect(() => loadConfiguration()).not.toThrow();
        });
      });
    });

    describe('Pull Timeout Validation', () => {
      it('should reject invalid pull timeout values', () => {
        const invalidTimeouts = ['invalid', '-1', '0'];

        invalidTimeouts.forEach(timeout => {
          process.env.DOCKER_TEST_PULL_TIMEOUT = timeout;
          expect(() => loadConfiguration()).toThrow(ConfigurationValidationError);
        });
        
        // '1.5' should be parsed as 1 (parseInt truncates)
        process.env.DOCKER_TEST_PULL_TIMEOUT = '1.5';
        const config = loadConfiguration();
        expect(config.pullTimeout).toBe(1);
      });

      it('should accept valid pull timeout values', () => {
        const validTimeouts = ['60000', '120000', '180000', '300000'];

        validTimeouts.forEach(timeout => {
          process.env.DOCKER_TEST_PULL_TIMEOUT = timeout;
          expect(() => loadConfiguration()).not.toThrow();
        });
      });
    });
  });

  describe('validateConfiguration', () => {
    it('should validate a valid configuration without throwing', () => {
      const validConfig = { ...DEFAULT_CONFIG };
      
      expect(() => validateConfiguration(validConfig)).not.toThrow();
    });

    it('should throw for invalid image name', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        defaultImage: '',
      };
      
      expect(() => validateConfiguration(invalidConfig)).toThrow(ConfigurationValidationError);
    });

    it('should throw for invalid network mode', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        networkMode: 'invalid' as unknown as typeof DEFAULT_CONFIG.networkMode,
      };
      
      expect(() => validateConfiguration(invalidConfig)).toThrow(ConfigurationValidationError);
    });

    it('should throw for invalid memory limit', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        resourceLimits: {
          ...DEFAULT_CONFIG.resourceLimits,
          memory: 'invalid',
        },
      };
      
      expect(() => validateConfiguration(invalidConfig)).toThrow(ConfigurationValidationError);
    });

    it('should throw for invalid CPU limit', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        resourceLimits: {
          ...DEFAULT_CONFIG.resourceLimits,
          cpu: '-1',
        },
      };
      
      expect(() => validateConfiguration(invalidConfig)).toThrow(ConfigurationValidationError);
    });

    it('should throw for invalid timeout', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        timeout: -1,
      };
      
      expect(() => validateConfiguration(invalidConfig)).toThrow(ConfigurationValidationError);
    });

    it('should throw for invalid cleanup retries', () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        cleanupRetries: -1,
      };
      
      expect(() => validateConfiguration(invalidConfig)).toThrow(ConfigurationValidationError);
    });
  });

  describe('getConfiguration', () => {
    it('should return the same result as loadConfiguration', () => {
      const config1 = getConfiguration();
      const config2 = loadConfiguration();
      
      expect(config1).toEqual(config2);
    });

    it('should reflect environment variable changes', () => {
      process.env.DOCKER_TEST_IMAGE = 'node:18';
      const config1 = getConfiguration();
      
      process.env.DOCKER_TEST_IMAGE = 'node:20';
      const config2 = getConfiguration();
      
      expect(config1.defaultImage).toBe('node:18');
      expect(config2.defaultImage).toBe('node:20');
    });
  });

  describe('ConfigurationValidationError', () => {
    it('should include field name in error', () => {
      const error = new ConfigurationValidationError('Test error', 'testField');
      
      expect(error.message).toBe('Test error');
      expect(error.field).toBe('testField');
      expect(error.name).toBe('ConfigurationValidationError');
    });

    it('should be instanceof Error', () => {
      const error = new ConfigurationValidationError('Test error', 'testField');
      
      expect(error).toBeInstanceOf(Error);
    });
  });
});
