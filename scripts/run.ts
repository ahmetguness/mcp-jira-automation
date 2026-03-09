#!/usr/bin/env node

/**
 * Cross-platform script runner
 * Detects OS and runs appropriate startup script
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type Command = 'run' | 'mcp' | 'app' | 'help' | '--help' | '-h';
type Platform = 'windows' | 'unix';
type ScriptCommand = 'run' | 'mcp' | 'app';

interface ScriptMap {
  windows: Record<ScriptCommand, string>;
  unix: Record<ScriptCommand, string>;
}

const isWindows = process.platform === 'win32';
const command = (process.argv[2] || 'help') as Command;

// Help message
if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
🚀 MCP Jira Automation CLI

Usage:
  mja run          Start everything (MCP + App)
  mja mcp          Start only MCP Atlassian
  mja app          Start only main app
  mja help         Show this help message

Examples:
  mja run          # Start all services
  mja mcp          # Start MCP server only
`);
  process.exit(0);
}

const scriptMap: ScriptMap = {
  windows: {
    run: 'windows/start-all.bat',
    mcp: 'windows/start-mcp-only.bat',
    app: 'windows/start-app-only.bat'
  },
  unix: {
    run: 'unix/start-all.sh',
    mcp: 'unix/start-mcp-only.sh',
    app: 'unix/start-app-only.sh'
  }
};

const platform: Platform = isWindows ? 'windows' : 'unix';

if (!scriptMap[platform][command as ScriptCommand]) {
  console.error(`❌ Unknown command: ${command}`);
  console.log('Run "mja help" for usage information.');
  process.exit(1);
}

// Find project root by looking for package.json
import { existsSync } from 'fs';

function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  
  // Go up max 5 levels to find package.json
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return currentDir;
    }
    const parentDir = join(currentDir, '..');
    if (parentDir === currentDir) break; // Reached root
    currentDir = parentDir;
  }
  
  // Fallback to cwd
  return process.cwd();
}

const projectRoot = findProjectRoot(process.cwd());
const scriptPath = join(projectRoot, 'scripts', scriptMap[platform][command as ScriptCommand]);

console.log(`🚀 Starting ${command} on ${platform}...`);
console.log(`📂 Script: ${scriptPath}\n`);

const shell = isWindows ? 'cmd.exe' : 'bash';
const args = isWindows ? ['/c', scriptPath] : [scriptPath];

const child = spawn(shell, args, {
  stdio: 'inherit',
  cwd: projectRoot
});

child.on('error', (error: Error) => {
  console.error(`❌ Error: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code: number | null) => {
  process.exit(code || 0);
});
