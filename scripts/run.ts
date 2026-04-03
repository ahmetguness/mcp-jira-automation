#!/usr/bin/env node

/**
 * Cross-platform script runner
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type Command = 'run' | 'mcp' | 'app' | 'help' | '--help' | '-h';

const isWindows = process.platform === 'win32';
const command = (process.argv[2] || 'help') as Command;

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
🚀 MCP Jira Automation CLI

Usage:
  mja run          Start everything (MCP + App) in one terminal
  mja mcp          Start only MCP Atlassian
  mja app          Start only main app
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

function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(filePath)) return env;
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) env[key] = value;
  }
  return env;
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

function killPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const pids = new Set<string>();
      for (const line of result.split('\n')) {
        const match = line.trim().match(/\s+(\d+)$/);
        if (match?.[1]) pids.add(match[1]);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch {}
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
    }
  } catch {
    // port already free
  }
}

function startMcp(): ChildProcess {
  const envFile = join(projectRoot, 'mcp-atlassian.env');
  if (!existsSync(envFile)) {
    console.error('❌ mcp-atlassian.env not found! Copy from mcp-atlassian.env.example');
    process.exit(1);
  }
  const mcpEnv = loadEnvFile(envFile);
  const env = { ...process.env, ...mcpEnv };

  const proc = spawn('mcp-atlassian', ['--transport', 'sse', '--port', '9000'], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  prefixStream(proc, '[MCP]  ');
  return proc;
}

function startApp(): ChildProcess {
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  prefixStream(proc, '[APP]  ');
  return proc;
}

if (command === 'mcp') {
  console.log('🚀 Starting MCP Atlassian...\n');
  const proc = startMcp();
  proc.on('exit', (code) => process.exit(code || 0));
} else if (command === 'app') {
  console.log('🚀 Starting main app...\n');
  const proc = startApp();
  proc.on('exit', (code) => process.exit(code || 0));
} else if (command === 'run') {
  console.log('🚀 Starting MCP Atlassian + App in single terminal...\n');

  console.log('[INFO]  Clearing port 9000...');
  killPort(9000);

  const mcpProc = startMcp();
  let appProc: ChildProcess | null = null;

  // Wait a bit for MCP to initialize, then start app
  setTimeout(() => {
    console.log('[INFO]  MCP initialized, starting main app...\n');
    appProc = startApp();
    appProc.on('exit', (code) => {
      console.log(`\n[INFO]  App exited (${code}), stopping MCP...`);
      mcpProc.kill();
      process.exit(code || 0);
    });
  }, 5000);

  mcpProc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`\n[INFO]  MCP exited (${code}), stopping app...`);
      appProc?.kill();
      process.exit(code);
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n[INFO]  Shutting down...');
    appProc?.kill();
    mcpProc.kill();
    process.exit(0);
  });
} else {
  console.error(`❌ Unknown command: ${command}`);
  console.log('Run "mja help" for usage information.');
  process.exit(1);
}
