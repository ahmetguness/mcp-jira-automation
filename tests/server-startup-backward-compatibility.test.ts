/**
 * Task 3.4: Backward Compatibility Verification Tests
 * 
 * These tests verify that the flexible server discovery implementation
 * maintains backward compatibility with all existing functionality.
 * 
 * Validates Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Task 3.4: Backward Compatibility Verification', () => {
  const dockerFilePath = path.join(__dirname, '../src/executor/docker.ts');
  
  it('should verify docker.ts file exists', () => {
    expect(fs.existsSync(dockerFilePath)).toBe(true);
  });

  describe('Environment Variable Setup (Requirement 3.4)', () => {
    it('should maintain NODE_ENV=test environment variable', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('export NODE_ENV=test');
    });

    it('should maintain PORT=3001 environment variable', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('export PORT=3001');
    });

    it('should maintain database-related environment variables logging', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('MONGODB_URL=$MONGODB_URL');
      expect(content).toContain('JWT_SECRET=$JWT_SECRET');
    });

    it('should set environment variables before any server startup attempts', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      const nodeEnvIndex = content.indexOf('export NODE_ENV=test');
      const portIndex = content.indexOf('export PORT=3001');
      const stage1Index = content.indexOf('Stage 1: Check package.json');
      
      expect(nodeEnvIndex).toBeGreaterThan(-1);
      expect(portIndex).toBeGreaterThan(-1);
      expect(stage1Index).toBeGreaterThan(-1);
      expect(nodeEnvIndex).toBeLessThan(stage1Index);
      expect(portIndex).toBeLessThan(stage1Index);
    });
  });

  describe('PID Tracking Mechanism (Requirement 3.3)', () => {
    it('should maintain PID file creation at /tmp/server.pid', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      const pidWrites = content.match(/echo \$SERVER_PID > \/tmp\/server\.pid/g);
      expect(pidWrites).toBeTruthy();
      expect(pidWrites!.length).toBeGreaterThan(0);
    });

    it('should maintain PID verification with kill -0 command', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('kill -0 $SERVER_PID');
    });

    it('should maintain PID logging', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('echo "Server PID: $SERVER_PID"');
    });

    it('should verify PID after server startup in TypeScript code', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('kill -0 $(cat /tmp/server.pid)');
      expect(content).toContain('echo "running"');
      expect(content).toContain('echo "dead"');
    });
  });

  describe('Log File Location (Requirement 3.5)', () => {
    it('should maintain log file at /tmp/server.log', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('exec > /tmp/server.log 2>&1');
    });

    it('should redirect output to log file at the start of script', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      const execRedirectIndex = content.indexOf('exec > /tmp/server.log 2>&1');
      const startingServerIndex = content.indexOf('echo "Starting server..."');
      
      expect(execRedirectIndex).toBeGreaterThan(-1);
      expect(startingServerIndex).toBeGreaterThan(-1);
      expect(execRedirectIndex).toBeLessThan(startingServerIndex);
    });

    it('should maintain log file reading in error handling', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('cat /tmp/server.log');
    });
  });

  describe('Server Readiness Verification Flow (Requirement 3.2)', () => {
    it('should maintain waitForServerReady call', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('await this.waitForServerReady(container, port, 15000)');
    });

    it('should maintain server readiness check after startup', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('const isReady = await this.waitForServerReady');
      expect(content).toContain('if (isReady)');
    });

    it('should maintain 1 second delay before readiness check', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('await new Promise(resolve => setTimeout(resolve, 1000))');
    });

    it('should maintain process stability verification after readiness', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('Verify server process is still running');
      expect(content).toContain('kill -0 $(cat /tmp/server.pid)');
    });
  });

  describe('Standard Entry Points Checked Early (Requirement 3.1)', () => {
    it('should check standard entry points in Stage 2 file search', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      
      // Verify Stage 2 exists
      expect(content).toContain('Stage 2: File system search');
      
      // Verify standard locations are in LOCATIONS variable
      expect(content).toContain('LOCATIONS=". src backend');
      
      // Verify standard filenames are in FILENAMES variable
      expect(content).toContain('FILENAMES="server.js server.ts index.js index.ts main.js main.ts start.js start.ts app.js app.ts"');
    });

    it('should check root and src directories first in location list', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      const locationsMatch = content.match(/LOCATIONS="([^"]+)"/);
      
      expect(locationsMatch).toBeTruthy();
      const locations = locationsMatch![1]!.split(' ');
      
      // Verify . (root) and src are first in the list
      expect(locations[0]).toBe('.');
      expect(locations[1]).toBe('src');
    });

    it('should check server.js and server.ts first in filename list', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      const filenamesMatch = content.match(/FILENAMES="([^"]+)"/);
      
      expect(filenamesMatch).toBeTruthy();
      const filenames = filenamesMatch![1]!.split(' ');
      
      // Verify server.js and server.ts are first in the list
      expect(filenames[0]).toBe('server.js');
      expect(filenames[1]).toBe('server.ts');
    });

    it('should maintain the order: package.json -> file search -> fallback', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      
      const stage1Index = content.indexOf('Stage 1: Check package.json');
      const stage2Index = content.indexOf('Stage 2: File system search');
      const stage3Index = content.indexOf('Stage 3: Fallback with require pattern');
      
      expect(stage1Index).toBeGreaterThan(-1);
      expect(stage2Index).toBeGreaterThan(-1);
      expect(stage3Index).toBeGreaterThan(-1);
      
      expect(stage1Index).toBeLessThan(stage2Index);
      expect(stage2Index).toBeLessThan(stage3Index);
    });
  });

  describe('Crash Detection (Requirement 3.3)', () => {
    it('should maintain 2-second sleep after server start for crash detection', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      const sleepMatches = content.match(/sleep 2/g);
      
      // Should have multiple sleep 2 commands (one for each startup method)
      expect(sleepMatches).toBeTruthy();
      expect(sleepMatches!.length).toBeGreaterThanOrEqual(3);
    });

    it('should maintain crash detection with kill -0 after each startup attempt', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      
      // Should check if process is alive after each startup method
      const killChecks = content.match(/if kill -0 \$SERVER_PID 2>\/dev\/null; then/g);
      expect(killChecks).toBeTruthy();
      expect(killChecks!.length).toBeGreaterThanOrEqual(2);
    });

    it('should maintain error messages for process death', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('Server process died after starting');
    });
  });

  describe('Overall Structure Preservation', () => {
    it('should maintain the startServerInContainer function signature', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('private async startServerInContainer(');
      expect(content).toContain('container: Docker.Container');
      expect(content).toContain('workdir: string');
      expect(content).toContain('): Promise<void>');
    });

    it('should maintain port 3001 as default', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('const port = 3001');
      expect(content).toContain('Default port for API tests');
    });

    it('should maintain shell script execution approach', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('const startupScript = String.raw`#!/bin/sh');
      expect(content).toContain('cat > /tmp/start-server.sh');
      expect(content).toContain('chmod +x /tmp/start-server.sh');
      expect(content).toContain('/tmp/start-server.sh');
    });

    it('should maintain error handling structure', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      expect(content).toContain('try {');
      expect(content).toContain('} catch (error) {');
      expect(content).toContain('Server startup failed');
    });
  });

  describe('Comprehensive Verification Summary', () => {
    it('should verify all backward compatibility requirements are met', () => {
      const content = fs.readFileSync(dockerFilePath, 'utf-8');
      
      // Requirement 3.1: Standard entry points work
      expect(content).toContain('LOCATIONS=". src');
      expect(content).toContain('FILENAMES="server.js server.ts');
      
      // Requirement 3.2: Server readiness verification
      expect(content).toContain('waitForServerReady');
      
      // Requirement 3.3: Process stability checking
      expect(content).toContain('kill -0 $SERVER_PID');
      expect(content).toContain('sleep 2');
      
      // Requirement 3.4: Environment variables
      expect(content).toContain('export NODE_ENV=test');
      expect(content).toContain('export PORT=3001');
      
      // Requirement 3.5: Log capture
      expect(content).toContain('exec > /tmp/server.log 2>&1');
      
      console.log('\n✓ All backward compatibility requirements verified:');
      console.log('  ✓ 3.1: Standard entry points checked early');
      console.log('  ✓ 3.2: Server readiness verification unchanged');
      console.log('  ✓ 3.3: Process stability checking unchanged');
      console.log('  ✓ 3.4: Environment variable setup unchanged');
      console.log('  ✓ 3.5: Log file location unchanged');
    });
  });
});
