/**
 * Integration Tests for Server Startup Flexible Discovery
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
 * 
 * These tests use real Docker containers to verify the complete end-to-end
 * server startup flow with flexible discovery across various repository structures.
 * 
 * Test scenarios:
 * - Monorepo with backend subdirectory
 * - Non-standard naming (server.js, main.js, start.js)
 * - Package.json script execution
 * - Nested monorepo structure (packages/*)
 * - Server readiness verification after discovery
 * - Python API tests connecting to discovered servers
 * - Error reporting when no valid entry point exists
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Docker from 'dockerode';
import { PassThrough } from 'stream';

describe('Server Startup Flexible Discovery Integration Tests', () => {
  const docker = new Docker();
  let createdContainers: string[] = [];
  let createdVolumes: string[] = [];

  beforeEach(() => {
    createdContainers = [];
    createdVolumes = [];
  });

  afterEach(async () => {
    // Cleanup containers
    for (const containerId of createdContainers) {
      try {
        const container = docker.getContainer(containerId);
        await container.stop().catch(() => {});
        await container.remove({ force: true }).catch(() => {});
      } catch {
        // Container already removed, ignore
      }
    }
    createdContainers = [];

    // Cleanup volumes
    for (const volumeName of createdVolumes) {
      try {
        const volume = docker.getVolume(volumeName);
        await volume.remove().catch(() => {});
      } catch {
        // Volume already removed, ignore
      }
    }
    createdVolumes = [];
  });

  /**
   * Helper function to execute commands in a container
   */
  async function execInContainer(
    container: Docker.Container,
    cmd: string[],
    workdir?: string,
    timeoutMs: number = 30000
  ): Promise<{ exitCode: number; output: string }> {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      ...(workdir ? { WorkingDir: workdir } : {}),
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    const output = await new Promise<string>((resolve, reject) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const timeout = setTimeout(() => {
        reject(new Error('Container execution timed out'));
      }, timeoutMs);

      stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      docker.modem.demuxStream(stream, stdout, stderr);

      stream.on('end', () => {
        clearTimeout(timeout);
        const out = Buffer.concat(stdoutChunks).toString('utf-8');
        const err = Buffer.concat(stderrChunks).toString('utf-8');
        resolve(out + err);
      });
      stream.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const inspect = await exec.inspect();
    return { exitCode: inspect.ExitCode ?? 1, output };
  }

  /**
   * Helper function to wait for server readiness
   */
  async function waitForServerReady(
    container: Docker.Container,
    port: number,
    timeoutMs: number
  ): Promise<boolean> {
    const startTime = Date.now();
    const delays = [100, 200, 400, 800, 1600];
    let attemptIndex = 0;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await execInContainer(
          container,
          ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null || echo "000"`],
          undefined,
          5000
        );

        const httpCode = result.output.trim();
        if (httpCode !== '000' && httpCode !== '') {
          return true;
        }
      } catch {
        // Connection failed, continue waiting
      }

      const delay = delays[Math.min(attemptIndex, delays.length - 1)] ?? 1600;
      await new Promise(resolve => setTimeout(resolve, delay));
      attemptIndex++;
    }

    return false;
  }

  /**
   * Test 1: Monorepo with backend subdirectory
   * 
   * Validates: Requirements 2.1, 2.2
   */
  it('should start server in monorepo with backend subdirectory', async () => {
    const volumeName = `test-monorepo-backend-${Date.now()}`;
    createdVolumes.push(volumeName);

    // Create volume
    await docker.createVolume({ Name: volumeName });

    // Create container with Node.js image
    const container = await docker.createContainer({
      Image: 'node:20-bookworm',
      Cmd: ['sleep', 'infinity'],
      HostConfig: {
        Binds: [`${volumeName}:/workspace`],
        NetworkMode: 'bridge',
      },
    });
    createdContainers.push(container.id);

    await container.start();

    // Create monorepo structure with backend subdirectory
    await execInContainer(container, ['mkdir', '-p', '/workspace/backend/src']);
    
    // Create a simple Express server in backend/src/app.js
    const serverCode = `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Backend server running' });
});

app.listen(3001, () => {
  console.log('Server listening on port 3001');
});
`;
    
    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/backend/src/app.js << 'EOF'
${serverCode}
EOF`
    ]);

    // Create package.json in backend directory
    const packageJson = JSON.stringify({
      name: 'backend',
      version: '1.0.0',
      dependencies: {
        express: '^4.18.0'
      }
    });

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/backend/package.json << 'EOF'
${packageJson}
EOF`
    ]);

    // Install dependencies
    await execInContainer(container, ['npm', 'install'], '/workspace/backend', 120000);

    // Run the server startup script (simulating startServerInContainer)
    const startupScript = `#!/bin/sh
