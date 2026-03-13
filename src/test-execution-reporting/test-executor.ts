/**
 * Test Executor Component
 * 
 * Responsible for executing test files and capturing raw output.
 * 
 * Features:
 * - Framework detection (Jest, Mocha, Vitest, Node.js test runner)
 * - Timeout enforcement (5 minutes default)
 * - Read-only execution (no file modifications)
 * - Temporary file tracking and cleanup
 * - Comprehensive error categorization
 */

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { spawn } from 'child_process';
import type { TestExecutor, ExecutionOptions, RawTestResult, TestFramework } from './types.js';

export class DefaultTestExecutor implements TestExecutor {
  private temporaryFiles: Set<string> = new Set();

  async execute(testFilePath: string, options: ExecutionOptions): Promise<RawTestResult> {
    const startTime = Date.now();
    const framework = await this.detectFramework(testFilePath);

    // Create AbortController for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, options.timeout);

    let stdout = '';
    let stderr = '';
    let exitCode: number;
    const state = { timedOut: false }; // Wrapper to avoid TypeScript flow analysis warning

    try {
      exitCode = 0; // Default exit code

      // Check for environment prerequisites before execution
      await this.validateEnvironment(framework);

      // Validate test file exists and is readable (read-only check)
      await this.validateTestFile(testFilePath);

      // Determine the command and arguments based on framework
      const { command, args } = this.getExecutionCommand(framework, testFilePath);

      // Spawn the test process
      const childProcess = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        signal: abortController.signal,
        shell: true,
      });

