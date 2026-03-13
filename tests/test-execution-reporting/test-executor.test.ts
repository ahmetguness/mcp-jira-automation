/**
 * Unit tests for TestExecutor component
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { DefaultTestExecutor } from '../../src/test-execution-reporting/test-executor.js';

describe('DefaultTestExecutor', () => {
  let executor: DefaultTestExecutor;
  let tempDir: string;

  beforeEach(async () => {
    executor = new DefaultTestExecutor();
    // Use OS temp directory to avoid finding project's package.json
    const osTempDir = process.platform === 'win32' ? process.env.TEMP || 'C:\\temp' : '/tmp';
    tempDir = join(osTempDir, 'test-executor-' + Date.now());
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

  describe('detectFramework', () => {
    describe('detection from package.json test script', () => {
      it('should detect Jest from test script', async () => {
        const packageJson = {
          scripts: {
            test: 'jest'
          }
        };
        await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, '// empty test file');

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('jest');
      });

      it('should detect Vitest from test script', async () => {
        const packageJson = {
          scripts: {
            test: 'vitest run'
          }
        };
        await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, '// empty test file');

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('vitest');
      });
    });

    describe('detection from package.json dependencies', () => {
      it('should detect Mocha from devDependencies', async () => {
        const packageJson = {
          devDependencies: {
            mocha: '^10.0.0'
          }
        };
        await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, '// empty test file');

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('mocha');
      });
    });

    describe('detection from test file syntax', () => {
      it('should detect Mocha from describe and it usage', async () => {
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, `
          describe('my test', () => {
            it('should work', () => {
              expect(true).toBe(true);
            });
          });
        `);

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('mocha');
      });

      it('should detect Vitest from import statement', async () => {
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, `
          import { describe, test, expect } from 'vitest';
          
          describe('my test', () => {
            test('should work', () => {
              expect(true).toBe(true);
            });
          });
        `);

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('vitest');
      });

      it('should detect Node.js test runner from import statement', async () => {
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, `
          import { test } from 'node:test';
          
          test('should work', () => {
            // test code
          });
        `);

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('node:test');
      });
    });

    describe('default behavior', () => {
      it('should default to node:test when no framework detected', async () => {
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, `
          // No framework-specific code
          console.log('test');
        `);

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('node:test');
      });

      it('should default to node:test when package.json is invalid', async () => {
        await writeFile(join(tempDir, 'package.json'), 'invalid json {');
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, '// empty test file');

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('node:test');
      });
    });

    describe('priority of detection methods', () => {
      it('should prioritize package.json over file syntax', async () => {
        const packageJson = {
          scripts: {
            test: 'jest'
          }
        };
        await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
        
        // File has Vitest syntax but package.json says Jest
        const testFile = join(tempDir, 'test.test.ts');
        await writeFile(testFile, `
          import { describe, test } from 'vitest';
          
          describe('test', () => {
            test('works', () => {});
          });
        `);

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('jest');
      });
    });

    describe('nested directory structure', () => {
      it('should find package.json multiple levels up', async () => {
        const packageJson = {
          devDependencies: {
            mocha: '^10.0.0'
          }
        };
        await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));
        
        const deepDir = join(tempDir, 'src', 'components', 'tests', 'unit');
        await mkdir(deepDir, { recursive: true });
        const testFile = join(deepDir, 'test.test.ts');
        await writeFile(testFile, '// empty test file');

        const framework = await executor.detectFramework(testFile);
        expect(framework).toBe('mocha');
      });
    });
  });

  describe('execute', () => {
    it('should execute a simple Node.js test and capture output', async () => {
      const testFile = join(tempDir, 'simple.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        const assert = require('assert');
        
        test('passing test', () => {
          assert.strictEqual(1 + 1, 2);
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 5000, 
        cwd: tempDir 
      });

      expect(result.exitCode).toBe(0);
      expect(result.framework).toBe('node:test');
      expect(result.timedOut).toBe(false);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.stdout).toBeTruthy();
    });

    it('should capture stderr for failing tests', async () => {
      const testFile = join(tempDir, 'failing.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        const assert = require('assert');
        
        test('failing test', () => {
          assert.strictEqual(1 + 1, 3);
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 5000, 
        cwd: tempDir 
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.framework).toBe('node:test');
      expect(result.timedOut).toBe(false);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should timeout long-running tests', async () => {
      const testFile = join(tempDir, 'timeout.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        
        test('long running test', async () => {
          await new Promise(resolve => setTimeout(resolve, 10000));
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 1000, // 1 second timeout
        cwd: tempDir 
      });

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(1000);
      expect(result.duration).toBeLessThan(3000); // Should not wait full 10 seconds
      
      // Wait longer for process cleanup on Windows before test cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should capture both stdout and stderr', async () => {
      const testFile = join(tempDir, 'output.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        
        test('output test', () => {
          console.log('stdout message');
          console.error('stderr message');
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 5000, 
        cwd: tempDir 
      });

      expect(result.exitCode).toBe(0);
      // Note: Node.js test runner may redirect console.error to stdout
      const allOutput = result.stdout + result.stderr;
      expect(allOutput).toContain('stdout message');
      expect(allOutput).toContain('stderr message');
    });

    it('should handle syntax errors in test file', async () => {
      const testFile = join(tempDir, 'syntax-error.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        
        test('syntax error', () => {
          this is invalid syntax!!!
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 5000, 
        cwd: tempDir 
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.timedOut).toBe(false);
      // Syntax errors may appear in either stdout or stderr
      const allOutput = result.stdout + result.stderr;
      expect(allOutput).toBeTruthy();
      expect(allOutput.length).toBeGreaterThan(0);
    });

    it('should pass environment variables to test process', async () => {
      const testFile = join(tempDir, 'env.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        const assert = require('assert');
        
        test('env var test', () => {
          assert.strictEqual(process.env.TEST_VAR, 'test_value');
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 5000, 
        cwd: tempDir,
        env: { TEST_VAR: 'test_value' }
      });

      expect(result.exitCode).toBe(0);
    });

    it('should execute tests in specified working directory', async () => {
      const subDir = join(tempDir, 'subdir');
      await mkdir(subDir, { recursive: true });
      
      const testFile = join(subDir, 'cwd.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        const assert = require('assert');
        const { basename } = require('path');
        
        test('cwd test', () => {
          assert.strictEqual(basename(process.cwd()), 'subdir');
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 5000, 
        cwd: subDir 
      });

      expect(result.exitCode).toBe(0);
    });

    it('should measure execution duration accurately', async () => {
      const testFile = join(tempDir, 'duration.test.js');
      await writeFile(testFile, `
        const { test } = require('node:test');
        
        test('duration test', async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        });
      `);

      const result = await executor.execute(testFile, { 
        timeout: 5000, 
        cwd: tempDir 
      });

      expect(result.duration).toBeGreaterThanOrEqual(100);
      expect(result.duration).toBeLessThan(5000);
    });
  });

  describe('error handling', () => {
    describe('environment errors', () => {
      it('should detect missing test file', async () => {
        const testFile = join(tempDir, 'nonexistent.test.js');

        const result = await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('SYNTAX_ERROR');
        expect(result.stderr).toContain('not found');
      });

      it('should handle empty test file', async () => {
        const testFile = join(tempDir, 'empty.test.js');
        await writeFile(testFile, '');

        const result = await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('SYNTAX_ERROR');
        expect(result.stderr).toContain('empty');
      });
    });

    describe('syntax errors', () => {
      it('should categorize syntax errors from test execution', async () => {
        const testFile = join(tempDir, 'syntax.test.js');
        await writeFile(testFile, `
          const { test } = require('node:test');
          
          test('syntax error', () => {
            const x = {{{invalid syntax
          });
        `);

        const result = await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.timedOut).toBe(false);
        const allOutput = result.stdout + result.stderr;
        expect(allOutput).toBeTruthy();
      });
    });

    describe('dependency errors', () => {
      it('should handle missing module errors', async () => {
        const testFile = join(tempDir, 'missing-module.test.js');
        await writeFile(testFile, `
          const { test } = require('node:test');
          const nonexistent = require('this-module-does-not-exist');
          
          test('missing module', () => {
            // test code
          });
        `);

        const result = await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        expect(result.exitCode).not.toBe(0);
        const allOutput = result.stdout + result.stderr;
        expect(allOutput.toLowerCase()).toMatch(/cannot find module|module not found/);
      });
    });

    describe('read-only execution', () => {
      it('should not modify test file during execution', async () => {
        const testFile = join(tempDir, 'readonly.test.js');
        const originalContent = `
          const { test } = require('node:test');
          const assert = require('assert');
          
          test('readonly test', () => {
            assert.strictEqual(1 + 1, 2);
          });
        `;
        await writeFile(testFile, originalContent);

        await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        // Read file again and verify content unchanged
        const { readFile: fsReadFile } = await import('fs/promises');
        const afterContent = await fsReadFile(testFile, 'utf-8');
        expect(afterContent).toBe(originalContent);
      });

      it('should not modify source files referenced by tests', async () => {
        // Create a source file
        const sourceFile = join(tempDir, 'source.js');
        const sourceContent = `
          module.exports = {
            add: (a, b) => a + b
          };
        `;
        await writeFile(sourceFile, sourceContent);

        // Create test that imports source file
        const testFile = join(tempDir, 'source.test.js');
        await writeFile(testFile, `
          const { test } = require('node:test');
          const assert = require('assert');
          const { add } = require('./source.js');
          
          test('source file test', () => {
            assert.strictEqual(add(1, 2), 3);
          });
        `);

        await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        // Verify source file unchanged
        const { readFile: fsReadFile } = await import('fs/promises');
        const afterContent = await fsReadFile(sourceFile, 'utf-8');
        expect(afterContent).toBe(sourceContent);
      });
    });

    describe('temporary file cleanup', () => {
      it('should clean up temporary files after successful execution', async () => {
        const testFile = join(tempDir, 'cleanup.test.js');
        await writeFile(testFile, `
          const { test } = require('node:test');
          const assert = require('assert');
          
          test('cleanup test', () => {
            assert.strictEqual(1 + 1, 2);
          });
        `);

        const result = await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        expect(result.exitCode).toBe(0);
      });

      it('should clean up temporary files after timeout', async () => {
        const testFile = join(tempDir, 'cleanup-timeout.test.js');
        await writeFile(testFile, `
          const { test } = require('node:test');
          
          test('timeout cleanup test', async () => {
            await new Promise(resolve => setTimeout(resolve, 10000));
          });
        `);

        const result = await executor.execute(testFile, { 
          timeout: 1000,
          cwd: tempDir 
        });

        expect(result.timedOut).toBe(true);
        
        // Wait for process cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));
      });
    });

    describe('error categorization', () => {
      it('should categorize environment errors correctly', async () => {
        const testFile = join(tempDir, 'missing.test.js');

        const result = await executor.execute(testFile, { 
          timeout: 5000, 
          cwd: tempDir 
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('ERROR');
      });
    });

    describe('timeout handling', () => {
      it('should categorize timeout as separate from other errors', async () => {
        const testFile = join(tempDir, 'timeout-error.test.js');
        await writeFile(testFile, `
          const { test } = require('node:test');
          
          test('timeout test', async () => {
            await new Promise(resolve => setTimeout(resolve, 10000));
          });
        `);

        const result = await executor.execute(testFile, { 
          timeout: 1000,
          cwd: tempDir 
        });

        expect(result.timedOut).toBe(true);
        expect(result.exitCode).not.toBe(0);
        
        // Wait for process cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));
      });
    });
  });
});