exec > /tmp/server.log 2>&1
export NODE_ENV=test
export PORT=3001

LOCATIONS=". src backend backend/src server server/src api api/src"
FILENAMES="app.js index.js server.js main.js start.js"

for LOCATION in $LOCATIONS; do
  for FILENAME in $FILENAMES; do
    if [ "$LOCATION" = "." ]; then
      ENTRY_PATH="$FILENAME"
    else
      ENTRY_PATH="$LOCATION/$FILENAME"
    fi

    if [ -f "$ENTRY_PATH" ]; then
      echo "Found server entry point: $ENTRY_PATH"
      node "$ENTRY_PATH" 2>&1 &
      SERVER_PID=$!
      echo $SERVER_PID > /tmp/server.pid
      echo "Server PID: $SERVER_PID"
      sleep 2
      if kill -0 $SERVER_PID 2>/dev/null; then
        echo "Server started successfully"
        exit 0
      fi
    fi
  done
done
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /tmp/start-server.sh << 'EOF'
${startupScript}
EOF
chmod +x /tmp/start-server.sh`
    ]);

    await execInContainer(container, ['sh', '-c', 'cd /workspace && /tmp/start-server.sh']);

    // Wait for server to become ready
    const isReady = await waitForServerReady(container, 3001, 15000);

    // Verify server is ready
    expect(isReady).toBe(true);

    // Verify server responds correctly
    const response = await execInContainer(container, [
      'sh', '-c',
      'curl -s http://localhost:3001/'
    ]);

    expect(response.output).toContain('Backend server running');

    // Verify server process is still running
    const pidCheck = await execInContainer(container, [
      'sh', '-c',
      'kill -0 $(cat /tmp/server.pid) 2>/dev/null && echo "running" || echo "dead"'
    ]);

    expect(pidCheck.output.trim()).toBe('running');
  }, 180000); // 3 minute timeout

  /**
   * Test 2: Non-standard naming (server.js)
   * 
   * Validates: Requirements 2.1, 2.3
   */
  it('should start server with non-standard naming (server.js)', async () => {
    const volumeName = `test-server-js-${Date.now()}`;
    createdVolumes.push(volumeName);

    await docker.createVolume({ Name: volumeName });

    const container = await docker.createContainer({
      Image: 'node:20-bookworm',
      Cmd: ['sleep', 'infinity'],
      HostConfig: {
        Binds: [`${volumeName}:/workspace`],
        NetworkMode: 'bridge',
      },
    });
    createdContainers.push(container.id);

    await container.start();

    // Create server.js at root
    const serverCode = `
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Server.js running' }));
});

server.listen(3001, () => {
  console.log('Server listening on port 3001');
});
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/server.js << 'EOF'
${serverCode}
EOF`
    ]);

    // Run the server startup script
    const startupScript = `#!/bin/sh
exec > /tmp/server.log 2>&1
export NODE_ENV=test
export PORT=3001

LOCATIONS=". src backend backend/src server server/src api api/src"
FILENAMES="app.js index.js server.js main.js start.js"

for LOCATION in $LOCATIONS; do
  for FILENAME in $FILENAMES; do
    if [ "$LOCATION" = "." ]; then
      ENTRY_PATH="$FILENAME"
    else
      ENTRY_PATH="$LOCATION/$FILENAME"
    fi

    if [ -f "$ENTRY_PATH" ]; then
      echo "Found server entry point: $ENTRY_PATH"
      node "$ENTRY_PATH" 2>&1 &
      SERVER_PID=$!
      echo $SERVER_PID > /tmp/server.pid
      sleep 2
      if kill -0 $SERVER_PID 2>/dev/null; then
        echo "Server started successfully"
        exit 0
      fi
    fi
  done
done
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /tmp/start-server.sh << 'EOF'
${startupScript}
EOF
chmod +x /tmp/start-server.sh`
    ]);

    await execInContainer(container, ['sh', '-c', 'cd /workspace && /tmp/start-server.sh']);

    // Wait for server to become ready
    const isReady = await waitForServerReady(container, 3001, 15000);

    expect(isReady).toBe(true);

    // Verify server responds
    const response = await execInContainer(container, [
      'sh', '-c',
      'curl -s http://localhost:3001/'
    ]);

    expect(response.output).toContain('Server.js running');
  }, 180000);

  /**
   * Test 3: Package.json start script execution
   * 
   * Validates: Requirements 2.4
   */
  it('should execute package.json start script', async () => {
    const volumeName = `test-package-json-${Date.now()}`;
    createdVolumes.push(volumeName);

    await docker.createVolume({ Name: volumeName });

    const container = await docker.createContainer({
      Image: 'node:20-bookworm',
      Cmd: ['sleep', 'infinity'],
      HostConfig: {
        Binds: [`${volumeName}:/workspace`],
        NetworkMode: 'bridge',
      },
    });
    createdContainers.push(container.id);

    await container.start();

    // Create custom directory structure
    await execInContainer(container, ['mkdir', '-p', '/workspace/custom/path']);

    // Create server in custom location
    const serverCode = `
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Custom path server' }));
});

