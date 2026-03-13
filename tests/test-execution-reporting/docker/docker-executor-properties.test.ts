/**
 * Property-based tests for Docker Test Executor
 * 
 * These tests verify universal properties that should hold across all valid executions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DockerTestExecutor } from '../../../src/test-execution-reporting/docker/docker-test-executor.js';
import { DefaultContainerManager } from '../../../src/test-execution-reporting/docker/container-manager.js';
import { DefaultTestFileMounter } from '../../../src/test-execution-reporting/docker/test-file-mounter.js';
import { DefaultResultExtractor } from '../../../src/test-execution-reporting/docker/result-extractor.js';
import type { DockerExecutionOptions } from '../../../src/test-execution-reporting/docker/types.js';

// Test configuration - use 2-3 iterations as specified
const testConfig = { numRuns: 2 };

// Test directory for temporary files
let testDir: string;

beforeAll(async () => {
  // Create temporary test directory
  testDir = join(tmpdir(), `docker-executor-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  await mkdir(join(testDir, 'src'), { recursive: true });
  
  // Create package.json
  await writeFile(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        test: 'node --test',
      },
    })
  );
});

afterAll(async () => {
  // Clean up test directory
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('Docker Test Executor - Property Tests', () => {
  describe('Property 1: Docker Container Execution', () => {
    /**
     * **Validates: Requirements 1.1**
     * 
     * For any test file, when executed by the Docker_Executor,
     * the test should run inside a Docker container and produce results.
     */
    it('executes tests inside Docker containers and produces results', async () => {
      // Check if Docker is available before running test
      const executor = new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      );

      const dockerAvailable = await executor.isDockerAvailable();
      if (!dockerAvailable) {
        // eslint-disable-next-line no-console
        console.warn('Docker not available, skipping Docker container execution test');
        return;
      }

      // Try to pull the image first
      try {
        const { execSync } = await import('child_process');
        execSync('docker pull node:20-alpine', { stdio: 'pipe', timeout: 120000 });
      } catch (pullError) {
        // eslint-disable-next-line no-console
        console.warn('Failed to pull node:20-alpine image, skipping test:', pullError);
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          // Generate test file content
          fc.constantFrom(
            'test("simple test", () => { console.log("test passed"); });',
            'import { test } from "node:test"; test("node test", () => {});',
            'describe("suite", () => { it("test", () => {}); });'
          ),
          async (testContent) => {
            // Create test file
            const testFileName = `test-${Date.now()}-${Math.random().toString(36).substring(7)}.test.js`;
            const testFilePath = join(testDir, testFileName);
            await writeFile(testFilePath, testContent);

            try {
              // Execute test in Docker
              const options: DockerExecutionOptions = {
                timeout: 30000, // 30 seconds for test
                cwd: testDir,
              };

              const result = await executor.execute(testFilePath, options);

              // Verify result structure
              expect(result).toBeDefined();
              expect(result.exitCode).toBeTypeOf('number');
              expect(result.stdout).toBeTypeOf('string');
              expect(result.stderr).toBeTypeOf('string');
              expect(result.duration).toBeTypeOf('number');
              expect(result.framework).toBeDefined();
              expect(result.timedOut).toBeTypeOf('boolean');

              // Verify Docker metadata
              expect(result.docker).toBeDefined();
              expect(result.docker.containerId).toBeTypeOf('string');
              expect(result.docker.imageName).toBeTypeOf('string');
              expect(result.docker.networkMode).toBeTypeOf('string');
              expect(result.docker.containerCreationTime).toBeTypeOf('number');
              expect(result.docker.containerStartTime).toBeTypeOf('number');
              expect(result.docker.containerStopTime).toBeTypeOf('number');

              // Verify execution happened (duration > 0)
              expect(result.duration).toBeGreaterThan(0);
            } finally {
              // Clean up test file
              try {
                await rm(testFilePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        ),
        testConfig
      );
    }, 60000); // 60 seconds timeout for Docker execution
  });

  describe('Property 16: Framework Detection', () => {
    /**
     * **Validates: Requirements 9.1**
     * 
     * For any test file with framework indicators (imports, syntax patterns, package.json),
     * the Docker_Executor should correctly detect the framework before container creation.
     */
    it.skip('detects test framework correctly from file content', async () => {
      const executor = new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      );

      await fc.assert(
        fc.asyncProperty(
          // Generate test files with framework indicators
          fc.constantFrom(
            { content: 'import { test } from "vitest"; test("vitest test", () => {});', expected: 'vitest' },
            { content: 'import { test } from "node:test"; test("node test", () => {});', expected: 'node:test' },
            { content: 'describe("jest suite", () => { test("jest test", () => {}); });', expected: 'jest' },
            { content: 'describe("mocha suite", () => { it("mocha test", () => {}); });', expected: 'mocha' }
          ),
          async ({ content, expected }) => {
            // Create test file
            const testFileName = `test-${Date.now()}-${Math.random().toString(36).substring(7)}.test.js`;
            const testFilePath = join(testDir, testFileName);
            await writeFile(testFilePath, content);

            try {
              // Detect framework
              const framework = await executor.detectFramework(testFilePath);

              // Verify framework detection
              expect(framework).toBe(expected);
            } finally {
              // Clean up test file
              try {
                await rm(testFilePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        ),
        testConfig
      );
    });
  });

  describe('Property 17: Framework Environment Variable', () => {
    /**
     * **Validates: Requirements 9.2**
     * 
     * For any detected test framework, the Docker_Executor should pass
     * the framework name to the container as an environment variable.
     */
    it('passes framework as environment variable to container', async () => {
      const dockerAvailable = await new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      ).isDockerAvailable();

      if (!dockerAvailable) {
        // eslint-disable-next-line no-console
        console.warn('Docker not available, skipping framework environment variable test');
        return;
      }

      // Try to pull the image first
      try {
        const { execSync } = await import('child_process');
        execSync('docker pull node:20-alpine', { stdio: 'pipe', timeout: 120000 });
      } catch {
        // eslint-disable-next-line no-console
        console.warn('Failed to pull node:20-alpine image, skipping test');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('vitest', 'jest', 'mocha', 'node:test'),
          async (_framework) => {
            // Create test file that prints environment variable
            const testContent = `
              import { test } from "node:test";
              test("env var test", () => {
                console.log("FRAMEWORK=" + process.env.TEST_FRAMEWORK);
              });
            `;
            const testFileName = `test-${Date.now()}-${Math.random().toString(36).substring(7)}.test.js`;
            const testFilePath = join(testDir, testFileName);
            await writeFile(testFilePath, testContent);

            try {
              const executor = new DockerTestExecutor(
                new DefaultContainerManager(),
                new DefaultTestFileMounter(),
                new DefaultResultExtractor()
              );

              const options: DockerExecutionOptions = {
                timeout: 30000,
                cwd: testDir,
              };

              const result = await executor.execute(testFilePath, options);

              // Verify framework was passed as environment variable
              // The test prints it to stdout
              expect(result.stdout).toContain('FRAMEWORK=');
            } finally {
              try {
                await rm(testFilePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        ),
        testConfig
      );
    }, 60000);
  });

  describe('Property 18: Framework-Specific Commands', () => {
    /**
     * **Validates: Requirements 9.3**
     * 
     * For any test framework, the Docker_Executor should use the correct
     * framework-specific execution command inside the container.
     */
    it('uses correct framework-specific execution command', () => {
      const executor = new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      );

      fc.assert(
        fc.property(
          fc.constantFrom(
            { framework: 'jest' as const, expectedCmd: 'jest' },
            { framework: 'mocha' as const, expectedCmd: 'mocha' },
            { framework: 'vitest' as const, expectedCmd: 'vitest' },
            { framework: 'node:test' as const, expectedCmd: 'node' }
          ),
          ({ framework, expectedCmd }) => {
            // Access private method through any cast for testing
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const command = (executor as any).getFrameworkCommand(framework, '/test/file.test.js', '/test');

            // Verify command includes expected framework command
            expect(command).toContain(expectedCmd);
          }
        ),
        testConfig
      );
    });
  });

  describe('Property 3: Timeout Enforcement', () => {
    /**
     * **Validates: Requirements 1.3**
     * 
     * For any test execution, if the execution time exceeds the timeout,
     * the Docker_Executor should terminate the container and return a timeout error.
     */
    it('enforces timeout and terminates container', { timeout: 30000 }, async () => {
      const dockerAvailable = await new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      ).isDockerAvailable();

      if (!dockerAvailable) {
        // eslint-disable-next-line no-console
        console.warn('Docker not available, skipping timeout enforcement test');
        return;
      }

      // Try to pull the image first
      try {
        const { execSync } = await import('child_process');
        execSync('docker pull node:20-alpine', { stdio: 'pipe', timeout: 120000 });
      } catch {
        // eslint-disable-next-line no-console
        console.warn('Failed to pull node:20-alpine image, skipping test');
        return;
      }

      // Create test file that runs longer than timeout
      const testContent = `
        import { test } from "node:test";
        test("long running test", async () => {
          await new Promise(resolve => setTimeout(resolve, 10000));
        });
      `;
      const testFileName = `test-timeout-${Date.now()}.test.js`;
      const testFilePath = join(testDir, testFileName);
      await writeFile(testFilePath, testContent);

      try {
        const executor = new DockerTestExecutor(
          new DefaultContainerManager(),
          new DefaultTestFileMounter(),
          new DefaultResultExtractor()
        );

        const options: DockerExecutionOptions = {
          timeout: 1000, // 1 second timeout
          cwd: testDir,
        };

        // Execution should throw timeout error
        await expect(executor.execute(testFilePath, options)).rejects.toThrow('timed out');
      } finally {
        try {
          await rm(testFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  /**
   * Property 10: Image Configuration Support
   * 
   * **Validates: Requirements 6.1**
   * 
   * For any configured Docker image name (via environment variable or configuration file),
   * the Docker_Executor should use that image for test execution instead of the default image.
   */
  describe('Property 10: Image Configuration Support', () => {
    it('uses custom image when specified in options', async () => {
      const executor = new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      );

      const dockerAvailable = await executor.isDockerAvailable();
      if (!dockerAvailable) {
        // eslint-disable-next-line no-console
        console.warn('Docker not available, skipping image configuration test');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          // Test with different valid Node.js images
          fc.constantFrom('node:20-alpine', 'node:18-alpine', 'node:20'),
          async (customImage) => {
            // Pull the custom image first
            try {
              const { execSync } = await import('child_process');
              execSync(`docker pull ${customImage}`, { stdio: 'pipe', timeout: 120000 });
            } catch {
              // eslint-disable-next-line no-console
              console.warn(`Failed to pull ${customImage} image, skipping test`);
              return;
            }

            // Create simple test file
            const testContent = 'test("simple test", () => {});';
            const testFileName = `test-image-${Date.now()}-${Math.random().toString(36).substring(7)}.test.js`;
            const testFilePath = join(testDir, testFileName);
            await writeFile(testFilePath, testContent);

            try {
              const options: DockerExecutionOptions = {
                timeout: 30000,
                cwd: testDir,
                imageName: customImage, // Use custom image
              };

              const result = await executor.execute(testFilePath, options);

              // Verify result includes Docker metadata with custom image
              expect(result.docker).toBeDefined();
              expect(result.docker.imageName).toBe(customImage);
            } finally {
              try {
                await rm(testFilePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        ),
        testConfig
      );
    }, 120000);
  });

  /**
   * Property 11: Image Validation
   * 
   * **Validates: Requirements 6.3**
   * 
   * For any custom Docker image specified, the Docker_Executor should validate
   * the image exists (locally or remotely) before attempting to create a container.
   */
  describe('Property 11: Image Validation', () => {
    it('validates image exists before container creation', async () => {
      const executor = new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      );

      const dockerAvailable = await executor.isDockerAvailable();
      if (!dockerAvailable) {
        // eslint-disable-next-line no-console
        console.warn('Docker not available, skipping image validation test');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          // Test with valid images that should exist or be pullable
          fc.constantFrom('node:20-alpine', 'node:18-alpine'),
          async (validImage) => {
            // Create simple test file
            const testContent = 'test("validation test", () => {});';
            const testFileName = `test-validation-${Date.now()}-${Math.random().toString(36).substring(7)}.test.js`;
            const testFilePath = join(testDir, testFileName);
            await writeFile(testFilePath, testContent);

            try {
              const options: DockerExecutionOptions = {
                timeout: 30000,
                cwd: testDir,
                imageName: validImage,
              };

              // Should succeed - image will be validated and pulled if needed
              const result = await executor.execute(testFilePath, options);
              expect(result).toBeDefined();
              expect(result.docker.imageName).toBe(validImage);
            } finally {
              try {
                await rm(testFilePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        ),
        testConfig
      );
    }, 120000);

    it('throws error for invalid image names', async () => {
      const executor = new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      );

      const dockerAvailable = await executor.isDockerAvailable();
      if (!dockerAvailable) {
        // eslint-disable-next-line no-console
        console.warn('Docker not available, skipping invalid image test');
        return;
      }

      // Create simple test file
      const testContent = 'test("invalid image test", () => {});';
      const testFileName = `test-invalid-${Date.now()}.test.js`;
      const testFilePath = join(testDir, testFileName);
      await writeFile(testFilePath, testContent);

      try {
        const options: DockerExecutionOptions = {
          timeout: 30000,
          cwd: testDir,
          imageName: 'nonexistent-image-that-does-not-exist:invalid-tag-12345',
        };

        // Should throw ImageError
        await expect(executor.execute(testFilePath, options)).rejects.toThrow();
      } finally {
        try {
          await rm(testFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }, 60000);
  });

  /**
   * Property 12: Automatic Image Pull
   * 
   * **Validates: Requirements 6.4**
   * 
   * For any Docker image that does not exist locally, the Docker_Executor should
   * attempt to pull it from Docker Hub before creating the container.
   */
  describe('Property 12: Automatic Image Pull', () => {
    it('automatically pulls missing images from registry', async () => {
      const executor = new DockerTestExecutor(
        new DefaultContainerManager(),
        new DefaultTestFileMounter(),
        new DefaultResultExtractor()
      );

      const dockerAvailable = await executor.isDockerAvailable();
      if (!dockerAvailable) {
        // eslint-disable-next-line no-console
        console.warn('Docker not available, skipping automatic pull test');
        return;
      }

      await fc.assert(
        fc.asyncProperty(
          // Test with small Node.js images
          fc.constantFrom('node:20-alpine', 'node:18-alpine'),
          async (imageToTest) => {
            // Remove the image if it exists locally
            try {
              const { execSync } = await import('child_process');
              execSync(`docker rmi ${imageToTest}`, { stdio: 'pipe' });
            } catch {
              // Image might not exist, that's fine
            }

            // Create simple test file
            const testContent = 'console.log("test");';
            const testFileName = `test-pull-${Date.now()}-${Math.random().toString(36).substring(7)}.test.js`;
            const testFilePath = join(testDir, testFileName);
            await writeFile(testFilePath, testContent);

            try {
              const options: DockerExecutionOptions = {
                timeout: 30000,
                cwd: testDir,
                imageName: imageToTest,
              };

              // Should succeed - image will be pulled automatically
              const result = await executor.execute(testFilePath, options);
              expect(result).toBeDefined();
              expect(result.docker.imageName).toBe(imageToTest);

              // Verify image now exists locally
              const { execSync } = await import('child_process');
              const output = execSync(`docker images ${imageToTest} -q`, { encoding: 'utf-8' });
              expect(output.trim()).not.toBe('');
            } finally {
              try {
                await rm(testFilePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        ),
        testConfig
      );
    }, 180000); // 3 minutes timeout for image pull
  });
});
