/**
 * Container Manager for Docker Test Execution
 * 
 * Manages Docker container lifecycle: create, start, stop, remove, cleanup
 */

import Docker from 'dockerode';
import type { ContainerManager, ContainerConfig, NetworkMode } from './types.js';
import {
  ContainerCreationError,
  ContainerStartError,
  CleanupError,
  ImageError,
  ImagePullError,
} from './errors.js';
import { createLogger } from '../../logger.js';

const log = createLogger('docker:container-manager');

/**
 * Default implementation of ContainerManager using dockerode
 */
export class DefaultContainerManager implements ContainerManager {
  private docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker();
  }

  /**
   * Create a Docker container for test execution
   */
  async createContainer(config: ContainerConfig): Promise<string> {
    try {
      // Validate configuration
      this.validateConfig(config);

      // Ensure image exists locally (pull if needed)
      await this.ensureImage(config.imageName);

      // Log warning if network is enabled
      if (config.networkMode !== 'none') {
        log.warn('Container created with network access enabled', {
          networkMode: config.networkMode,
          imageName: config.imageName,
        });
      }

      // Prepare container creation options
      const createOptions: Docker.ContainerCreateOptions = {
        Image: config.imageName,
        Cmd: config.command,
        WorkingDir: config.workingDir,
        Env: config.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`) : undefined,
        HostConfig: {
          Binds: config.mounts.map(m => 
            `${m.hostPath}:${m.containerPath}${m.readOnly ? ':ro' : ''}`
          ),
          NetworkMode: config.networkMode,
          Memory: config.memoryLimit ? this.parseMemoryLimit(config.memoryLimit) : undefined,
          NanoCpus: config.cpuLimit ? this.parseCpuLimit(config.cpuLimit) : undefined,
        },
      };

      // Create container
      const container = await this.docker.createContainer(createOptions);
      return container.id;
    } catch (error) {
      throw this.handleCreationError(error, config);
    }
  }
  /**
   * Ensure Docker image exists locally, pull if not found
   * @param imageName - Docker image name
   * @param pullTimeout - Timeout for pull operation in milliseconds (default: 2 minutes)
   */
  async ensureImage(imageName: string, pullTimeout: number = 120000): Promise<void> {
    try {
      // Check if image exists locally
      log.debug('Checking if image exists locally', { imageName });
      await this.docker.getImage(imageName).inspect();
      log.debug('Image found locally', { imageName });
    } catch (error) {
      // Image not found locally, attempt to pull
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) {
        log.info('Image not found locally, pulling from registry', { imageName });

        try {
          await this.pullImage(imageName, pullTimeout);
          log.info('Successfully pulled image', { imageName });
        } catch (pullError) {
          const errorMessage = pullError instanceof Error ? pullError.message : String(pullError);
          log.error('Failed to pull image', {
            imageName,
            error: errorMessage,
            pullTimeout,
          });
          
          throw new ImagePullError(
            `Failed to pull image ${imageName}: ${errorMessage}`,
            imageName,
            { originalError: pullError, timeout: pullTimeout }
          );
        }
      } else {
        // Other error during image inspection
        throw new ImageError(
          `Failed to validate image ${imageName}: ${error instanceof Error ? error.message : String(error)}`,
          imageName,
          'validate'
        );
      }
    }
  }

  /**
   * Pull Docker image from registry
   * @param imageName - Docker image name
   * @param timeout - Timeout in milliseconds
   */
  private async pullImage(imageName: string, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        reject(new Error(`Image pull timed out after ${timeout}ms`));
      }, timeout);

      // Start pull operation
      void this.docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          clearTimeout(timeoutId);
          return reject(err);
        }

        // Follow progress until completion
        this.docker.modem.followProgress(
          stream,
          (progressErr: Error | null) => {
            clearTimeout(timeoutId);
            if (progressErr) {
              return reject(progressErr);
            }
            resolve();
          },
          (event: { status?: string; progress?: string }) => {
            // Log progress events
            if (event.status) {
              log.debug('Pull progress', { imageName, status: event.status, progress: event.progress });
            }
          }
        );
      });
    });
  }

  /**
   * Start a Docker container
   */
  async startContainer(containerId: string): Promise<void> {
    try {
      log.debug('Starting container', { containerId });
      const container = this.docker.getContainer(containerId);
      await container.start();
      log.info('Container started successfully', { containerId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Failed to start container', {
        containerId,
        error: errorMessage,
      });
      
      throw new ContainerStartError(
        `Failed to start container ${containerId}: ${errorMessage}`,
        containerId,
        { originalError: error }
      );
    }
  }

  /**
   * Stop a Docker container with graceful shutdown and force kill fallback
   */
  async stopContainer(containerId: string, timeout: number = 10): Promise<void> {
    try {
      log.debug('Stopping container', { containerId, timeout });
      const container = this.docker.getContainer(containerId);
      
      // Try graceful stop first (sends SIGTERM)
      await container.stop({ t: timeout });
      log.info('Container stopped gracefully', { containerId });
    } catch (error) {
      // If container is already stopped, that's fine
      if (error instanceof Error && error.message.includes('is not running')) {
        log.debug('Container already stopped', { containerId });
        return;
      }
      
      // For other errors, try force kill
      log.warn('Graceful stop failed, attempting force kill', {
        containerId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      try {
        const container = this.docker.getContainer(containerId);
        await container.kill();
        log.info('Container force killed', { containerId });
      } catch (killError) {
        // If kill also fails and container is not running, that's fine
        if (killError instanceof Error && killError.message.includes('is not running')) {
          log.debug('Container already stopped during force kill', { containerId });
          return;
        }
        
        log.error('Failed to force kill container', {
          containerId,
          error: killError instanceof Error ? killError.message : String(killError),
        });
        throw killError;
      }
    }
  }

  /**
   * Remove a Docker container
   */
  async removeContainer(containerId: string, force: boolean = true): Promise<void> {
    try {
      log.debug('Removing container', { containerId, force });
      const container = this.docker.getContainer(containerId);
      await container.remove({ force });
      log.info('Container removed successfully', { containerId });
    } catch (error) {
      // If container doesn't exist, that's fine
      if (error instanceof Error && error.message.includes('No such container')) {
        log.debug('Container already removed', { containerId });
        return;
      }
      
      log.error('Failed to remove container', {
        containerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clean up container (stop + remove with retry logic)
   */
  async cleanup(containerId: string, maxRetries: number = 3): Promise<void> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Stop container
        await this.stopContainer(containerId);
        
        // Remove container
        await this.removeContainer(containerId, true);
        
        // Success!
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Log cleanup failure for debugging
        log.error(lastError, {
          containerId,
          attempt,
          maxRetries,
        });
        
        // Wait before retry (exponential backoff: 1s, 2s, 4s)
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          log.error(`Retrying cleanup in ${delay}ms`, { delay });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries exhausted - log final failure
    log.error(lastError || new Error('Cleanup failed'), {
      containerId,
      maxRetries,
    });
    
    throw new CleanupError(
      `Failed to clean up container ${containerId} after ${maxRetries} attempts`,
      containerId,
      maxRetries,
      lastError
    );
  }

  /**
   * Wait for container to complete execution
   */
  async waitForContainer(containerId: string, timeout: number): Promise<number> {
    const container = this.docker.getContainer(containerId);
    
    // Create a promise that resolves when container exits
    const waitPromise = container.wait();
    
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Container execution timed out after ${timeout}ms`));
      }, timeout);
    });
    
    try {
      // Race between container completion and timeout
      const result = await Promise.race([waitPromise, timeoutPromise]);
      return result.StatusCode ?? 1;
    } catch (error) {
      // If timeout occurred, force stop the container
      if (error instanceof Error && error.message.includes('timed out')) {
        await this.stopContainer(containerId, 0); // Force kill immediately
        throw error;
      }
      throw error;
    }
  }

  /**
   * Validate container configuration
   */
  private validateConfig(config: ContainerConfig): void {
    // Validate image name
    if (!config.imageName || config.imageName.trim() === '') {
      throw new ContainerCreationError(
        'Image name is required',
        'invalid_config',
        { field: 'imageName' }
      );
    }

    // Validate command
    if (!config.command || config.command.length === 0) {
      throw new ContainerCreationError(
        'Command is required',
        'invalid_config',
        { field: 'command' }
      );
    }

    // Validate network mode
    const validNetworkModes: NetworkMode[] = ['none', 'bridge', 'host'];
    if (!validNetworkModes.includes(config.networkMode)) {
      throw new ContainerCreationError(
        `Invalid network mode: ${config.networkMode}. Must be one of: ${validNetworkModes.join(', ')}`,
        'invalid_config',
        { field: 'networkMode', value: config.networkMode }
      );
    }

    // Validate mounts
    if (!config.mounts || config.mounts.length === 0) {
      throw new ContainerCreationError(
        'At least one mount is required',
        'invalid_config',
        { field: 'mounts' }
      );
    }

    for (const mount of config.mounts) {
      if (!mount.hostPath || !mount.containerPath) {
        throw new ContainerCreationError(
          'Mount paths cannot be empty',
          'invalid_config',
          { field: 'mounts', mount }
        );
      }
    }
  }

  /**
   * Parse memory limit string to bytes
   */
  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)(m|g|k)?$/i);
    if (!match) {
      throw new ContainerCreationError(
        `Invalid memory limit format: ${limit}. Expected format: 512m, 1g, etc.`,
        'invalid_config',
        { field: 'memoryLimit', value: limit }
      );
    }

    const value = parseInt(match[1] ?? '0', 10);
    const unit = match[2] ? match[2].toLowerCase() : '';

    switch (unit) {
      case 'k':
        return value * 1024;
      case 'm':
        return value * 1024 * 1024;
      case 'g':
        return value * 1024 * 1024 * 1024;
      default:
        return value;
    }
  }

  /**
   * Parse CPU limit string to nano CPUs
   */
  private parseCpuLimit(limit: string): number {
    const value = parseFloat(limit);
    if (isNaN(value) || value <= 0) {
      throw new ContainerCreationError(
        `Invalid CPU limit format: ${limit}. Expected format: 0.5, 1.0, 2.0, etc.`,
        'invalid_config',
        { field: 'cpuLimit', value: limit }
      );
    }

    // Convert to nano CPUs (1 CPU = 1e9 nano CPUs)
    return Math.floor(value * 1e9);
  }

  /**
   * Handle container creation errors
   */
  private handleCreationError(error: unknown, config: ContainerConfig): ContainerCreationError {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for specific error types
    if (errorMessage.includes('No such image')) {
      return new ContainerCreationError(
        `Image not found: ${config.imageName}`,
        'invalid_config',
        { imageName: config.imageName, originalError: error }
      );
    }

    if (errorMessage.includes('permission denied') || errorMessage.includes('EACCES')) {
      return new ContainerCreationError(
        'Permission denied when creating container',
        'permission_denied',
        { originalError: error }
      );
    }

    if (errorMessage.includes('insufficient') || errorMessage.includes('resource')) {
      return new ContainerCreationError(
        'Insufficient resources to create container',
        'resource_limit',
        { originalError: error }
      );
    }

    // Generic error
    return new ContainerCreationError(
      `Failed to create container: ${errorMessage}`,
      'unknown',
      { originalError: error }
    );
  }
}
