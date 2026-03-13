/**
 * Test File Mounter for Docker Test Execution
 * 
 * Manages mounting test files and dependencies into Docker containers.
 * Ensures all files are mounted as read-only to preserve file integrity.
 */

import { resolve, join, relative } from 'node:path';
import { access, constants } from 'node:fs/promises';
import type { Mount, TestFileMounter } from './types.js';
import { MountValidationError } from './errors.js';

/**
 * Default implementation of TestFileMounter
 * 
 * Generates mount configurations for:
 * 1. Test file (read-only)
 * 2. Source code directory (read-only)
 * 3. node_modules directory (read-only)
 * 4. Configuration files: package.json, test configs (read-only)
 */
export class DefaultTestFileMounter implements TestFileMounter {
  /**
   * Generate mount configurations for test execution
   * 
   * @param testFilePath - Path to test file on host (relative or absolute)
   * @param projectRoot - Project root directory (absolute path)
   * @returns Array of mount configurations
   */
  async generateMounts(testFilePath: string, projectRoot: string): Promise<Mount[]> {
    // Resolve paths to absolute
    const absoluteProjectRoot = resolve(projectRoot);
    const absoluteTestFilePath = resolve(testFilePath);

    const mounts: Mount[] = [];

    // 1. Test file mount
    // Map test file to same relative location in container
    const relativeTestPath = relative(absoluteProjectRoot, absoluteTestFilePath);
    // Normalize path separators to forward slashes for container paths
    const normalizedTestPath = relativeTestPath.replace(/\\/g, '/');
    mounts.push({
      hostPath: absoluteTestFilePath,
      containerPath: `/workspace/${normalizedTestPath}`,
      readOnly: true,
    });

    // 2. Source code mount
    // Mount the src directory if it exists
    const srcPath = join(absoluteProjectRoot, 'src');
    try {
      await access(srcPath, constants.R_OK);
      mounts.push({
        hostPath: srcPath,
        containerPath: '/workspace/src',
        readOnly: true,
      });
    } catch {
      // src directory doesn't exist or not readable, skip it
    }

    // 3. node_modules mount
    // Mount node_modules for test dependencies
    const nodeModulesPath = join(absoluteProjectRoot, 'node_modules');
    try {
      await access(nodeModulesPath, constants.R_OK);
      mounts.push({
        hostPath: nodeModulesPath,
        containerPath: '/workspace/node_modules',
        readOnly: true,
      });
    } catch {
      // node_modules doesn't exist or not readable, skip it
    }

    // 4. Configuration files mount
    // Mount package.json
    const packageJsonPath = join(absoluteProjectRoot, 'package.json');
    try {
      await access(packageJsonPath, constants.R_OK);
      mounts.push({
        hostPath: packageJsonPath,
        containerPath: '/workspace/package.json',
        readOnly: true,
      });
    } catch {
      // package.json doesn't exist or not readable, skip it
    }

    // Mount common test configuration files if they exist
    const configFiles = [
      'vitest.config.ts',
      'vitest.config.js',
      'jest.config.js',
      'jest.config.ts',
      '.mocharc.json',
      '.mocharc.js',
    ];

    for (const configFile of configFiles) {
      const configPath = join(absoluteProjectRoot, configFile);
      try {
        await access(configPath, constants.R_OK);
        mounts.push({
          hostPath: configPath,
          containerPath: `/workspace/${configFile}`,
          readOnly: true,
        });
      } catch {
        // Config file doesn't exist or not readable, skip it
      }
    }

    return mounts;
  }

  /**
   * Validate all mount paths exist and are accessible
   * 
   * @param mounts - Mount configurations to validate
   * @throws MountValidationError if any path is invalid
   */
  async validateMounts(mounts: Mount[]): Promise<void> {
    const invalidPaths: string[] = [];
    const errors: Array<{ path: string; reason: 'not_found' | 'no_permission' }> = [];

    // Check path existence and permissions
    for (const mount of mounts) {
      try {
        // Check if path exists and is readable
        await access(mount.hostPath, constants.R_OK);
      } catch {
        invalidPaths.push(mount.hostPath);
        
        // Determine if it's a permission issue or not found
        try {
          await access(mount.hostPath, constants.F_OK);
          // Path exists but not readable
          errors.push({ path: mount.hostPath, reason: 'no_permission' });
        } catch {
          // Path doesn't exist
          errors.push({ path: mount.hostPath, reason: 'not_found' });
        }
      }
    }

    if (invalidPaths.length > 0) {
      // Determine the primary reason for validation failure
      const notFoundCount = errors.filter(e => e.reason === 'not_found').length;
      const noPermissionCount = errors.filter(e => e.reason === 'no_permission').length;
      
      const primaryReason = notFoundCount > noPermissionCount ? 'not_found' : 'no_permission';
      
      const message = `Mount validation failed: ${invalidPaths.length} path(s) are invalid\n` +
        invalidPaths.map(p => `  - ${p}`).join('\n');

      throw new MountValidationError(message, invalidPaths, primaryReason);
    }

    // Check for path conflicts (multiple host paths mounting to same container path)
    const containerPathMap = new Map<string, string[]>();
    for (const mount of mounts) {
      const normalizedContainerPath = mount.containerPath.replace(/\\/g, '/');
      if (!containerPathMap.has(normalizedContainerPath)) {
        containerPathMap.set(normalizedContainerPath, []);
      }
      containerPathMap.get(normalizedContainerPath)!.push(mount.hostPath);
    }

    const conflicts: string[] = [];
    for (const [containerPath, hostPaths] of containerPathMap.entries()) {
      if (hostPaths.length > 1) {
        conflicts.push(
          `Container path '${containerPath}' has multiple host mounts: ${hostPaths.join(', ')}`
        );
      }
    }

    if (conflicts.length > 0) {
      const message = `Mount validation failed: ${conflicts.length} path conflict(s) detected\n` +
        conflicts.map(c => `  - ${c}`).join('\n');

      throw new MountValidationError(message, [], 'invalid_path');
    }
  }
}
