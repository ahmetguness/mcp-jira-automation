/**
 * Property-based tests for TestFileMounter
 * 
 * Feature: docker-test-execution-reporting
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { mkdir, writeFile, rm, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DefaultTestFileMounter } from '../../../src/test-execution-reporting/docker/test-file-mounter.js';
import type { Mount } from '../../../src/test-execution-reporting/docker/types.js';

describe('TestFileMounter Properties', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(async () => {
    // Cleanup all temporary directories
    for (const dir of tempDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    tempDirs = [];
  });

  /**
   * Helper to create a temporary project structure
   */
  async function createProjectStructure(options: {
    hasSrc: boolean;
    hasNodeModules: boolean;
    hasPackageJson: boolean;
    hasConfigFiles: string[];
    testFilePath: string;
  }): Promise<string> {
    const tempDir = join(tmpdir(), `test-mounter-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await mkdir(tempDir, { recursive: true });
    tempDirs.push(tempDir);

    // Create src directory if needed
    if (options.hasSrc) {
      const srcDir = join(tempDir, 'src');
      await mkdir(srcDir);
      await writeFile(join(srcDir, 'index.ts'), 'export const foo = "bar";');
    }

    // Create node_modules if needed
    if (options.hasNodeModules) {
      const nodeModulesDir = join(tempDir, 'node_modules');
      await mkdir(nodeModulesDir);
      await writeFile(join(nodeModulesDir, 'package.json'), '{}');
    }

    // Create package.json if needed
    if (options.hasPackageJson) {
      await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
    }

    // Create config files if needed
    for (const configFile of options.hasConfigFiles) {
      await writeFile(join(tempDir, configFile), 'export default {}');
    }

    // Create test file
    const testFilePath = join(tempDir, options.testFilePath);
    const testFileDir = join(tempDir, options.testFilePath.split('/').slice(0, -1).join('/'));
    if (testFileDir !== tempDir) {
      await mkdir(testFileDir, { recursive: true });
    }
    await writeFile(testFilePath, 'test("example", () => {});');

    return tempDir;
  }

  /**
   * Helper to verify a mount is accessible
   */
  async function verifyMountAccessible(mount: Mount): Promise<boolean> {
    try {
      await access(mount.hostPath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Property 4: Complete File Mounting
   * 
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   * 
   * For any test execution, the Test_File_Mounter should mount all required files 
   * (test file, node_modules, source code, package.json, config files) into the 
   * container as read-only, and all mounted files should be accessible inside the 
   * container.
   */
  describe('Property 4: Complete File Mounting', () => {
    it('should mount all required files as read-only and accessible', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            hasSrc: fc.boolean(),
            hasNodeModules: fc.boolean(),
            hasPackageJson: fc.boolean(),
            hasConfigFiles: fc.subarray([
              'vitest.config.ts',
              'vitest.config.js',
              'jest.config.js',
              'jest.config.ts',
              '.mocharc.json',
              '.mocharc.js',
            ]),
            testFilePath: fc.constantFrom(
              'test.test.ts',
              'tests/example.test.ts',
              'tests/unit/example.test.ts'
            ),
          }),
          async (testCase) => {
            // Create project structure
            const projectRoot = await createProjectStructure(testCase);
            const testFilePath = join(projectRoot, testCase.testFilePath);

            // Generate mounts
            const mounter = new DefaultTestFileMounter();
            const mounts = await mounter.generateMounts(testFilePath, projectRoot);

            // Verify test file is always mounted
            const testFileMount = mounts.find(m => m.hostPath === testFilePath);
            expect(testFileMount).toBeDefined();
            expect(testFileMount?.readOnly).toBe(true);
            expect(await verifyMountAccessible(testFileMount!)).toBe(true);

            // Verify src directory is mounted if it exists
            if (testCase.hasSrc) {
              const srcMount = mounts.find(m => m.containerPath === '/workspace/src');
              expect(srcMount).toBeDefined();
              expect(srcMount?.readOnly).toBe(true);
              expect(await verifyMountAccessible(srcMount!)).toBe(true);
            }

            // Verify node_modules is mounted if it exists
            if (testCase.hasNodeModules) {
              const nodeModulesMount = mounts.find(m => m.containerPath === '/workspace/node_modules');
              expect(nodeModulesMount).toBeDefined();
              expect(nodeModulesMount?.readOnly).toBe(true);
              expect(await verifyMountAccessible(nodeModulesMount!)).toBe(true);
            }

            // Verify package.json is mounted if it exists
            if (testCase.hasPackageJson) {
              const packageJsonMount = mounts.find(m => m.containerPath === '/workspace/package.json');
              expect(packageJsonMount).toBeDefined();
              expect(packageJsonMount?.readOnly).toBe(true);
              expect(await verifyMountAccessible(packageJsonMount!)).toBe(true);
            }

            // Verify config files are mounted if they exist
            for (const configFile of testCase.hasConfigFiles) {
              const configMount = mounts.find(m => m.containerPath === `/workspace/${configFile}`);
              expect(configMount).toBeDefined();
              expect(configMount?.readOnly).toBe(true);
              expect(await verifyMountAccessible(configMount!)).toBe(true);
            }

            // Verify all mounts are read-only
            expect(mounts.every(m => m.readOnly)).toBe(true);

            // Verify all mounts are accessible
            const accessibilityResults = await Promise.all(
              mounts.map(m => verifyMountAccessible(m))
            );
            expect(accessibilityResults.every(result => result)).toBe(true);

            // Verify mounts can be validated without errors
            await expect(mounter.validateMounts(mounts)).resolves.not.toThrow();
          }
        ),
        { numRuns: 3 }
      );
    }, 60000);

    it('should mount test files in subdirectories with correct container paths', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            testFilePath: fc.constantFrom(
              'test.test.ts',
              'tests/example.test.ts',
              'tests/unit/example.test.ts',
              'tests/integration/api/example.test.ts'
            ),
          }),
          async (testCase) => {
            // Create minimal project structure
            const projectRoot = await createProjectStructure({
              hasSrc: false,
              hasNodeModules: false,
              hasPackageJson: false,
              hasConfigFiles: [],
              testFilePath: testCase.testFilePath,
            });
            const testFilePath = join(projectRoot, testCase.testFilePath);

            // Generate mounts
            const mounter = new DefaultTestFileMounter();
            const mounts = await mounter.generateMounts(testFilePath, projectRoot);

            // Verify test file mount preserves directory structure
            const testFileMount = mounts.find(m => m.hostPath === testFilePath);
            expect(testFileMount).toBeDefined();
            
            // Container path should preserve the relative path structure
            const expectedContainerPath = `/workspace/${testCase.testFilePath.replace(/\\/g, '/')}`;
            expect(testFileMount?.containerPath).toBe(expectedContainerPath);
            expect(testFileMount?.readOnly).toBe(true);
            expect(await verifyMountAccessible(testFileMount!)).toBe(true);
          }
        ),
        { numRuns: 3 }
      );
    }, 60000);

    it('should handle projects with all possible files present', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            testFilePath: fc.constantFrom('test.test.ts', 'tests/example.test.ts'),
          }),
          async (testCase) => {
            // Create complete project structure with all files
            const projectRoot = await createProjectStructure({
              hasSrc: true,
              hasNodeModules: true,
              hasPackageJson: true,
              hasConfigFiles: [
                'vitest.config.ts',
                'jest.config.js',
                '.mocharc.json',
              ],
              testFilePath: testCase.testFilePath,
            });
            const testFilePath = join(projectRoot, testCase.testFilePath);

            // Generate mounts
            const mounter = new DefaultTestFileMounter();
            const mounts = await mounter.generateMounts(testFilePath, projectRoot);

            // Should have at least 6 mounts:
            // 1. test file
            // 2. src directory
            // 3. node_modules
            // 4. package.json
            // 5-7. config files (3 of them)
            expect(mounts.length).toBeGreaterThanOrEqual(6);

            // Verify all mounts are read-only
            expect(mounts.every(m => m.readOnly)).toBe(true);

            // Verify all mounts are accessible
            const accessibilityResults = await Promise.all(
              mounts.map(m => verifyMountAccessible(m))
            );
            expect(accessibilityResults.every(result => result)).toBe(true);

            // Verify validation passes
            await expect(mounter.validateMounts(mounts)).resolves.not.toThrow();
          }
        ),
        { numRuns: 2 }
      );
    }, 60000);

    it('should handle projects with minimal files (only test file)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            testFilePath: fc.constantFrom('test.test.ts', 'example.test.js'),
          }),
          async (testCase) => {
            // Create minimal project structure with only test file
            const projectRoot = await createProjectStructure({
              hasSrc: false,
              hasNodeModules: false,
              hasPackageJson: false,
              hasConfigFiles: [],
              testFilePath: testCase.testFilePath,
            });
            const testFilePath = join(projectRoot, testCase.testFilePath);

            // Generate mounts
            const mounter = new DefaultTestFileMounter();
            const mounts = await mounter.generateMounts(testFilePath, projectRoot);

            // Should have exactly 1 mount (test file only)
            expect(mounts.length).toBe(1);

            // Verify test file mount
            const testFileMount = mounts[0];
            expect(testFileMount?.hostPath).toBe(testFilePath);
            expect(testFileMount?.readOnly).toBe(true);
            expect(await verifyMountAccessible(testFileMount!)).toBe(true);

            // Verify validation passes
            await expect(mounter.validateMounts(mounts)).resolves.not.toThrow();
          }
        ),
        { numRuns: 2 }
      );
    }, 60000);
  });
});
