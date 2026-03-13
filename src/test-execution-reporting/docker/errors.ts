/**
 * Docker-specific error classes for test execution
 * 
 * These errors provide detailed information about Docker-related failures
 * and include troubleshooting guidance for users.
 */

/**
 * Base class for all Docker-related errors
 */
export class DockerError extends Error {
  constructor(
    message: string,
    public readonly category: string,
    public readonly troubleshooting: string[]
  ) {
    super(message);
    this.name = 'DockerError';
    Object.setPrototypeOf(this, DockerError.prototype);
  }

  /**
   * Format error as a detailed message with troubleshooting steps
   */
  toDetailedMessage(): string {
    const lines = [
      `[DOCKER ERROR: ${this.category}]`,
      this.message,
      '',
      'Troubleshooting:',
      ...this.troubleshooting.map(step => `- ${step}`),
    ];
    return lines.join('\n');
  }
}

/**
 * Error thrown when Docker is not installed or not running
 */
export class DockerUnavailableError extends DockerError {
  constructor(message: string, public readonly reason: 'not_installed' | 'not_running') {
    const troubleshooting =
      reason === 'not_installed'
        ? [
            'Install Docker Desktop from https://www.docker.com/products/docker-desktop',
            'Verify installation by running: docker --version',
            'Restart your terminal after installation',
          ]
        : [
            'Start Docker Desktop application',
            'Wait for Docker daemon to be ready (check system tray icon)',
            'Verify Docker is running: docker ps',
          ];

    super(message, 'Docker Unavailable', troubleshooting);
    this.name = 'DockerUnavailableError';
    Object.setPrototypeOf(this, DockerUnavailableError.prototype);
  }
}

/**
 * Error thrown when Docker image pull operation fails
 */
export class ImagePullError extends DockerError {
  constructor(
    message: string,
    public readonly imageName: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(
      message,
      'Image Pull Failed',
      [
        'Check your internet connection',
        'Verify the image name is correct: ' + imageName,
        'Try pulling the image manually: docker pull ' + imageName,
        'Check if you need authentication for private registries',
        'Verify the image exists on Docker Hub or your registry',
        'Check Docker Hub rate limits (may need authentication)',
      ]
    );
    this.name = 'ImagePullError';
    Object.setPrototypeOf(this, ImagePullError.prototype);
  }
}

/**
 * Error thrown when Docker image operations fail
 */
export class ImageError extends DockerError {
  constructor(
    message: string,
    public readonly imageName: string,
    public readonly operation: 'pull' | 'validate' | 'not_found'
  ) {
    const troubleshooting =
      operation === 'pull'
        ? [
            'Check your internet connection',
            'Verify the image name is correct',
            'Try pulling the image manually: docker pull ' + imageName,
            'Check if you need authentication for private registries',
          ]
        : operation === 'not_found'
          ? [
              'Verify the image name is correct',
              'Pull the image manually: docker pull ' + imageName,
              'Check if the image exists on Docker Hub',
            ]
          : [
              'Verify the image name format is correct',
              'Image name should be in format: [registry/]name[:tag]',
              'Examples: node:20-alpine, myregistry.com/myimage:latest',
            ];

    super(message, 'Image Error', troubleshooting);
    this.name = 'ImageError';
    Object.setPrototypeOf(this, ImageError.prototype);
  }
}

/**
 * Error thrown when container creation fails
 */
export class ContainerCreationError extends DockerError {
  constructor(
    message: string,
    public readonly reason: 'resource_limit' | 'invalid_config' | 'permission_denied' | 'unknown',
    public readonly details?: Record<string, unknown>
  ) {
    const troubleshooting =
      reason === 'resource_limit'
        ? [
            'Free up system resources (stop other containers or applications)',
            'Reduce memory/CPU limits in Docker configuration',
            'Check Docker Desktop resource settings',
          ]
        : reason === 'invalid_config'
          ? [
              'Verify mount paths exist and are accessible',
              'Check network mode is valid (none, bridge, or host)',
              'Validate resource limit format (e.g., "512m", "1g")',
            ]
          : reason === 'permission_denied'
            ? [
                'Run Docker with appropriate permissions',
                'On Linux: Add user to docker group: sudo usermod -aG docker $USER',
                'On Windows/Mac: Check Docker Desktop permissions',
              ]
            : [
                'Check Docker daemon logs for details',
                'Try creating a simple container manually: docker run hello-world',
                'Restart Docker daemon',
              ];

    super(message, 'Container Creation Failed', troubleshooting);
    this.name = 'ContainerCreationError';
    Object.setPrototypeOf(this, ContainerCreationError.prototype);
  }
}

