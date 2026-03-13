/**
 * Property-based tests for TestExecutor component
 * 
 * **Validates: Requirements 1.4, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4**
 * 
 * This file contains property-based tests using fast-check to validate:
 * - Property 2: Execution Timeout Enforcement
 * - Property 9: Framework Detection
 * - Property 10: File Integrity Preservation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile as fsReadFile, readdir } from 'fs/promises';
import { join } from 'path';
import fc from 'fast-check';
import { DefaultTestExecutor } from '../../src/test-execution-reporting/test-executor.js';

// Reduced iterations for faster test execution (real process spawning is expensive)
const testConfig = { numRuns: 10 };

describe('TestExecutor - Property-Based Tests', () => {
  let executor: DefaultTestExecutor;
  let tempDir: string;

  beforeEach(async () => {
    executor = new DefaultTestExecutor();
    // Use OS temp directory to avoid finding project's package.json
    const osTempDir = process.platform === 'win32' ? process.env.TEMP || 'C:\\temp' : '/tmp';
    tempDir = join(osTempDir, 'test-executor-pbt-' + Date.now());
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Retry cleanup on Windows due to file locking issues
    let retries = 3;
    while (retries > 0) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        break;
      } catch {
        retries--;
        if (retries === 0) {
          // Silently fail cleanup - temp directory will be cleaned by OS
        } else {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  });

  describe('Property 2: Execution Timeout Enforcement', () => {
    /**
     * **Validates: Requirements 1.4**
     * 
     * For any test execution, if the execution time exceeds the specified timeout,
     * the Test_Executor should terminate the execution and return a timeout error status.
     */
    it('should enforce timeout for any execution duration exceeding the limit', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate timeout values between 500ms and 2000ms
          fc.integer({ min: 500, max: 2000 }),
          // Generate execution durations that exceed timeout by 1000-3000ms
          fc.integer({ min: 1000, max: 3000 }),
          async (timeout, excessDuration) => {
            const executionDuration = timeout + excessDuration;
            
            const testFile = join(tempDir, `timeout-${timeout}-${executionDuration}.test.js`);
            await writeFile(testFile, `
              const { test } = require('node:test');
              
              test('long running test', async () => {
                await new Promise(resolve => setTimeout(resolve, ${executionDuration}));
              });
            `);

            const result = await executor.execute(testFile, { 
              timeout, 
              cwd: tempDir 
            });

            // Property: Timeout should be enforced
            expect(result.timedOut).toBe(true);
            expect(result.exitCode).not.toBe(0);
            
            // Property: Duration should be close to timeout (not full execution duration)
            expect(result.duration).toBeGreaterThanOrEqual(timeout);
            expect(result.duration).toBeLessThan(timeout + 2000); // Allow 2s buffer for cleanup
            
            // Wait for process cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        ),
        testConfig
      );
    }, 300000); // 5 minute test timeout to allow for 100 iterations

    it('should not timeout for executions within the limit', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate timeout values between 2000ms and 5000ms
          fc.integer({ min: 2000, max: 5000 }),
          // Generate execution durations well under timeout (50-80% of timeout)
          fc.double({ min: 0.5, max: 0.8, noNaN: true }),
          async (timeout, durationFactor) => {
            const executionDuration = Math.floor(timeout * durationFactor);
            
            const testFile = join(tempDir, `no-timeout-${timeout}-${executionDuration}.test.js`);
            await writeFile(testFile, `
              const { test } = require('node:test');
              
              test('quick test', async () => {
                await new Promise(resolve => setTimeout(resolve, ${executionDuration}));
              });
            `);

            const result = await executor.execute(testFile, { 
              timeout, 
              cwd: tempDir 
            });

            // Property: Should not timeout when within limit
            expect(result.timedOut).toBe(false);
            expect(result.exitCode).toBe(0);
            
            // Property: Duration should reflect actual execution time
            expect(result.duration).toBeGreaterThanOrEqual(executionDuration);
            expect(result.duration).toBeLessThan(timeout);
          }
        ),
        testConfig
      );
    }, 300000); // 5 minute test timeout
  });

  describe('Property 9: Framework Detection', () => {
    /**
     * **Validates: Requirements 7.3, 7.4**
     * 
     * For any test file with framework indicators in package.json or file syntax,
     * the Test_Executor should correctly detect the framework (Jest, Mocha, Vitest, Node.js test runner),
     * and default to Node.js test runner when detection fails.
     */
    
    // Generator for framework indicators in package.json
    const packageJsonFrameworkArb = fc.constantFrom(
      { framework: 'jest', script: 'jest', dep: 'jest' },
      { framework: 'mocha', script: 'mocha', dep: 'mocha' },
      { framework: 'vitest', script: 'vitest run', dep: 'vitest' },
      { framework: 'node:test', script: 'node --test', dep: null }
    );

    it('should detect framework from package.json test script', async () => {
      await fc.assert(
        fc.asyncProperty(
          packageJsonFrameworkArb,
          async (frameworkInfo) => {
            const packageJson = {
              scripts: {
                test: frameworkInfo.script
              }
            };
            await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
            
            const testFile = join(tempDir, `test-${frameworkInfo.framework}.test.ts`);
            await writeFile(testFile, '// empty test file');

            const detected = await executor.detectFramework(testFile);

            // Property: Detected framework should match package.json indicator
            expect(detected).toBe(frameworkInfo.framework);
          }
        ),
        testConfig
      );
    });

    it('should detect framework from package.json dependencies', async () => {
      await fc.assert(
        fc.asyncProperty(
          packageJsonFrameworkArb.filter(f => f.dep !== null),
          fc.string({ minLength: 5, maxLength: 10 }), // version string
          async (frameworkInfo, version) => {
            if (!frameworkInfo.dep) return; // Skip if no dependency
            
            const packageJson = {
              devDependencies: {
                [frameworkInfo.dep]: `^${version}`
              }
            };
            await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
            
            const testFile = join(tempDir, `dep-test-${frameworkInfo.framework}.test.ts`);
            await writeFile(testFile, '// empty test file');

            const detected = await executor.detectFramework(testFile);

            // Property: Detected framework should match dependency
            expect(detected).toBe(frameworkInfo.framework);
          }
        ),
        testConfig
      );
    });

    // Generator for framework-specific file syntax
    const fileSyntaxFrameworkArb = fc.constantFrom(
      { 
        framework: 'jest', 
        content: "import { describe, test, expect } from 'jest';\ndescribe('test', () => { test('works', () => {}); });" 
      },
      { 
        framework: 'mocha', 
        content: "describe('test', () => { it('works', () => {}); });" 
      },
      { 
        framework: 'vitest', 
        content: "import { describe, test } from 'vitest';\ndescribe('test', () => { test('works', () => {}); });" 
      },
      { 
        framework: 'vitest', 
        content: "import { vi } from 'vitest';\nconst mock = vi.fn();" 
      },
      { 
        framework: 'node:test', 
        content: "import { test } from 'node:test';\ntest('works', () => {});" 
      },
      { 
        framework: 'node:test', 
        content: "const test = require('node:test');\ntest('works', () => {});" 
      }
    );

    it('should detect framework from file syntax', async () => {
      await fc.assert(
        fc.asyncProperty(
          fileSyntaxFrameworkArb,
          async (syntaxInfo) => {
            const testFile = join(tempDir, `syntax-${syntaxInfo.framework}-${Date.now()}.test.ts`);
            await writeFile(testFile, syntaxInfo.content);

            const detected = await executor.detectFramework(testFile);

            // Property: Detected framework should match file syntax
            expect(detected).toBe(syntaxInfo.framework);
          }
        ),
        testConfig
      );
    });

    it('should default to node:test when no framework indicators present', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random non-framework-specific content
          fc.string({ minLength: 10, maxLength: 100 })
            .filter(s => 
              !s.includes('jest') && 
              !s.includes('mocha') && 
              !s.includes('vitest') && 
              !s.includes('node:test') &&
              !s.includes('describe') &&
              !s.includes('it(') &&
              !s.includes('test(')
            ),
          async (content) => {
            const testFile = join(tempDir, `default-${Date.now()}.test.ts`);
            await writeFile(testFile, `// ${content}\nconsole.log('test');`);

            const detected = await executor.detectFramework(testFile);

            // Property: Should default to node:test when detection fails
            expect(detected).toBe('node:test');
          }
        ),
        testConfig
      );
    });

    it('should prioritize package.json over file syntax', async () => {
      await fc.assert(
        fc.asyncProperty(
          packageJsonFrameworkArb,
          fileSyntaxFrameworkArb.filter(f => f.framework !== 'node:test'),
          async (packageInfo, syntaxInfo) => {
            // Set up package.json with one framework
            const packageJson = {
              scripts: {
                test: packageInfo.script
              }
            };
            await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
            
            // Create test file with different framework syntax
            const testFile = join(tempDir, `priority-${Date.now()}.test.ts`);
            await writeFile(testFile, syntaxInfo.content);

            const detected = await executor.detectFramework(testFile);

            // Property: package.json should take priority over file syntax
            expect(detected).toBe(packageInfo.framework);
          }
        ),
        testConfig
      );
    });
  });

  describe('Property 10: File Integrity Preservation', () => {
    /**
     * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
     * 
     * For any test execution, the Test_Executor should not modify the test file,
     * any source files referenced by the tests, or leave any temporary files after completion
     * (all files should be cleaned up).
     */

    it('should not modify test file during execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random test content
          fc.string({ minLength: 50, maxLength: 200 }),
          fc.integer({ min: 1, max: 5 }), // number of tests
          async (testName, numTests) => {
            const testContent = `
              const { test } = require('node:test');
              const assert = require('assert');
              
              ${Array.from({ length: numTests }, (_, i) => `
                test('${testName} ${i}', () => {
                  assert.strictEqual(1 + 1, 2);
                });
              `).join('\n')}
            `;
            
            const testFile = join(tempDir, `integrity-${Date.now()}.test.js`);
            await writeFile(testFile, testContent);

            // Read original content
            const originalContent = await fsReadFile(testFile, 'utf-8');

            // Execute test
            await executor.execute(testFile, { 
              timeout: 5000, 
              cwd: tempDir 
            });

            // Read content after execution
            const afterContent = await fsReadFile(testFile, 'utf-8');

            // Property: Test file should remain unchanged
            expect(afterContent).toBe(originalContent);
          }
        ),
        testConfig
      );
    });

    it('should not modify source files referenced by tests', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random function names and implementations
          fc.string({ minLength: 5, maxLength: 15 }).filter(s => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s)),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 10 }),
          async (funcName, a, b) => {
            // Create source file
            const sourceContent = `
              module.exports = {
                ${funcName}: (x, y) => x + y
              };
            `;
            const sourceFile = join(tempDir, `source-${Date.now()}.js`);
            await writeFile(sourceFile, sourceContent);

            // Create test that imports source file
            const testFile = join(tempDir, `ref-test-${Date.now()}.test.js`);
            await writeFile(testFile, `
              const { test } = require('node:test');
              const assert = require('assert');
              const { ${funcName} } = require('./${sourceFile.split('/').pop()?.replace('.js', '')}');
              
              test('source file test', () => {
                assert.strictEqual(${funcName}(${a}, ${b}), ${a + b});
              });
            `);

            // Read original source content
            const originalSourceContent = await fsReadFile(sourceFile, 'utf-8');

            // Execute test
            await executor.execute(testFile, { 
              timeout: 5000, 
              cwd: tempDir 
            });

            // Read source content after execution
            const afterSourceContent = await fsReadFile(sourceFile, 'utf-8');

            // Property: Source file should remain unchanged
            expect(afterSourceContent).toBe(originalSourceContent);
          }
        ),
        testConfig
      );
    });

    it('should not leave temporary files after execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random test scenarios
          fc.boolean(), // pass or fail
          fc.integer({ min: 1, max: 3 }), // number of tests
          async (shouldPass, numTests) => {
            const testContent = `
              const { test } = require('node:test');
              const assert = require('assert');
              
              ${Array.from({ length: numTests }, (_, i) => `
                test('test ${i}', () => {
                  assert.strictEqual(1 + 1, ${shouldPass ? 2 : 3});
                });
              `).join('\n')}
            `;
            
            const testFile = join(tempDir, `cleanup-${Date.now()}.test.js`);
            await writeFile(testFile, testContent);

            // Get files before execution
            const filesBefore = await readdir(tempDir);

            // Execute test
            await executor.execute(testFile, { 
              timeout: 5000, 
              cwd: tempDir 
            });

            // Get files after execution
            const filesAfter = await readdir(tempDir);

            // Property: No new temporary files should be created
            expect(filesAfter.sort()).toEqual(filesBefore.sort());
          }
        ),
        testConfig
      );
    });

    it('should clean up temporary files even after timeout', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate timeout scenarios
          fc.integer({ min: 500, max: 1000 }), // short timeout
          async (timeout) => {
            const testFile = join(tempDir, `timeout-cleanup-${Date.now()}.test.js`);
            await writeFile(testFile, `
              const { test } = require('node:test');
              
              test('long test', async () => {
                await new Promise(resolve => setTimeout(resolve, ${timeout + 2000}));
              });
            `);

            // Get files before execution
            const filesBefore = await readdir(tempDir);

            // Execute test (will timeout)
            const result = await executor.execute(testFile, { 
              timeout, 
              cwd: tempDir 
            });

            expect(result.timedOut).toBe(true);

            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Get files after execution
            const filesAfter = await readdir(tempDir);

            // Property: No temporary files should remain after timeout
            expect(filesAfter.sort()).toEqual(filesBefore.sort());
          }
        ),
        testConfig
      );
    }, 300000); // 5 minute test timeout

    it('should clean up temporary files even after execution errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate different error scenarios
          fc.constantFrom(
            'syntax error: const x = {{{',
            'missing module: require("nonexistent-module-xyz")',
            'runtime error: throw new Error("test error")'
          ),
          async (errorCode) => {
            const testFile = join(tempDir, `error-cleanup-${Date.now()}.test.js`);
            await writeFile(testFile, `
              const { test } = require('node:test');
              
              test('error test', () => {
                ${errorCode}
              });
            `);

            // Get files before execution
            const filesBefore = await readdir(tempDir);

            // Execute test (will fail)
            const result = await executor.execute(testFile, { 
              timeout: 5000, 
              cwd: tempDir 
            });

            expect(result.exitCode).not.toBe(0);

            // Get files after execution
            const filesAfter = await readdir(tempDir);

            // Property: No temporary files should remain after errors
            expect(filesAfter.sort()).toEqual(filesBefore.sort());
          }
        ),
        testConfig
      );
    });

    it('should preserve file integrity across multiple executions', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate number of executions (reduced to 2-3 for faster execution)
          fc.integer({ min: 2, max: 3 }),
          async (numExecutions) => {
            const testContent = `
              const { test } = require('node:test');
              const assert = require('assert');
              
              test('multi-exec test', () => {
                assert.strictEqual(1 + 1, 2);
              });
            `;
            
            const testFile = join(tempDir, `multi-${Date.now()}.test.js`);
            await writeFile(testFile, testContent);

            // Read original content
            const originalContent = await fsReadFile(testFile, 'utf-8');

            // Execute test multiple times
            for (let i = 0; i < numExecutions; i++) {
              await executor.execute(testFile, { 
                timeout: 5000, 
                cwd: tempDir 
              });
            }

            // Read content after all executions
            const afterContent = await fsReadFile(testFile, 'utf-8');

            // Property: Test file should remain unchanged after multiple executions
            expect(afterContent).toBe(originalContent);
          }
        ),
        testConfig
      );
    }, 60000); // Increased timeout to 60 seconds for multiple executions
  });
});
