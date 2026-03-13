/**
 * Docker Test Executor
 * 
 * Orchestrates Docker-based test execution by coordinating:
 * - Container lifecycle management
 * - Test file mounting
 * - Result extraction
 * - Framework detection
 * 
 * Implements the TestExecutor interface for seamless integration with
 * the existing test-execution-reporting pipeline.
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import type {
  DockerTestExecutor as IDockerTestExecutor,
  DockerExecutionOptions,
  DockerRawTestResult,
  ContainerManager,
  TestFileMounter,
  ResultExtractor,
  ContainerConfig,
} from './types.js';
import type { TestFramework } from '../types.js';
import { DefaultTestExecutor } from '../test-executor.js';
import { DockerUnavailableError } from './errors.js';
import { createLogger } from '../../logger.js';

const log = createLogger('docker:executor');

/**
 * Default Docker configuration
 */
const DEFAULT_CONFIG = {
  imageName: 'node:20-alpine',
  networkMode: 'none' as const,
  timeout: 300000, // 5 minutes
  memoryLimit: '1g',
  cpuLimit: '1.0',
};

/**
 * Docker-based test executor implementation
 */
export class DockerTestExecutor implements IDockerTestExecutor {
  private containerManager: ContainerManager;
  private testFileMounter: TestFileMounter;
  private resultExtractor: ResultExtractor;
  private defaultExecutor: DefaultTestExecutor;

  constructor(
    containerManager: ContainerManager,
    testFileMounter: TestFileMounter,
    resultExtractor: ResultExtractor
  ) {
    this.containerManager = containerManager;
    this.testFileMounter = testFileMounter;
    this.resultExtractor = resultExtractor;
    this.defaultExecutor = new DefaultTestExecutor();
  }

  /**
   * Check if Docker is available and running
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      execSync('docker version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect test framework (delegates to DefaultTestExecutor)
   */
  async detectFramework(testFilePath: string): Promise<TestFramework> {
    return this.defaultExecutor.detectFramework(testFilePath);
  }

  /**
   * Execute a test file inside a Docker container
   */
  async execute(
    testFilePath: string,
    options: DockerExecutionOptions
  ): Promise<DockerRawTestResult> {
    const startTime = Date.now();
    let containerId: string | undefined;
    let containerConfig: ContainerConfig | undefined;

    try {
      // 1. Check Docker availability
      log.debug('Checking Docker availability');
      const dockerAvailable = await this.isDockerAvailable();
      if (!dockerAvailable) {
        log.error('Docker is not available');
        throw new DockerUnavailableError(
          'Docker is not available. Please ensure Docker is installed and running.',
          'not_running'
        );
      }
      log.info('Docker is available');

      // 2. Detect test framework
      log.debug('Detecting test framework', { testFilePath });
      const framework = await this.detectFramework(testFilePath);
      log.info('Detected test framework', { framework, testFilePath });

      // 3. Generate mounts
      const projectRoot = options.cwd || process.cwd();
      log.debug('Generating mounts', { testFilePath, projectRoot });
      const mounts = await this.testFileMounter.generateMounts(testFilePath, projectRoot);
      await this.testFileMounter.validateMounts(mounts);
      log.info('Mounts validated', { mountCount: mounts.length });

      // 4. Build container configuration
      const imageName = options.imageName || DEFAULT_CONFIG.imageName;
      const networkMode = options.networkMode || DEFAULT_CONFIG.networkMode;
      const memoryLimit = options.memoryLimit || DEFAULT_CONFIG.memoryLimit;
      const cpuLimit = options.cpuLimit || DEFAULT_CONFIG.cpuLimit;
      const timeout = options.timeout || DEFAULT_CONFIG.timeout;

      // Get framework-specific command
      const command = this.getFrameworkCommand(framework, testFilePath, projectRoot);

      containerConfig = {
        imageName,
        command,
        workingDir: '/workspace',
        mounts,
        networkMode,
        memoryLimit,
        cpuLimit,
        env: {
          ...options.env,
          TEST_FRAMEWORK: framework,
        },
      };

      log.info('Container configuration prepared', {
        imageName,
        networkMode,
        memoryLimit,
        cpuLimit,
        command: command.join(' '),
      });

      // 5. Create container
      containerId = await this.containerManager.createContainer(containerConfig);
      log.info('Container created', { containerId, imageName });

      // 6. Start container
      await this.containerManager.startContainer(containerId);
      log.info('Container started', { containerId });

      // 7. Wait for container to complete with timeout
      log.debug('Waiting for container to complete', { containerId, timeout });
      const exitCode = await this.containerManager.waitForContainer(containerId, timeout);
      log.info('Container completed', { containerId, exitCode, duration: Date.now() - startTime });

      // 8. Extract results
      log.debug('Extracting results', { containerId });
      const result = await this.resultExtractor.extractResults(
        containerId,
        startTime,
        framework
      );
      log.info('Results extracted successfully', { containerId });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Docker test execution failed', {
        containerId,
        testFilePath,
        error: errorMessage,
        imageName: containerConfig?.imageName,
        networkMode: containerConfig?.networkMode,
        duration: Date.now() - startTime,
      });
      throw error;
    } finally {
      // 9. Cleanup container (always runs)
      if (containerId) {
        try {
          log.debug('Cleaning up container', { containerId });
          await this.containerManager.cleanup(containerId, 3);
          log.info('Container cleaned up', { containerId });
        } catch (cleanupError) {
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          log.error('Container cleanup failed', {
            containerId,
            error: cleanupMessage,
          });
          // Don't throw cleanup errors - execution already completed
        }
      }
    }
  }

  /**
   * Get framework-specific execution command
   */
  private getFrameworkCommand(
    framework: TestFramework,
    testFilePath: string,
    projectRoot: string
  ): string[] {
    // Calculate relative path from project root
    const absoluteTestPath = resolve(testFilePath);
    const absoluteProjectRoot = resolve(projectRoot);
    const relativePath = absoluteTestPath.replace(absoluteProjectRoot, '').replace(/\\/g, '/');
    const containerTestPath = `/workspace${relativePath}`;

    switch (framework) {
      case 'jest':
        return ['npx', 'jest', containerTestPath, '--no-coverage'];
      case 'mocha':
        return ['npx', 'mocha', containerTestPath];
      case 'vitest':
        return ['npx', 'vitest', 'run', containerTestPath];
      case 'node:test':
        return ['node', '--test', containerTestPath];
      case 'unknown':
      default:
        // Default to Node.js test runner
        return ['node', '--test', containerTestPath];
    }
  }
}