/**
 * Error thrown when container start fails
 */
export class ContainerStartError extends DockerError {
  constructor(
    message: string,
    public readonly containerId: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(
      message,
      'Container Start Failed',
      [
        'Check if the container was created successfully',
        'Verify the container command is valid',
        'Inspect container: docker inspect ' + containerId,
        'Check container logs: docker logs ' + containerId,
      ]
    );
    this.name = 'ContainerStartError';
    Object.setPrototypeOf(this, ContainerStartError.prototype);
  }
}

/**
 * Error thrown when container execution fails or times out
 */
export class ContainerExecutionError extends DockerError {
  constructor(
    message: string,
    public readonly containerId: string,
    public readonly exitCode: number,
    public readonly timedOut: boolean
  ) {
    const troubleshooting = timedOut
      ? [
          'Test execution exceeded 5-minute timeout',
          'Optimize test performance or increase timeout',
          'Check if tests are hanging or waiting for input',
          'Review container logs: docker logs ' + containerId,
        ]
      : [
          'Test execution failed with exit code: ' + exitCode,
          'Check container logs for error details: docker logs ' + containerId,
          'Verify test file syntax and dependencies',
          'Try running tests locally to isolate the issue',
        ];

    super(message, 'Container Execution Failed', troubleshooting);
    this.name = 'ContainerExecutionError';
    Object.setPrototypeOf(this, ContainerExecutionError.prototype);
  }
}

/**
 * Error thrown when mount path validation fails
 */
export class MountValidationError extends DockerError {
  constructor(
    message: string,
    public readonly invalidPaths: string[],
    public readonly reason: 'not_found' | 'no_permission' | 'invalid_path'
  ) {
    const troubleshooting =
      reason === 'not_found'
        ? [
            'Verify all file paths exist',
            'Check for typos in file paths',
            'Ensure files are not deleted or moved',
          ]
        : reason === 'no_permission'
          ? [
              'Check file permissions',
              'Ensure Docker has access to the directories',
              'On Linux: Verify file ownership and permissions',
            ]
          : [
              'Verify paths are absolute or properly resolved',
              'Check for invalid characters in paths',
              'Ensure paths do not contain symbolic links that break in containers',
            ];

    super(message, 'Mount Validation Failed', troubleshooting);
    this.name = 'MountValidationError';
    Object.setPrototypeOf(this, MountValidationError.prototype);
  }
}

/**
 * Error thrown when container cleanup fails
 */
export class CleanupError extends DockerError {
  constructor(
    message: string,
    public readonly containerId: string,
    public readonly attemptCount: number,
    public readonly lastError?: Error
  ) {
    super(
      message,
      'Container Cleanup Failed',
      [
        `Failed to clean up container after ${attemptCount} attempts`,
        'Container may still be running: docker ps -a | grep ' + containerId,
        'Manually stop container: docker stop ' + containerId,
        'Manually remove container: docker rm -f ' + containerId,
        'Check Docker daemon status',
      ]
    );
    this.name = 'CleanupError';
    Object.setPrototypeOf(this, CleanupError.prototype);
  }
}

/**
 * Error thrown when result extraction fails
 */
export class ResultExtractionError extends DockerError {
  constructor(
    message: string,
    public readonly containerId: string,
    public readonly operation: 'logs' | 'exit_code' | 'inspect'
  ) {
    const troubleshooting =
      operation === 'logs'
        ? [
            'Container logs may be incomplete or corrupted',
            'Try viewing logs manually: docker logs ' + containerId,
            'Check if container was removed prematurely',
          ]
        : operation === 'exit_code'
          ? [
              'Container may have been removed before exit code was captured',
              'Inspect container: docker inspect ' + containerId,
              'Check Docker daemon logs',
            ]
          : [
              'Container inspection failed',
              'Container may have been removed',
              'Check if Docker daemon is running',
            ];

    super(message, 'Result Extraction Failed', troubleshooting);
    this.name = 'ResultExtractionError';
    Object.setPrototypeOf(this, ResultExtractionError.prototype);
  }
}

/**
 * Error thrown when network configuration is invalid
 */
export class NetworkConfigurationError extends DockerError {
  constructor(
    message: string,
    public readonly networkMode: string
  ) {
    super(
      message,
      'Network Configuration Invalid',
      [
        'Valid network modes: none, bridge, host',
        'Default is "none" for security (no network access)',
        'Use "bridge" for standard network access',
        'Use "host" only when necessary (shares host network)',
      ]
    );
    this.name = 'NetworkConfigurationError';
    Object.setPrototypeOf(this, NetworkConfigurationError.prototype);
  }
}
