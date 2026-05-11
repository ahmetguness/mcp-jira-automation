#!/usr/bin/env node

/**
 * Cross-platform script runner
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type Command = 'app' | 'help' | '--help' | '-h';

const command = (process.argv[2] || 'help') as Command;

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
🚀 MCP Jira Automation CLI

Usage:
  mja app          Start the main app (MCP must already be running)
  mja help         Show this help message
`);
  process.exit(0);
}

function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(currentDir, 'package.json'))) return currentDir;
    const parentDir = join(currentDir, '..');
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return process.cwd();
}

function prefixStream(proc: ChildProcess, prefix: string) {
  const write = (chunk: Buffer | string) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) process.stdout.write(`${prefix} ${line}\n`);
    }
  };
  proc.stdout?.on('data', write);
  proc.stderr?.on('data', write);
}

const projectRoot = findProjectRoot(process.cwd());

function startApp(): ChildProcess {
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  prefixStream(proc, '[APP]  ');
  return proc;
}

if (command === 'app') {
  console.log('🚀 Starting main app...\n');
  const proc = startApp();
  proc.on('exit', (code) => process.exit(code || 0));
} else {
  console.error(`❌ Unknown command: ${command}`);
  console.log('Run "mja help" for usage information.');
  process.exit(1);
}
