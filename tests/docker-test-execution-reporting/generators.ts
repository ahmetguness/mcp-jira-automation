/**
 * Property-based test generators for Docker Test Execution Reporting
 * 
 * This module provides fast-check arbitraries for generating test data
 * used in property-based tests for the Docker test execution feature.
 */

import fc from 'fast-check';
import type { 
  ContainerConfig, 
  Mount, 
  DockerConfiguration 
} from '../../src/test-execution-reporting/docker/types.js';

/**
 * Generator for Docker image names
 * Produces valid Docker image names including official Node.js images
 * and custom registry images
 */
export const dockerImageArb = fc.oneof(
  fc.constant('node:20-alpine'),
  fc.constant('node:18-alpine'),
  fc.constant('node:20'),
  fc.constant('node:18'),
  fc.constant('node:latest'),
  fc.tuple(
    fc.stringMatching(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    fc.stringMatching(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    fc.stringMatching(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
  ).map(([registry, repo, tag]) => `${registry}/${repo}:${tag}`)
);

/**
 * Generator for network modes
 * Produces valid Docker network mode values
 */
export const networkModeArb = fc.constantFrom('none', 'bridge', 'host');

/**
 * Generator for memory limit strings
 * Produces valid Docker memory limit formats
 */
export const memoryLimitArb = fc.oneof(
  fc.constant('256m'),
  fc.constant('512m'),
  fc.constant('1g'),
  fc.constant('2g'),
  fc.constant('4g')
);

/**
 * Generator for CPU limit strings
 * Produces valid Docker CPU limit values
 */
export const cpuLimitArb = fc.oneof(
  fc.constant('0.25'),
  fc.constant('0.5'),
  fc.constant('1.0'),
  fc.constant('2.0'),
  fc.constant('4.0')
);

/**
 * Generator for container configurations
 * Produces complete ContainerConfig objects with all required fields
 */
export const containerConfigArb: fc.Arbitrary<ContainerConfig> = fc.record({
  imageName: dockerImageArb,
  command: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
  workingDir: fc.constant('/workspace'),
  mounts: fc.array(
    fc.record({
      hostPath: fc.stringMatching(/^\/[a-z0-9/_-]+$/),
      containerPath: fc.stringMatching(/^\/workspace\/[a-z0-9/_-]+$/),
      readOnly: fc.boolean()
    }),
    { minLength: 1, maxLength: 10 }
  ),
  networkMode: networkModeArb,
  memoryLimit: fc.option(memoryLimitArb),
  cpuLimit: fc.option(cpuLimitArb),
  env: fc.option(
    fc.dictionary(
      fc.stringMatching(/^[A-Z_][A-Z0-9_]*$/),
      fc.string()
    )
  )
});

/**
 * Generator for mount configurations
 * Produces Mount objects with valid host and container paths
 */
export const mountArb: fc.Arbitrary<Mount> = fc.record({
  hostPath: fc.oneof(
    fc.constant('/tmp/test-file.js'),
    fc.constant('/home/user/project/src'),
    fc.constant('/home/user/project/node_modules'),
    fc.constant('/home/user/project/package.json'),
    fc.stringMatching(/^\/[a-z0-9/_-]+\.[a-z]+$/)
  ),
  containerPath: fc.oneof(
    fc.constant('/workspace/test-file.js'),
    fc.constant('/workspace/src'),
    fc.constant('/workspace/node_modules'),
    fc.constant('/workspace/package.json'),
    fc.stringMatching(/^\/workspace\/[a-z0-9/_-]+\.[a-z]+$/)
  ),
  readOnly: fc.boolean()
});

/**
 * Generator for test frameworks
 * Produces valid test framework names
 */
export const testFrameworkArb = fc.constantFrom('jest', 'mocha', 'vitest', 'node:test');

/**
 * Generator for test file content with framework indicators
 * Produces test file content that includes framework-specific imports and syntax
 */
export const testFileWithFrameworkArb = fc.record({
  framework: testFrameworkArb,
  hasImport: fc.boolean(),
  hasDescribe: fc.boolean(),
  hasTest: fc.boolean()
}).map(({ framework, hasImport, hasDescribe, hasTest }) => {
  let content = '';
  
  // Add framework-specific imports
  if (hasImport) {
    switch (framework) {
      case 'jest':
        content += "const { describe, test, expect } = require('@jest/globals');\n\n";
        break;
      case 'mocha':
        content += "const assert = require('assert');\n\n";
        break;
      case 'vitest':
        content += "import { describe, test, expect } from 'vitest';\n\n";
        break;
      case 'node:test':
        content += "const { describe, test } = require('node:test');\n";
        content += "const assert = require('node:assert');\n\n";
        break;
    }
  }
  
  // Add test structure
  if (hasDescribe) {
    content += "describe('Test Suite', () => {\n";
  }
  
  if (hasTest) {
    const indent = hasDescribe ? '  ' : '';
    content += `${indent}test('sample test', () => {\n`;
    
    switch (framework) {
      case 'jest':
      case 'vitest':
        content += `${indent}  expect(1 + 1).toBe(2);\n`;
        break;
      case 'mocha':
      case 'node:test':
        content += `${indent}  assert.strictEqual(1 + 1, 2);\n`;
        break;
    }
    
    content += `${indent}});\n`;
  }
  
  if (hasDescribe) {
    content += "});\n";
  }
  
  return {
    content,
    framework,
    hasImport,
    hasDescribe,
    hasTest
  };
});

/**
 * Generator for Docker configurations
 * Produces complete DockerConfiguration objects
 */
export const dockerConfigurationArb: fc.Arbitrary<DockerConfiguration> = fc.record({
  defaultImage: dockerImageArb,
  imageRegistry: fc.option(fc.stringMatching(/^[a-z0-9]+(?:\.[a-z0-9]+)*$/)),
  networkMode: networkModeArb,
  resourceLimits: fc.record({
    memory: memoryLimitArb,
    cpu: cpuLimitArb
  }),
  timeout: fc.integer({ min: 60000, max: 600000 }),
  cleanupRetries: fc.integer({ min: 1, max: 5 }),
  cleanupRetryDelay: fc.integer({ min: 500, max: 5000 }),
  pullTimeout: fc.integer({ min: 60000, max: 300000 })
});

/**
 * Generator for container IDs
 * Produces valid Docker container ID strings (64 hex characters)
 */
export const containerIdArb = fc.array(
  fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'),
  { minLength: 64, maxLength: 64 }
).map(chars => chars.join(''));

/**
 * Generator for exit codes
 * Produces valid process exit codes
 */
export const exitCodeArb = fc.oneof(
  fc.constant(0), // Success
  fc.constant(1), // General error
  fc.constant(2), // Misuse of shell command
  fc.constant(124), // Timeout
  fc.constant(125), // Container failed to run
  fc.constant(126), // Command cannot execute
  fc.constant(127), // Command not found
  fc.constant(130), // Terminated by Ctrl+C
  fc.constant(137), // Killed (SIGKILL)
  fc.constant(143)  // Terminated (SIGTERM)
);

/**
 * Generator for test execution durations
 * Produces realistic test execution times in milliseconds
 */
export const executionDurationArb = fc.integer({ min: 100, max: 300000 });

/**
 * Generator for container logs
 * Produces realistic stdout/stderr output
 */
export const containerLogsArb = fc.record({
  stdout: fc.oneof(
    fc.constant('PASS tests/sample.test.js\n  ✓ test passed (2 ms)\n'),
    fc.constant('FAIL tests/sample.test.js\n  ✕ test failed (5 ms)\n'),
    fc.constant('Test Suites: 1 passed, 1 total\nTests: 3 passed, 3 total\n'),
    fc.string()
  ),
  stderr: fc.oneof(
    fc.constant(''),
    fc.constant('Warning: Deprecated API usage\n'),
    fc.constant('Error: Test failed with assertion error\n'),
    fc.string()
  )
});

/**
 * Generator for file paths
 * Produces valid Unix-style file paths
 */
export const filePathArb = fc.oneof(
  fc.constant('/workspace/test.test.js'),
  fc.constant('/workspace/src/index.js'),
  fc.constant('/workspace/package.json'),
  fc.tuple(
    fc.stringMatching(/^[a-z0-9_-]+$/),
    fc.stringMatching(/^[a-z0-9_-]+$/),
    fc.constantFrom('js', 'ts', 'json', 'md')
  ).map(([dir, file, ext]) => `/workspace/${dir}/${file}.${ext}`)
);

/**
 * Generator for project structures
 * Produces realistic project directory structures with multiple files
 */
export const projectStructureArb = fc.record({
  testFile: filePathArb,
  sourceFiles: fc.array(filePathArb, { minLength: 1, maxLength: 10 }),
  hasNodeModules: fc.boolean(),
  hasPackageJson: fc.boolean(),
  hasConfigFiles: fc.boolean()
});
