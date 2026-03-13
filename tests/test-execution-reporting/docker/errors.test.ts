/**
 * Unit tests for Docker error handling
 * 
 * Tests all Docker-specific error classes and their formatting
 */

import { describe, it, expect } from 'vitest';
import {
  DockerError,
  DockerUnavailableError,
  ImagePullError,
  ImageError,
  ContainerCreationError,
  ContainerStartError,
  ContainerExecutionError,
  MountValidationError,
  CleanupError,
  ResultExtractionError,
  NetworkConfigurationError,
} from '../../../src/test-execution-reporting/docker/errors.js';

describe('Docker Error Classes', () => {
  describe('DockerError (base class)', () => {
    it('should create error with category and troubleshooting', () => {
      const error = new DockerError(
        'Test error message',
        'Test Category',
        ['Step 1', 'Step 2']
      );

      expect(error.message).toBe('Test error message');
      expect(error.category).toBe('Test Category');
      expect(error.troubleshooting).toEqual(['Step 1', 'Step 2']);
      expect(error.name).toBe('DockerError');
    });

    it('should format detailed message with troubleshooting steps', () => {
      const error = new DockerError(
        'Test error',
        'Test Category',
        ['Fix step 1', 'Fix step 2']
      );

      const detailed = error.toDetailedMessage();
      
      expect(detailed).toContain('[DOCKER ERROR: Test Category]');
      expect(detailed).toContain('Test error');
      expect(detailed).toContain('Troubleshooting:');
      expect(detailed).toContain('- Fix step 1');
      expect(detailed).toContain('- Fix step 2');
    });
  });

  describe('DockerUnavailableError', () => {
    it('should create error for Docker not installed', () => {
      const error = new DockerUnavailableError(
        'Docker is not installed',
        'not_installed'
      );

      expect(error.message).toBe('Docker is not installed');
      expect(error.reason).toBe('not_installed');
      expect(error.category).toBe('Docker Unavailable');
      expect(error.troubleshooting).toContain('Install Docker Desktop from https://www.docker.com/products/docker-desktop');
    });

    it('should create error for Docker not running', () => {
      const error = new DockerUnavailableError(
        'Docker daemon is not running',
        'not_running'
      );

      expect(error.message).toBe('Docker daemon is not running');
      expect(error.reason).toBe('not_running');
      expect(error.troubleshooting).toContain('Start Docker Desktop application');
    });
  });

  describe('ImagePullError', () => {
    it('should create error with image name and details', () => {
      const error = new ImagePullError(
        'Failed to pull image',
        'node:20-alpine',
        { timeout: 120000 }
      );

      expect(error.message).toBe('Failed to pull image');
      expect(error.imageName).toBe('node:20-alpine');
      expect(error.details).toEqual({ timeout: 120000 });
      expect(error.category).toBe('Image Pull Failed');
      expect(error.troubleshooting).toContain('Check your internet connection');
      expect(error.troubleshooting).toContain('Try pulling the image manually: docker pull node:20-alpine');
    });
  });

  describe('ImageError', () => {
    it('should create error for pull operation', () => {
      const error = new ImageError(
        'Pull failed',
        'myimage:latest',
        'pull'
      );

      expect(error.imageName).toBe('myimage:latest');
      expect(error.operation).toBe('pull');
      expect(error.troubleshooting).toContain('Check your internet connection');
    });

    it('should create error for not_found operation', () => {
      const error = new ImageError(
        'Image not found',
        'missing:latest',
        'not_found'
      );

      expect(error.operation).toBe('not_found');
      expect(error.troubleshooting).toContain('Verify the image name is correct');
    });

    it('should create error for validate operation', () => {
      const error = new ImageError(
        'Invalid image name',
        'bad-image',
        'validate'
      );

      expect(error.operation).toBe('validate');
      expect(error.troubleshooting).toContain('Verify the image name format is correct');
    });
  });

  describe('ContainerCreationError', () => {
    it('should create error for resource limit', () => {
      const error = new ContainerCreationError(
        'Insufficient memory',
        'resource_limit',
        { memory: '8g' }
      );

      expect(error.reason).toBe('resource_limit');
      expect(error.details).toEqual({ memory: '8g' });
      expect(error.troubleshooting).toContain('Free up system resources (stop other containers or applications)');
    });

    it('should create error for invalid config', () => {
      const error = new ContainerCreationError(
        'Invalid network mode',
        'invalid_config',
        { field: 'networkMode' }
      );

      expect(error.reason).toBe('invalid_config');
      expect(error.troubleshooting).toContain('Verify mount paths exist and are accessible');
    });

    it('should create error for permission denied', () => {
      const error = new ContainerCreationError(
        'Permission denied',
        'permission_denied'
      );

      expect(error.reason).toBe('permission_denied');
      expect(error.troubleshooting).toContain('Run Docker with appropriate permissions');
    });

    it('should create error for unknown reason', () => {
      const error = new ContainerCreationError(
        'Unknown error',
        'unknown'
      );

      expect(error.reason).toBe('unknown');
      expect(error.troubleshooting).toContain('Check Docker daemon logs for details');
    });
  });

  describe('ContainerStartError', () => {
    it('should create error with container ID', () => {
      const error = new ContainerStartError(
        'Failed to start',
        'abc123',
        { reason: 'invalid command' }
      );

      expect(error.containerId).toBe('abc123');
      expect(error.details).toEqual({ reason: 'invalid command' });
      expect(error.troubleshooting).toContain('Inspect container: docker inspect abc123');
    });
  });

  describe('ContainerExecutionError', () => {
    it('should create error for timeout', () => {
      const error = new ContainerExecutionError(
        'Execution timed out',
        'abc123',
        124,
        true
      );

      expect(error.containerId).toBe('abc123');
      expect(error.exitCode).toBe(124);
      expect(error.timedOut).toBe(true);
      expect(error.troubleshooting).toContain('Test execution exceeded 5-minute timeout');
    });

    it('should create error for non-zero exit code', () => {
      const error = new ContainerExecutionError(
        'Test failed',
        'abc123',
        1,
        false
      );

      expect(error.exitCode).toBe(1);
      expect(error.timedOut).toBe(false);
      expect(error.troubleshooting).toContain('Test execution failed with exit code: 1');
    });
  });

  describe('MountValidationError', () => {
    it('should create error for not_found paths', () => {
      const error = new MountValidationError(
        'Paths not found',
        ['/missing/path1', '/missing/path2'],
        'not_found'
      );

      expect(error.invalidPaths).toEqual(['/missing/path1', '/missing/path2']);
      expect(error.reason).toBe('not_found');
      expect(error.troubleshooting).toContain('Verify all file paths exist');
    });

    it('should create error for no_permission', () => {
      const error = new MountValidationError(
        'Permission denied',
        ['/restricted/path'],
        'no_permission'
      );

      expect(error.reason).toBe('no_permission');
      expect(error.troubleshooting).toContain('Check file permissions');
    });

    it('should create error for invalid_path', () => {
      const error = new MountValidationError(
        'Invalid path format',
        ['/bad/../path'],
        'invalid_path'
      );

      expect(error.reason).toBe('invalid_path');
      expect(error.troubleshooting).toContain('Verify paths are absolute or properly resolved');
    });
  });

  describe('CleanupError', () => {
    it('should create error with attempt count', () => {
      const lastError = new Error('Container locked');
      const error = new CleanupError(
        'Cleanup failed',
        'abc123',
        3,
        lastError
      );

      expect(error.containerId).toBe('abc123');
      expect(error.attemptCount).toBe(3);
      expect(error.lastError).toBe(lastError);
      expect(error.troubleshooting).toContain('Failed to clean up container after 3 attempts');
      expect(error.troubleshooting).toContain('Manually stop container: docker stop abc123');
    });
  });

  describe('ResultExtractionError', () => {
    it('should create error for logs operation', () => {
      const error = new ResultExtractionError(
        'Failed to get logs',
        'abc123',
        'logs'
      );

      expect(error.containerId).toBe('abc123');
      expect(error.operation).toBe('logs');
      expect(error.troubleshooting).toContain('Try viewing logs manually: docker logs abc123');
    });

    it('should create error for exit_code operation', () => {
      const error = new ResultExtractionError(
        'Failed to get exit code',
        'abc123',
        'exit_code'
      );

      expect(error.operation).toBe('exit_code');
      expect(error.troubleshooting).toContain('Inspect container: docker inspect abc123');
    });

    it('should create error for inspect operation', () => {
      const error = new ResultExtractionError(
        'Failed to inspect',
        'abc123',
        'inspect'
      );

      expect(error.operation).toBe('inspect');
      expect(error.troubleshooting).toContain('Container inspection failed');
    });
  });

  describe('NetworkConfigurationError', () => {
    it('should create error with network mode', () => {
      const error = new NetworkConfigurationError(
        'Invalid network mode',
        'invalid-mode'
      );

      expect(error.networkMode).toBe('invalid-mode');
      expect(error.troubleshooting).toContain('Valid network modes: none, bridge, host');
    });
  });
});
