/**
 * Unit tests for TestFileMounter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DefaultTestFileMounter } from '../../../src/test-execution-reporting/docker/test-file-mounter.js';
import { MountValidationError } from '../../../src/test-execution-reporting/docker/errors.js';

describe('TestFileMounter', () => {
  let tempDir: string;
  let mounter: DefaultTestFileMounter;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = join(tmpdir(), `test-mounter-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    mounter = new DefaultTestFileMounter();
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('generateMounts', () => {
    it('should generate mount for test file', async () => {
      // Create a test file
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should have at least the test file mount
      const testFileMount = mounts.find(m => m.hostPath === testFilePath);
      expect(testFileMount).toBeDefined();
      expect(testFileMount?.containerPath).toBe('/workspace/test.test.ts');
      expect(testFileMount?.readOnly).toBe(true);
    });

    it('should generate mount for src directory if it exists', async () => {
      // Create src directory
      const srcDir = join(tempDir, 'src');
      await mkdir(srcDir);
      await writeFile(join(srcDir, 'index.ts'), 'export {}');

      // Create test file
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should have src mount
      const srcMount = mounts.find(m => m.hostPath === srcDir);
      expect(srcMount).toBeDefined();
      expect(srcMount?.containerPath).toBe('/workspace/src');
      expect(srcMount?.readOnly).toBe(true);
    });

    it('should generate mount for node_modules if it exists', async () => {
      // Create node_modules directory
      const nodeModulesDir = join(tempDir, 'node_modules');
      await mkdir(nodeModulesDir);

      // Create test file
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should have node_modules mount
      const nodeModulesMount = mounts.find(m => m.hostPath === nodeModulesDir);
      expect(nodeModulesMount).toBeDefined();
      expect(nodeModulesMount?.containerPath).toBe('/workspace/node_modules');
      expect(nodeModulesMount?.readOnly).toBe(true);
    });

    it('should generate mount for package.json if it exists', async () => {
      // Create package.json
      const packageJsonPath = join(tempDir, 'package.json');
      await writeFile(packageJsonPath, '{}');

      // Create test file
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should have package.json mount
      const packageJsonMount = mounts.find(m => m.hostPath === packageJsonPath);
      expect(packageJsonMount).toBeDefined();
      expect(packageJsonMount?.containerPath).toBe('/workspace/package.json');
      expect(packageJsonMount?.readOnly).toBe(true);
    });

    it('should generate mounts for test config files if they exist', async () => {
      // Create vitest config
      const vitestConfigPath = join(tempDir, 'vitest.config.ts');
      await writeFile(vitestConfigPath, 'export default {}');

      // Create test file
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should have vitest config mount
      const vitestConfigMount = mounts.find(m => m.hostPath === vitestConfigPath);
      expect(vitestConfigMount).toBeDefined();
      expect(vitestConfigMount?.containerPath).toBe('/workspace/vitest.config.ts');
      expect(vitestConfigMount?.readOnly).toBe(true);
    });

    it('should mark all mounts as read-only', async () => {
      // Create all possible files
      await mkdir(join(tempDir, 'src'));
      await mkdir(join(tempDir, 'node_modules'));
      await writeFile(join(tempDir, 'package.json'), '{}');
      await writeFile(join(tempDir, 'vitest.config.ts'), 'export default {}');
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // All mounts should be read-only
      expect(mounts.every(m => m.readOnly)).toBe(true);
    });

    it('should resolve relative paths to absolute paths', async () => {
      // Create test file
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      // Use the actual test file path (which will be resolved to absolute)
      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should resolve to absolute path
      const testFileMount = mounts.find(m => m.containerPath === '/workspace/test.test.ts');
      expect(testFileMount).toBeDefined();
      expect(testFileMount?.hostPath).toBe(testFilePath);
      // Host path should be absolute (starts with / on Unix or drive letter on Windows)
      expect(testFileMount?.hostPath).toMatch(/^([a-zA-Z]:)?[/\\]/);
    });

    it('should handle test files in subdirectories', async () => {
      // Create test file in subdirectory
      const testsDir = join(tempDir, 'tests');
      await mkdir(testsDir);
      const testFilePath = join(testsDir, 'example.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should preserve directory structure in container
      const testFileMount = mounts.find(m => m.hostPath === testFilePath);
      expect(testFileMount).toBeDefined();
      expect(testFileMount?.containerPath).toBe('/workspace/tests/example.test.ts');
    });

    it('should skip non-existent directories gracefully', async () => {
      // Create only test file, no src or node_modules
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = await mounter.generateMounts(testFilePath, tempDir);

      // Should only have test file mount
      expect(mounts.length).toBe(1);
      expect(mounts[0]?.hostPath).toBe(testFilePath);
    });
  });

  describe('validateMounts', () => {
    it('should pass validation for existing files', async () => {
      // Create test file
      const testFilePath = join(tempDir, 'test.test.ts');
      await writeFile(testFilePath, 'test content');

      const mounts = [
        {
          hostPath: testFilePath,
          containerPath: '/workspace/test.test.ts',
          readOnly: true,
        },
      ];

      await expect(mounter.validateMounts(mounts)).resolves.not.toThrow();
    });

    it('should throw MountValidationError for non-existent files', async () => {
      const mounts = [
        {
          hostPath: join(tempDir, 'non-existent.ts'),
          containerPath: '/workspace/non-existent.ts',
          readOnly: true,
        },
      ];

      await expect(mounter.validateMounts(mounts)).rejects.toThrow(MountValidationError);
      
      try {
        await mounter.validateMounts(mounts);
        expect.fail('Should have thrown MountValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(MountValidationError);
        const mountError = error as MountValidationError;
        expect(mountError.reason).toBe('not_found');
      }
    });

    it('should validate multiple mounts', async () => {
      // Create some files
      const file1 = join(tempDir, 'file1.ts');
      const file2 = join(tempDir, 'file2.ts');
      await writeFile(file1, 'content1');
      await writeFile(file2, 'content2');

      const mounts = [
        { hostPath: file1, containerPath: '/workspace/file1.ts', readOnly: true },
        { hostPath: file2, containerPath: '/workspace/file2.ts', readOnly: true },
      ];

      await expect(mounter.validateMounts(mounts)).resolves.not.toThrow();
    });

    it('should report all invalid paths in error', async () => {
      const mounts = [
        { hostPath: join(tempDir, 'missing1.ts'), containerPath: '/workspace/missing1.ts', readOnly: true },
        { hostPath: join(tempDir, 'missing2.ts'), containerPath: '/workspace/missing2.ts', readOnly: true },
      ];

      try {
        await mounter.validateMounts(mounts);
        expect.fail('Should have thrown MountValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(MountValidationError);
        if (error instanceof MountValidationError) {
          expect(error.invalidPaths).toHaveLength(2);
          expect(error.invalidPaths).toContain(join(tempDir, 'missing1.ts'));
          expect(error.invalidPaths).toContain(join(tempDir, 'missing2.ts'));
        }
      }
    });

    it('should pass validation for empty mounts array', async () => {
      await expect(mounter.validateMounts([])).resolves.not.toThrow();
    });

    it('should detect path conflicts when multiple host paths mount to same container path', async () => {
      // Create two different files
      const file1 = join(tempDir, 'file1.ts');
      const file2 = join(tempDir, 'file2.ts');
      await writeFile(file1, 'content1');
      await writeFile(file2, 'content2');

      // Try to mount both to the same container path
      const mounts = [
        { hostPath: file1, containerPath: '/workspace/test.ts', readOnly: true },
        { hostPath: file2, containerPath: '/workspace/test.ts', readOnly: true },
      ];

      await expect(mounter.validateMounts(mounts)).rejects.toThrow(MountValidationError);
      
      try {
        await mounter.validateMounts(mounts);
        expect.fail('Should have thrown MountValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(MountValidationError);
        const mountError = error as MountValidationError;
        expect(mountError.reason).toBe('invalid_path');
        expect(mountError.message).toContain('path conflict');
      }
    });

    it('should allow different host paths to mount to different container paths', async () => {
      // Create two different files
      const file1 = join(tempDir, 'file1.ts');
      const file2 = join(tempDir, 'file2.ts');
      await writeFile(file1, 'content1');
      await writeFile(file2, 'content2');

      // Mount to different container paths - should be valid
      const mounts = [
        { hostPath: file1, containerPath: '/workspace/file1.ts', readOnly: true },
        { hostPath: file2, containerPath: '/workspace/file2.ts', readOnly: true },
      ];

      await expect(mounter.validateMounts(mounts)).resolves.not.toThrow();
    });

    it('should normalize container paths when checking for conflicts', async () => {
      // Create two different files
      const file1 = join(tempDir, 'file1.ts');
      const file2 = join(tempDir, 'file2.ts');
      await writeFile(file1, 'content1');
      await writeFile(file2, 'content2');

      // Try to mount with different path separators (should still detect conflict)
      const mounts = [
        { hostPath: file1, containerPath: '/workspace/test.ts', readOnly: true },
        { hostPath: file2, containerPath: '/workspace/test.ts', readOnly: true },
      ];

      await expect(mounter.validateMounts(mounts)).rejects.toThrow(MountValidationError);
    });
  });
});