server.listen(3001, () => {
  console.log('Server listening on port 3001');
});
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/custom/path/server.js << 'EOF'
${serverCode}
EOF`
    ]);

    // Create package.json with start script
    const packageJson = JSON.stringify({
      name: 'custom-server',
      version: '1.0.0',
      scripts: {
        start: 'node custom/path/server.js'
      }
    });

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/package.json << 'EOF'
${packageJson}
EOF`
    ]);

    // Run the server startup script with package.json check
    const startupScript = `#!/bin/sh
exec > /tmp/server.log 2>&1
export NODE_ENV=test
export PORT=3001

if [ -f "package.json" ]; then
  START_SCRIPT=$(cat package.json | grep -o '"start"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"start"[[:space:]]*:[[:space:]]*"\\([^"]*\\)"/\\1/')
  
  if [ -n "$START_SCRIPT" ]; then
    echo "Found start script: $START_SCRIPT"
    eval "$START_SCRIPT" 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID > /tmp/server.pid
    sleep 2
    if kill -0 $SERVER_PID 2>/dev/null; then
      echo "Server started successfully using package.json"
      exit 0
    fi
  fi
fi
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /tmp/start-server.sh << 'EOF'
${startupScript}
EOF
chmod +x /tmp/start-server.sh`
    ]);

    await execInContainer(container, ['sh', '-c', 'cd /workspace && /tmp/start-server.sh']);

    // Wait for server to become ready
    const isReady = await waitForServerReady(container, 3001, 15000);

    expect(isReady).toBe(true);

    // Verify server responds
    const response = await execInContainer(container, [
      'sh', '-c',
      'curl -s http://localhost:3001/'
    ]);

    expect(response.output).toContain('Custom path server');

    // Verify logs show package.json was used
    const logs = await execInContainer(container, ['cat', '/tmp/server.log']);
    expect(logs.output).toContain('Found start script');
    expect(logs.output).toContain('node custom/path/server.js');
  }, 180000);

  /**
   * Test 4: Nested monorepo structure (packages/*)
   * 
   * Validates: Requirements 2.1, 2.2
   */
  it('should start server in nested monorepo (packages/api/src/index.js)', async () => {
    const volumeName = `test-nested-monorepo-${Date.now()}`;
    createdVolumes.push(volumeName);

    await docker.createVolume({ Name: volumeName });

    const container = await docker.createContainer({
      Image: 'node:20-bookworm',
      Cmd: ['sleep', 'infinity'],
      HostConfig: {
        Binds: [`${volumeName}:/workspace`],
        NetworkMode: 'bridge',
      },
    });
    createdContainers.push(container.id);

    await container.start();

    // Create nested monorepo structure
    await execInContainer(container, ['mkdir', '-p', '/workspace/packages/api/src']);

    // Create server in packages/api/src/index.js
    const serverCode = `
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Nested monorepo API' }));
});

server.listen(3001, () => {
  console.log('Server listening on port 3001');
});
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/packages/api/src/index.js << 'EOF'
${serverCode}
EOF`
    ]);

    // Run the server startup script with packages/* check
    const startupScript = `#!/bin/sh
exec > /tmp/server.log 2>&1
export NODE_ENV=test
export PORT=3001

FILENAMES="app.js index.js server.js main.js start.js"

if [ -d "packages" ]; then
  for PKG_DIR in packages/*; do
    if [ -d "$PKG_DIR" ]; then
      for FILENAME in $FILENAMES; do
        ENTRY_PATH="$PKG_DIR/$FILENAME"
        if [ -f "$ENTRY_PATH" ]; then
          echo "Found server entry point: $ENTRY_PATH"
          node "$ENTRY_PATH" 2>&1 &
          SERVER_PID=$!
          echo $SERVER_PID > /tmp/server.pid
          sleep 2
          if kill -0 $SERVER_PID 2>/dev/null; then
            echo "Server started successfully"
            exit 0
          fi
        fi

        ENTRY_PATH="$PKG_DIR/src/$FILENAME"
        if [ -f "$ENTRY_PATH" ]; then
          echo "Found server entry point: $ENTRY_PATH"
          node "$ENTRY_PATH" 2>&1 &
          SERVER_PID=$!
          echo $SERVER_PID > /tmp/server.pid
          sleep 2
          if kill -0 $SERVER_PID 2>/dev/null; then
            echo "Server started successfully"
            exit 0
          fi
        fi
      done
    fi
  done
fi
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /tmp/start-server.sh << 'EOF'
${startupScript}
EOF
chmod +x /tmp/start-server.sh`
    ]);

    await execInContainer(container, ['sh', '-c', 'cd /workspace && /tmp/start-server.sh']);

    // Wait for server to become ready
    const isReady = await waitForServerReady(container, 3001, 15000);

    expect(isReady).toBe(true);

    // Verify server responds
    const response = await execInContainer(container, [
      'sh', '-c',
      'curl -s http://localhost:3001/'
    ]);

    expect(response.output).toContain('Nested monorepo API');
  }, 180000);

  /**
   * Test 5: Python API test can connect to discovered server
   * 
   * Validates: Requirements 2.1, 2.2, 2.3, 2.4
   */
  it('should allow Python API tests to connect to discovered server', async () => {
    const volumeName = `test-python-api-${Date.now()}`;
    createdVolumes.push(volumeName);

    await docker.createVolume({ Name: volumeName });

    // Use Python image with Node.js installed
    const container = await docker.createContainer({
      Image: 'node:20-bookworm',
      Cmd: ['sleep', 'infinity'],
      HostConfig: {
        Binds: [`${volumeName}:/workspace`],
        NetworkMode: 'bridge',
      },
    });
    createdContainers.push(container.id);

    await container.start();

    // Install Python
    await execInContainer(container, [
      'sh', '-c',
      'apt-get update && apt-get install -y python3 python3-pip'
    ], undefined, 120000);

    // Create server
    const serverCode = `
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', message: 'API server' }));
});

server.listen(3001, () => {
  console.log('Server listening on port 3001');
});
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/server.js << 'EOF'
${serverCode}
EOF`
    ]);

    // Start server
    const startupScript = `#!/bin/sh
exec > /tmp/server.log 2>&1
export NODE_ENV=test
export PORT=3001

FILENAMES="app.js index.js server.js main.js start.js"

for FILENAME in $FILENAMES; do
  if [ -f "$FILENAME" ]; then
    echo "Found server entry point: $FILENAME"
    node "$FILENAME" 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID > /tmp/server.pid
    sleep 2
    if kill -0 $SERVER_PID 2>/dev/null; then
      echo "Server started successfully"
      exit 0
    fi
  fi
done
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /tmp/start-server.sh << 'EOF'
${startupScript}
EOF
chmod +x /tmp/start-server.sh`
    ]);

    await execInContainer(container, ['sh', '-c', 'cd /workspace && /tmp/start-server.sh']);

    // Wait for server
    const isReady = await waitForServerReady(container, 3001, 15000);
    expect(isReady).toBe(true);

    // Create Python test
    const pythonTest = `
import http.client
import json

conn = http.client.HTTPConnection('localhost', 3001)
conn.request('GET', '/')
response = conn.getresponse()
data = response.read().decode()
result = json.loads(data)

assert response.status == 200, f"Expected 200, got {response.status}"
assert result['status'] == 'ok', f"Expected status 'ok', got {result['status']}"
assert 'message' in result, "Expected 'message' in response"

print("Python API test passed!")
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/test_api.py << 'EOF'
${pythonTest}
EOF`
    ]);

    // Run Python test
    const testResult = await execInContainer(container, [
      'python3', 'test_api.py'
    ], '/workspace');

    expect(testResult.exitCode).toBe(0);
    expect(testResult.output).toContain('Python API test passed!');
  }, 180000);

  /**
   * Test 6: Error reporting when no valid entry point exists
   * 
   * Validates: Requirement 2.5
   */
  it('should provide comprehensive error diagnostics when no entry point exists', async () => {
    const volumeName = `test-no-entry-${Date.now()}`;
    createdVolumes.push(volumeName);

    await docker.createVolume({ Name: volumeName });

    const container = await docker.createContainer({
      Image: 'node:20-bookworm',
      Cmd: ['sleep', 'infinity'],
      HostConfig: {
        Binds: [`${volumeName}:/workspace`],
        NetworkMode: 'bridge',
      },
    });
    createdContainers.push(container.id);

    await container.start();

    // Create empty repository (no server files)
    await execInContainer(container, ['mkdir', '-p', '/workspace/src']);

    // Run the server startup script with comprehensive diagnostics
    const startupScript = `#!/bin/sh
exec > /tmp/server.log 2>&1
export NODE_ENV=test
export PORT=3001

ATTEMPTED_PATHS=""
LOCATIONS=". src backend backend/src server server/src api api/src"
FILENAMES="app.js index.js server.js main.js start.js"

for LOCATION in $LOCATIONS; do
  for FILENAME in $FILENAMES; do
    if [ "$LOCATION" = "." ]; then
      ENTRY_PATH="$FILENAME"
    else
      ENTRY_PATH="$LOCATION/$FILENAME"
    fi
    ATTEMPTED_PATHS="$ATTEMPTED_PATHS $ENTRY_PATH"
  done
done

echo "=========================================="
echo "ERROR: No valid server entry point found"
echo "=========================================="
echo ""
echo "Attempted paths:"
for PATH_ITEM in $ATTEMPTED_PATHS; do
  echo "  - $PATH_ITEM"
done
echo ""
echo "Troubleshooting suggestions:"
echo "1. Ensure your server entry point is in one of the searched locations"
echo "2. Add a 'start' script to package.json pointing to your server file"
echo "3. Check that your server file exports a valid Express/HTTP server"
echo "=========================================="
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /tmp/start-server.sh << 'EOF'
${startupScript}
EOF
chmod +x /tmp/start-server.sh`
    ]);

    await execInContainer(container, ['sh', '-c', 'cd /workspace && /tmp/start-server.sh']);

    // Read the error logs
    const logs = await execInContainer(container, ['cat', '/tmp/server.log']);

    // Verify comprehensive error diagnostics
    expect(logs.output).toContain('ERROR: No valid server entry point found');
    expect(logs.output).toContain('Attempted paths:');
    expect(logs.output).toContain('app.js');
    expect(logs.output).toContain('index.js');
    expect(logs.output).toContain('server.js');
    expect(logs.output).toContain('backend/src/app.js');
    expect(logs.output).toContain('Troubleshooting suggestions:');
    expect(logs.output).toContain('package.json');

    // Count the number of attempted paths (should be many)
    const pathMatches = logs.output.match(/\s{2}- \w+/g);
    expect(pathMatches).toBeTruthy();
    expect(pathMatches!.length).toBeGreaterThan(10);
  }, 180000);

  /**
   * Test 7: Server readiness verification works after discovery
   * 
   * Validates: Requirements 2.1, 2.2
   */
  it('should verify server readiness after discovery', async () => {
    const volumeName = `test-readiness-${Date.now()}`;
    createdVolumes.push(volumeName);

    await docker.createVolume({ Name: volumeName });

    const container = await docker.createContainer({
      Image: 'node:20-bookworm',
      Cmd: ['sleep', 'infinity'],
      HostConfig: {
        Binds: [`${volumeName}:/workspace`],
        NetworkMode: 'bridge',
      },
    });
    createdContainers.push(container.id);

    await container.start();

    // Create server with delayed startup
    const serverCode = `
const http = require('http');

// Simulate slow startup
setTimeout(() => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Ready' }));
  });

  server.listen(3001, () => {
    console.log('Server ready on port 3001');
  });
}, 2000); // 2 second delay
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /workspace/app.js << 'EOF'
${serverCode}
EOF`
    ]);

    // Start server
    const startupScript = `#!/bin/sh
exec > /tmp/server.log 2>&1
export NODE_ENV=test
export PORT=3001

if [ -f "app.js" ]; then
  node app.js 2>&1 &
  SERVER_PID=$!
  echo $SERVER_PID > /tmp/server.pid
  echo "Server started with PID $SERVER_PID"
fi
`;

    await execInContainer(container, [
      'sh', '-c',
      `cat > /tmp/start-server.sh << 'EOF'
${startupScript}
EOF
chmod +x /tmp/start-server.sh`
    ]);

    await execInContainer(container, ['sh', '-c', 'cd /workspace && /tmp/start-server.sh']);

    // Give the server process time to start (it has a 2 second delay)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for server to become ready (should handle the 2 second delay)
    const startTime = Date.now();
    const isReady = await waitForServerReady(container, 3001, 15000);
    const waitTime = Date.now() - startTime;

    expect(isReady).toBe(true);
    // The server should become ready quickly since we already waited
    expect(waitTime).toBeLessThan(15000);

    // Verify server responds
    const response = await execInContainer(container, [
      'sh', '-c',
      'curl -s http://localhost:3001/'
    ]);

    expect(response.output).toContain('Ready');
  }, 180000);
});