      // Capture stdout
      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      // Capture stderr
      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for process to complete
      exitCode = await new Promise<number>((resolve, reject) => {
        childProcess.on('close', (code) => {
          resolve(code ?? 0);
        });

        childProcess.on('error', (error) => {
          // Check if error is due to abort (timeout)
          if (error.name === 'AbortError') {
            state.timedOut = true;
            resolve(1); // Non-zero exit code for timeout
          } else {
            reject(error);
          }
        });

        // Handle abort signal
        abortController.signal.addEventListener('abort', () => {
          state.timedOut = true;
          childProcess.kill('SIGTERM');
          // Give process time to terminate gracefully, then force kill
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 1000);
        });
      });

      // Categorize errors from stderr
      if (exitCode !== 0 && stderr) {
        stderr = this.categorizeError(stderr);
      }
    } catch (error) {
      // Handle execution errors with detailed categorization
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = this.identifyErrorType(errorMessage, stderr);

      stderr += `\n[${errorType.toUpperCase()} ERROR] ${errorMessage}`;
      exitCode = 1;
    } finally {
      clearTimeout(timeoutId);
      // Clean up all temporary files after execution completes
      await this.cleanupTemporaryFiles();
    }

    const duration = Date.now() - startTime;

    return {
      exitCode,
      stdout,
      stderr,
      duration,
      framework,
      timedOut: state.timedOut,
      timestamp: startTime,
    };
  }

  /**
   * Track a temporary file for cleanup
   * @param filePath - Path to temporary file
   */
  private trackTemporaryFile(filePath: string): void {
    this.temporaryFiles.add(filePath);
  }

  /**
   * Clean up all tracked temporary files
   * Handles cleanup errors gracefully without throwing
   */
  private async cleanupTemporaryFiles(): Promise<void> {
    if (this.temporaryFiles.size === 0) {
      return;
    }

    const cleanupPromises = Array.from(this.temporaryFiles).map(async (filePath) => {
      try {
        const { unlink, access } = await import('fs/promises');
        // Check if file exists before attempting to delete
        await access(filePath);
        await unlink(filePath);
      } catch (error) {
        // Log cleanup error but don't throw - cleanup errors should not fail execution
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Only log if it's not a "file not found" error (file may have been cleaned up already)
        if (!errorMessage.includes('ENOENT')) {
          // eslint-disable-next-line no-console
          console.warn(`Warning: Failed to clean up temporary file ${filePath}: ${errorMessage}`);
        }
      }
    });

    // Wait for all cleanup operations to complete
    await Promise.all(cleanupPromises);

    // Clear the set after cleanup
    this.temporaryFiles.clear();
  }

  /**
   * Validate environment has required tools installed
   * @param framework - Test framework to validate
   * @throws Error if environment is missing required tools
   */
  private async validateEnvironment(framework: TestFramework): Promise<void> {
    // Check Node.js is available
    try {
      const { execSync } = await import('child_process');
      execSync('node --version', { stdio: 'pipe' });
    } catch {
      throw new Error('ENVIRONMENT_ERROR: Node.js is not installed or not in PATH. Please install Node.js to run tests.', { cause: 'node_missing' });
    }

    // Check npm is available for frameworks that need it
    if (framework !== 'node:test' && framework !== 'unknown') {
      try {
        const { execSync } = await import('child_process');
        execSync('npm --version', { stdio: 'pipe' });
      } catch {
        throw new Error('ENVIRONMENT_ERROR: npm is not installed or not in PATH. Please install npm to run tests with ' + framework + '.', { cause: 'npm_missing' });
      }
    }

    // Check if test framework is installed (for non-default frameworks)
    if (framework !== 'node:test' && framework !== 'unknown') {
      try {
        const { execSync } = await import('child_process');
        // Try to get framework version to verify it's installed
        const frameworkCommand = framework === 'jest' ? 'jest --version' :
                                 framework === 'mocha' ? 'mocha --version' :
                                 framework === 'vitest' ? 'vitest --version' : '';

        if (frameworkCommand) {
          execSync(`npx ${frameworkCommand}`, { stdio: 'pipe', timeout: 5000 });
        }
      } catch {
        throw new Error(`ENVIRONMENT_ERROR: Test framework '${framework}' is not installed. Please run 'npm install ${framework}' to install it.`, { cause: 'framework_missing' });
      }
    }
  }

  /**
   * Validate test file exists and is readable (read-only validation)
   * @param testFilePath - Path to test file
   * @throws Error if test file is not accessible
   */
  private async validateTestFile(testFilePath: string): Promise<void> {
    try {
      const { access, constants } = await import('fs/promises');
      // Check file exists and is readable (read-only check)
      await access(testFilePath, constants.R_OK);

      // Read file to check for syntax errors
      const content = await readFile(testFilePath, 'utf-8');

      // Basic syntax validation - check for common syntax errors
      if (content.trim().length === 0) {
        throw new Error('SYNTAX_ERROR: Test file is empty', { cause: 'empty_file' });
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('SYNTAX_ERROR')) {
          throw error;
        }
        if (error.message.includes('ENOENT')) {
          throw new Error(`SYNTAX_ERROR: Test file not found: ${testFilePath}`, { cause: error });
        }
        if (error.message.includes('EACCES')) {
          throw new Error(`ENVIRONMENT_ERROR: No read permission for test file: ${testFilePath}`, { cause: error });
        }
      }
      throw new Error(`ENVIRONMENT_ERROR: Cannot access test file: ${testFilePath}`, { cause: error });
    }
  }

  /**
   * Identify error type from error message
   * @param errorMessage - Error message
   * @param stderr - Standard error output
   * @returns Error type identifier
   */
  private identifyErrorType(errorMessage: string, stderr: string): string {
    const combinedError = (errorMessage + ' ' + stderr).toLowerCase();

    // Check for environment errors
    if (combinedError.includes('environment_error') ||
        combinedError.includes('not installed') ||
        combinedError.includes('not in path') ||
        combinedError.includes('command not found') ||
        combinedError.includes('enoent') ||
        combinedError.includes('eacces')) {
      return 'environment';
    }

    // Check for syntax errors
    if (combinedError.includes('syntax_error') ||
        combinedError.includes('syntaxerror') ||
        combinedError.includes('unexpected token') ||
        combinedError.includes('unexpected identifier') ||
        combinedError.includes('parsing error') ||
        combinedError.includes('parse error')) {
      return 'syntax';
    }

    // Check for dependency errors
    if (combinedError.includes('cannot find module') ||
        combinedError.includes('module_not_found') ||
        combinedError.includes('module not found') ||
        combinedError.includes('missing dependency') ||
        combinedError.includes('err_module_not_found')) {
      return 'dependency';
    }

    // Default to runtime error
    return 'runtime';
  }

  /**
   * Categorize and enhance error messages in stderr
   * @param stderr - Standard error output
   * @returns Categorized error output
   */
  private categorizeError(stderr: string): string {
    const errorType = this.identifyErrorType('', stderr);

    // Add error type prefix if not already present
    if (!stderr.includes('[') || !stderr.includes('ERROR]')) {
      return `[${errorType.toUpperCase()} ERROR]\n${stderr}`;
    }

    return stderr;
  }

  /**
   * Get the execution command and arguments for a given framework
   * @param framework - Test framework
   * @param testFilePath - Path to the test file
   * @returns Command and arguments
   */
  private getExecutionCommand(framework: TestFramework, testFilePath: string): { command: string; args: string[] } {
    switch (framework) {
      case 'jest':
        return {
          command: 'npx',
          args: ['jest', testFilePath, '--no-coverage'],
        };
      case 'mocha':
        return {
          command: 'npx',
          args: ['mocha', testFilePath],
        };
      case 'vitest':
        return {
          command: 'npx',
          args: ['vitest', 'run', testFilePath],
        };
      case 'node:test':
        return {
          command: 'node',
          args: ['--test', testFilePath],
        };
      case 'unknown':
      default:
        // Default to Node.js test runner
        return {
          command: 'node',
          args: ['--test', testFilePath],
        };
    }
  }

  /**
   * Detect the test framework from package.json or file syntax
   * @param testFilePath - Path to the test file
   * @returns Detected framework name
   */
  async detectFramework(testFilePath: string): Promise<TestFramework> {
    // Try to detect from package.json first
    const frameworkFromPackage = await this.detectFromPackageJson(testFilePath);
    if (frameworkFromPackage !== 'unknown') {
      return frameworkFromPackage;
    }

    // Fall back to detecting from test file syntax
    const frameworkFromSyntax = await this.detectFromFileSyntax(testFilePath);
    if (frameworkFromSyntax !== 'unknown') {
      return frameworkFromSyntax;
    }

    // Default to Node.js test runner when detection fails
    return 'node:test';
  }

  /**
   * Detect framework from package.json test script
   * @param testFilePath - Path to the test file
   * @returns Detected framework or 'unknown'
   */
  private async detectFromPackageJson(testFilePath: string): Promise<TestFramework> {
    try {
      // Find package.json by traversing up from test file directory
      const packageJsonPath = await this.findPackageJson(testFilePath);
      if (!packageJsonPath) {
        return 'unknown';
      }

      const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      // Check test script for framework indicators
      const testScript = packageJson.scripts?.test || '';

      if (testScript.includes('jest')) {
        return 'jest';
      }
      if (testScript.includes('mocha')) {
        return 'mocha';
      }
      if (testScript.includes('vitest')) {
        return 'vitest';
      }
      if (testScript.includes('node --test') || testScript.includes('node:test')) {
        return 'node:test';
      }

      // Check devDependencies for framework packages
      const devDeps = packageJson.devDependencies || {};
      const deps = packageJson.dependencies || {};
      const allDeps = { ...devDeps, ...deps };

      if (allDeps.jest) {
        return 'jest';
      }
      if (allDeps.mocha) {
        return 'mocha';
      }
      if (allDeps.vitest) {
        return 'vitest';
      }

      return 'unknown';
    } catch {
      // If we can't read or parse package.json, return unknown
      return 'unknown';
    }
  }

  /**
   * Detect framework from test file syntax
   * @param testFilePath - Path to the test file
   * @returns Detected framework or 'unknown'
   */
  private async detectFromFileSyntax(testFilePath: string): Promise<TestFramework> {
    try {
      const fileContent = await readFile(testFilePath, 'utf-8');

      // Check for framework-specific imports first (most specific to least specific)

      // Vitest patterns - check before Jest since both use describe/test
      if (
        fileContent.includes("from 'vitest'") ||
        fileContent.includes('from "vitest"') ||
        fileContent.includes("import { test") && fileContent.includes("from 'vitest'") ||
        fileContent.includes("import { describe") && fileContent.includes("from 'vitest'") ||
        fileContent.includes('vi.') ||
        fileContent.includes('vitest.')
      ) {
        return 'vitest';
      }

      // Node.js test runner patterns - check before Jest/Mocha
      if (
        fileContent.includes("from 'node:test'") ||
        fileContent.includes('from "node:test"') ||
        fileContent.includes("require('node:test')") ||
        fileContent.includes('require("node:test")') ||
        fileContent.includes("import test from 'node:test'") ||
        fileContent.includes('import { test } from \'node:test\'')
      ) {
        return 'node:test';
      }

      // Jest patterns - explicit imports or jest-specific usage
      if (
        fileContent.includes("from 'jest'") ||
        fileContent.includes('from "jest"') ||
        fileContent.includes("require('jest')") ||
        fileContent.includes('require("jest")') ||
        fileContent.includes('jest.') ||
        fileContent.includes('@jest/')
      ) {
        return 'jest';
      }

      // Mocha patterns - explicit imports or mocha-specific usage
      if (
        fileContent.includes("from 'mocha'") ||
        fileContent.includes('from "mocha"') ||
        fileContent.includes("require('mocha')") ||
        fileContent.includes('require("mocha")')
      ) {
        return 'mocha';
      }

      // Generic patterns - check last as they're ambiguous
      // Jest uses describe + test
      if (fileContent.includes('describe(') && fileContent.includes('test(')) {
        return 'jest';
      }

      // Mocha uses describe + it
      if (fileContent.includes('describe(') && fileContent.includes('it(')) {
        return 'mocha';
      }

      return 'unknown';
    } catch {
      // If we can't read the file, return unknown
      return 'unknown';
    }
  }

  /**
   * Find package.json by traversing up from test file directory
   * @param testFilePath - Path to the test file
   * @returns Path to package.json or null if not found
   */
  private async findPackageJson(testFilePath: string): Promise<string | null> {
    let currentDir = dirname(resolve(testFilePath));
    const root = resolve('/');

    while (currentDir !== root) {
      const packageJsonPath = resolve(currentDir, 'package.json');
      try {
        await readFile(packageJsonPath, 'utf-8');
        return packageJsonPath;
      } catch {
        // package.json not found in this directory, try parent
        const parentDir = dirname(currentDir);
        if (parentDir === currentDir) {
          // Reached the root
          break;
        }
        currentDir = parentDir;
      }
    }

    return null;
  }
}

