/**
 * Server lifecycle manager — starts application servers inside Docker containers
 * and waits for them to become ready.
 *
 * Extracted from docker.ts to separate server management from container orchestration.
 */

import type Docker from "dockerode";
import { createLogger } from "../logger.js";

const log = createLogger("executor:server");

type ExecInContainerFn = (
    container: Docker.Container,
    cmd: string[],
    workdir?: string,
    customTimeoutMs?: number,
) => Promise<{ exitCode: number; output: string }>;

/**
 * Determine if server startup is needed based on execution mode and commands.
 * In "remote" mode, tests target an external API_BASE_URL — no server startup.
 * In "sandbox" mode, the backend is started inside the container.
 */
export function shouldStartServer(commands: string[], _language: string, executionMode?: "remote" | "sandbox"): boolean {
    if (executionMode === "remote") {
        return false;
    }
    return commands.some(cmd => cmd.includes('python') && cmd.includes('.py'));
}

/**
 * Start application server in container before running tests.
 * Returns the detected port the server is listening on (0 if failed).
 */
export async function startServerInContainer(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    workdir: string,
): Promise<number> {
    const candidatePorts = [3001, 3000, 8080, 8000, 5000, 4000];

    const startupScript = buildStartupScript();

    try {
        // Write the startup script
        await execInContainer(
            container,
            ['sh', '-c', `cat > /tmp/start-server.sh << 'EOFSCRIPT'\n${startupScript}\nEOFSCRIPT\nchmod +x /tmp/start-server.sh`],
            workdir,
            5000,
        );

        // Run the startup script
        await execInContainer(container, ['sh', '-c', `/tmp/start-server.sh`], workdir, 30000);

        // Give server more time to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Wait for server to become ready — try multiple ports
        let detectedPort = 0;
        for (const candidatePort of candidatePorts) {
            const isReady = await waitForServerReady(execInContainer, container, candidatePort, 10000);
            if (isReady) {
                detectedPort = candidatePort;
                break;
            }
        }

        // Extended port scan if no port found yet
        if (detectedPort === 0) {
            log.debug('Extended port scan...');
            for (let attempt = 0; attempt < 15; attempt++) {
                for (const candidatePort of candidatePorts) {
                    try {
                        const check = await execInContainer(
                            container,
                            ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 http://localhost:${candidatePort}/ 2>/dev/null; echo ""`],
                            undefined,
                            3000,
                        );
                        const code = check.output.trim().split('\n').map(l => l.trim()).find(l => /^\d{3}$/.test(l)) ?? '000';
                        if (code !== '000') {
                            detectedPort = candidatePort;
                            log.debug(`Server found on port ${candidatePort} (HTTP ${code})`);
                            break;
                        }
                    } catch { /* continue */ }
                }
                if (detectedPort > 0) break;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (detectedPort > 0) {
            await execInContainer(
                container,
                ['sh', '-c', `echo ${detectedPort} > /tmp/server-port`],
                workdir,
                5000,
            );
            return detectedPort;
        } else {
            const logsResult = await execInContainer(
                container,
                ['sh', '-c', 'cat /tmp/server.log 2>/dev/null || echo "No server logs"'],
                workdir,
                5000,
            );
            log.warn(`Could not start server. Server logs:\n${logsResult.output}`);
            return 0;
        }
    } catch (error) {
        log.warn(`Server startup failed: ${(error as Error).message}`);
        return 0;
    }
}

/**
 * Wait for server to become ready by polling the port.
 */
async function waitForServerReady(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    port: number,
    timeoutMs: number,
): Promise<boolean> {
    const startTime = Date.now();
    const delays = [100, 200, 400, 800, 1600];
    let attemptIndex = 0;

    while (Date.now() - startTime < timeoutMs) {
        try {
            const result = await execInContainer(
                container,
                ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:${port}/ 2>/dev/null; echo ""`],
                undefined,
                5000,
            );

            const httpCode = result.output.trim().split('\n').map(l => l.trim()).find(l => /^\d{3}$/.test(l)) ?? '000';

            if (httpCode !== '000') {
                log.debug(`waitForServerReady: port ${port} responded with HTTP ${httpCode}`);
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
 * Verify server is still running before executing a test command.
 * Returns true if server is responding.
 */
export async function verifyServerRunning(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    workdir: string,
    serverPort: number,
): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt++) {
        const serverCheck = await execInContainer(
            container,
            ['sh', '-c', `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:${serverPort}/ 2>/dev/null; echo ""`],
            workdir,
            5000,
        );
        const httpCode = serverCheck.output.trim().split('\n').map(l => l.trim()).find(l => /^\d{3}$/.test(l)) ?? '000';

        if (httpCode !== '000') {
            return true;
        }

        if (attempt < 9) {
            log.debug(`Server not ready on port ${serverPort}, retrying... (${attempt + 1}/10)`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    log.error(`Server not responding on port ${serverPort} after 10 retries`);
    const debugInfo = await execInContainer(
        container,
        ['sh', '-c', `
echo "=== Server Logs ==="
cat /tmp/server.log 2>/dev/null || echo "No server logs"
echo ""
echo "=== PID Check ==="
if [ -f /tmp/server.pid ]; then
  PID=$(cat /tmp/server.pid)
  echo "PID file contains: $PID"
  if kill -0 $PID 2>/dev/null; then echo "Process $PID is alive"; else echo "Process $PID is dead"; fi
else echo "No PID file"; fi
echo ""
echo "=== Listening Ports ==="
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Cannot check ports"
echo ""
echo "=== Node Processes ==="
ps aux | grep node | grep -v grep || echo "No node processes"
`],
        workdir,
        10000,
    );
    log.error(`Server debug info:\n${debugInfo.output}`);
    return false;
}

// ─── Startup Script ──────────────────────────────────────────

function buildStartupScript(): string {
    return String.raw`#!/bin/sh
# Redirect all output to log file
exec > /tmp/server.log 2>&1

# Set common environment variables that apps might need
export NODE_ENV=test
export PORT=3001
export FLASK_APP=app.py
export FLASK_ENV=testing
export DJANGO_SETTINGS_MODULE=config.settings

echo "Starting server..."
ATTEMPTED_METHODS=""

# ─── Python server detection ───
try_python_server() {
  # Django
  if [ -f "manage.py" ]; then
    echo "Django project detected"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, django: manage.py runserver"
    python manage.py runserver 0.0.0.0:$PORT 2>&1 &
    SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
    sleep 3
    if kill -0 $SERVER_PID 2>/dev/null; then echo "Django started"; exit 0; fi
  fi
  # FastAPI (uvicorn)
  for ENTRY in main.py app.py src/main.py src/app.py; do
    if [ -f "$ENTRY" ] && grep -q "FastAPI\|fastapi" "$ENTRY" 2>/dev/null; then
      PYMODULE=$(echo "$ENTRY" | sed 's|/|.|g; s|\.py$||')
      echo "FastAPI detected: $ENTRY"
      ATTEMPTED_METHODS="$ATTEMPTED_METHODS, fastapi: $PYMODULE"
      if command -v uvicorn > /dev/null 2>&1; then
        uvicorn "$PYMODULE:app" --host 0.0.0.0 --port $PORT 2>&1 &
      else
        python -m uvicorn "$PYMODULE:app" --host 0.0.0.0 --port $PORT 2>&1 &
      fi
      SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
      sleep 3
      if kill -0 $SERVER_PID 2>/dev/null; then echo "FastAPI started"; exit 0; fi
    fi
  done
  # Flask
  for ENTRY in app.py main.py src/app.py src/main.py; do
    if [ -f "$ENTRY" ] && grep -q "Flask\|flask" "$ENTRY" 2>/dev/null; then
      echo "Flask detected: $ENTRY"
      ATTEMPTED_METHODS="$ATTEMPTED_METHODS, flask: $ENTRY"
      python "$ENTRY" 2>&1 &
      SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
      sleep 3
      if kill -0 $SERVER_PID 2>/dev/null; then echo "Flask started"; exit 0; fi
    fi
  done
}

# ─── Go server detection ───
try_go_server() {
  if [ -f "go.mod" ]; then
    echo "Go project detected"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, go: go run ."
    go run . 2>&1 &
    SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
    sleep 5
    if kill -0 $SERVER_PID 2>/dev/null; then echo "Go server started"; exit 0; fi
    # Try main.go directly
    if [ -f "main.go" ]; then
      go run main.go 2>&1 &
      SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
      sleep 5
      if kill -0 $SERVER_PID 2>/dev/null; then echo "Go server started"; exit 0; fi
    fi
    # Try cmd/server pattern
    for CMD_DIR in cmd/server cmd/api cmd/main; do
      if [ -d "$CMD_DIR" ]; then
        go run "./$CMD_DIR" 2>&1 &
        SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
        sleep 5
        if kill -0 $SERVER_PID 2>/dev/null; then echo "Go server started from $CMD_DIR"; exit 0; fi
      fi
    done
  fi
}

# ─── PHP server detection ───
try_php_server() {
  if [ -f "artisan" ]; then
    echo "Laravel project detected"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, php: artisan serve"
    php artisan serve --host=0.0.0.0 --port=$PORT 2>&1 &
    SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
    sleep 3
    if kill -0 $SERVER_PID 2>/dev/null; then echo "Laravel started"; exit 0; fi
  fi
  if [ -f "bin/console" ] && [ -f "public/index.php" ]; then
    echo "Symfony project detected"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, php: symfony public/index.php"
    php -S 0.0.0.0:$PORT -t public 2>&1 &
    SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
    sleep 3
    if kill -0 $SERVER_PID 2>/dev/null; then echo "Symfony started"; exit 0; fi
  fi
  for DOCROOT in public public_html web www .; do
    if [ -f "$DOCROOT/index.php" ]; then
      echo "PHP server detected: $DOCROOT/index.php"
      ATTEMPTED_METHODS="$ATTEMPTED_METHODS, php: $DOCROOT/index.php"
      php -S 0.0.0.0:$PORT -t "$DOCROOT" 2>&1 &
      SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
      sleep 3
      if kill -0 $SERVER_PID 2>/dev/null; then echo "PHP server started"; exit 0; fi
    fi
  done
  for ENTRY in server.php src/server.php app.php src/app.php; do
    if [ -f "$ENTRY" ]; then
      echo "PHP entry point detected: $ENTRY"
      ATTEMPTED_METHODS="$ATTEMPTED_METHODS, php: $ENTRY"
      php -S 0.0.0.0:$PORT "$ENTRY" 2>&1 &
      SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
      sleep 3
      if kill -0 $SERVER_PID 2>/dev/null; then echo "PHP server started"; exit 0; fi
    fi
  done
}

# ─── Java server detection ───
try_java_server() {
  if [ -f "pom.xml" ]; then
    echo "Maven project detected"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, java: mvn spring-boot:run"
    if [ -f "mvnw" ]; then
      ./mvnw spring-boot:run -Dspring-boot.run.arguments="--server.port=$PORT" 2>&1 &
    else
      mvn spring-boot:run -Dspring-boot.run.arguments="--server.port=$PORT" 2>&1 &
    fi
    SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
    sleep 15
    if kill -0 $SERVER_PID 2>/dev/null; then echo "Spring Boot started"; exit 0; fi
  fi
  if [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo "Gradle project detected"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, java: gradle bootRun"
    if [ -f "gradlew" ]; then
      ./gradlew bootRun --args="--server.port=$PORT" 2>&1 &
    else
      gradle bootRun --args="--server.port=$PORT" 2>&1 &
    fi
    SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
    sleep 15
    if kill -0 $SERVER_PID 2>/dev/null; then echo "Spring Boot (Gradle) started"; exit 0; fi
  fi
}

# ─── Node.js server detection ───
try_node_server() {
if [ -f "package.json" ]; then
  echo "Checking package.json for start script..."
  START_SCRIPT=$(cat package.json | grep -o '"start"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"start"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')

  if [ -n "$START_SCRIPT" ]; then
    echo "Found start script in package.json: $START_SCRIPT"
    ATTEMPTED_METHODS="$ATTEMPTED_METHODS, package.json start: $START_SCRIPT"

    DIST_FILE=$(echo "$START_SCRIPT" | grep -o 'dist/[^ ]*' || true)
    if [ -n "$DIST_FILE" ] && [ ! -f "$DIST_FILE" ]; then
      echo "Start script references $DIST_FILE but it does not exist (TypeScript not built)"
      echo "Skipping package.json start script, will try tsx with source files instead"
    else
      eval "$START_SCRIPT" 2>&1 &
      SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
      sleep 3
      if kill -0 $SERVER_PID 2>/dev/null; then echo "Server started via package.json"; exit 0; fi
      echo "Server process died after starting with package.json script"
    fi
  fi
fi

echo "Searching for server entry point..."
FOUND_ENTRY_POINT=""
LOCATIONS=". src backend backend/src server server/src api api/src"
FILENAMES="server.js server.ts index.js index.ts main.js main.ts start.js start.ts app.js app.ts"

for LOCATION in $LOCATIONS; do
  for FILENAME in $FILENAMES; do
    if [ "$LOCATION" = "." ]; then ENTRY_PATH="$FILENAME"; else ENTRY_PATH="$LOCATION/$FILENAME"; fi
    if [ -f "$ENTRY_PATH" ]; then
      FOUND_ENTRY_POINT="$ENTRY_PATH"
      break 2
    fi
  done
done

if [ -z "$FOUND_ENTRY_POINT" ] && [ -d "packages" ]; then
  for PKG_DIR in packages/*; do
    if [ -d "$PKG_DIR" ]; then
      for FILENAME in $FILENAMES; do
        for SUB in "" "/src"; do
          ENTRY_PATH="$PKG_DIR$SUB/$FILENAME"
          if [ -f "$ENTRY_PATH" ]; then FOUND_ENTRY_POINT="$ENTRY_PATH"; break 3; fi
        done
      done
    fi
  done
fi

if [ -n "$FOUND_ENTRY_POINT" ]; then
  echo "Starting server with: $FOUND_ENTRY_POINT"
  ATTEMPTED_METHODS="$ATTEMPTED_METHODS, file search: $FOUND_ENTRY_POINT"
  case "$FOUND_ENTRY_POINT" in
    *.ts) npx -y tsx "$FOUND_ENTRY_POINT" 2>&1 & ;;
    *) node "$FOUND_ENTRY_POINT" 2>&1 & ;;
  esac
  SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
  sleep 5
  if kill -0 $SERVER_PID 2>/dev/null; then echo "Server started via file search"; exit 0; fi
  echo "Server process died after starting with file search"
fi

ATTEMPTED_METHODS="$ATTEMPTED_METHODS, require pattern"
node -e "require('./src/app').listen(3001)" 2>&1 &
SERVER_PID=$!; echo $SERVER_PID > /tmp/server.pid
sleep 2
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "ERROR: All Node.js server startup attempts failed"
fi
}

# ─── Auto-detect and try the right language ───
if [ -f "manage.py" ] || [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  try_python_server
fi
if [ -f "go.mod" ]; then
  try_go_server
fi
if [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  try_java_server
fi
if [ -f "composer.json" ] || [ -f "artisan" ]; then
  try_php_server
fi
if [ -f "package.json" ]; then
  try_node_server
fi

echo "No server could be started. Attempted: $ATTEMPTED_METHODS"
`;
}
