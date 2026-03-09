export function getOverlayPrompt(runtime: string): string {
    switch (runtime) {
        case "node":
            return `
RUNTIME OVERLAY: Node.js / TypeScript (POLICY-COMPATIBLE)

ALLOWED COMMAND SHAPES (IMPORTANT)
- npm ci
- npm install (STRICT: only if needed; do NOT install specific packages)
- npm test
- npm run <script> (script MUST be visible in PROVIDED package.json scripts)
- pnpm|yarn|bun install/test/run may be allowed, but prefer npm unless repo clearly uses another manager.

DETERMINISTIC INSTALL STRATEGY
- If package-lock.json is PROVIDED: prefer "npm ci".
- If no lockfile is PROVIDED but package.json is PROVIDED: use "npm install" only if necessary to run tests.
- Never run both npm ci and npm install.

TEST COMMANDS (NO INVENTING)
- Only run scripts that are explicitly visible in PROVIDED package.json "scripts".
- Prefer:
  1) "npm test" if "test" script exists
  2) "npm run <script>" where <script> is EXACTLY a key in provided scripts
- Do NOT invent test runners or scripts.
- Do NOT add new tooling via commands.

REPORTING
- If a verification report is required, prefer creating "verification-report.md" via patches.`;

        case "python":
            return `
RUNTIME OVERLAY: Python (POLICY-COMPATIBLE, DETERMINISTIC)

ALLOWED COMMAND SHAPES (IMPORTANT)
- python -m pip install ...
- python3 -m pip install ...
- pip install ...
- pip3 install ...
- python -m pytest
- python3 -m pytest
- pytest ... (ALLOWED as fallback only; prefer python -m pytest)

INSTALL STRATEGY (DETERMINISTIC, MINIMAL CHANGES)
1) Prefer manifest-based installs when a manifest is PROVIDED:
   - If requirements.txt is PROVIDED:
     - Prefer: "pip install -r requirements.txt" (or pip3)
   - Else if pyproject.toml / setup.py is PROVIDED:
     - Prefer: "pip install -e ." (or pip3)

2) If NO manifest is PROVIDED:
   - You MAY explicitly install third-party deps ONLY if imports/usages in PROVIDED + PATCHED files prove they are needed.
   - Keep explicit installs minimal and deterministic (no guessing).

3) Avoid dependency drift:
   - Do NOT install arbitrary new packages that are not required by visible imports.
   - Do NOT change dependency manifests unless the Jira issue explicitly asks for dependency changes.

TEST RUNNER (MANDATORY)
- First choice: "python -m pytest" (or "python3 -m pytest")
- Fallback only if needed: "pytest" (some environments may not have it; prefer python -m pytest)
- Do NOT start servers. Use in-process test clients.

PYTEST DEPENDENCY RULE
- If tests exist and pytest is not guaranteed by a provided manifest:
  - Install it using an allowed command:
    - Prefer: "pip install pytest" (or pip3)
- Always keep install commands BEFORE test commands.

FRAMEWORK TEST-CLIENT RULE (NO LIVE NETWORK)
- Tests must not call live HTTP endpoints (localhost/external) unless explicitly instructed to start a server.
- Use in-process test clients and import the app object directly from code.

If you create/modify tests that use a framework test client, ensure required deps:
- FastAPI TestClient => ensure BOTH "fastapi" AND "httpx"
- Flask test_client => ensure "flask"
- Django test client => ensure "django"
- Requests-mock usage => ensure "requests-mock" only if imports show it is used

DEPENDENCY RESCAN REQUIREMENT
After generating patches, re-scan:
- all PROVIDED files, AND
- all files you CREATE/MODIFY,
for third-party imports/usages.
Ensure every third-party dependency is installed via allowed commands (manifest-based if possible; explicit install only when needed).

REPORTING (VERIFICATION REPORT)
- If a verification/execution report is required:
  - Prefer creating "verification-report.md" (or results.txt only if explicitly requested) via patches.
  - Do NOT use output redirection (>) or shell tricks.
  - The report must summarize:
    1) Commands executed
    2) Verification steps attempted
    3) Success/failure
    4) Issues/limitations (especially missing files/manifests)

ENVIRONMENT CONSISTENCY (CRITICAL)
- Set "environment" to "python".
- Commands MUST be Python-compatible and should not rely on Node-specific tooling.`;

        case "go":
            return `
RUNTIME OVERLAY: Go (POLICY-COMPATIBLE)

ALLOWED COMMAND SHAPES
- go test ./...
- go mod download (only if necessary)
- go mod tidy is NOT recommended unless the Jira issue requests dependency cleanup.

DEFAULT
- Prefer running: "go test ./..."

REPORTING
- If a verification report is required, create "verification-report.md" via patches.`;

        case "rust":
            return `
RUNTIME OVERLAY: Rust (POLICY-COMPATIBLE)

ALLOWED COMMAND SHAPES
- cargo test
- cargo fetch (only if necessary)

DEFAULT
- Prefer running: "cargo test"
- Do NOT modify Cargo.lock unless the Jira issue explicitly requires dependency changes.

REPORTING
- If a verification report is required, create "verification-report.md" via patches.`;

        case "java":
            return `
RUNTIME OVERLAY: Java (POLICY-COMPATIBLE)

ALLOWED COMMAND SHAPES
- mvn test | mvn verify | mvn package (only if needed)
- gradle test | gradle build
- ./gradlew test | ./gradlew build

BUILD TOOL SELECTION (ONLY IF FILES ARE PROVIDED)
- If pom.xml is PROVIDED: prefer "mvn test" (or "mvn verify" if requested).
- Else if ./gradlew is PROVIDED: prefer "./gradlew test".
- Else if build.gradle is PROVIDED: prefer "gradle test".
- If none are PROVIDED, do NOT guess a build system; explain limitations in plan.

REPORTING
- If a verification report is required, create "verification-report.md" via patches.`;

        case "unknown":
        default:
            return `
RUNTIME OVERLAY: Unknown (SAFETY MODE)

- Do NOT guess a runtime or invent a runner.
- Prefer producing patches only if the Jira issue is clearly solvable without running tests.
- If tests/verification cannot be executed safely with the provided files:
  - Explain limitations in plan
  - If a report is required, create "verification-report.md" via patches explaining what could/could not be verified.`;
    }
}