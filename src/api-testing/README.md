# API Endpoint Testing Transformation

This module transforms the existing "AI Cyber Bot" from a code generation tool into a specialized API endpoint testing automation system.

## Architecture

The system consists of the following modules:

### Core Models (`models/`)
- **enums.ts**: Enumerations for HTTP methods, auth types, test frameworks, environments, test status, and SCM providers
- **types.ts**: TypeScript interfaces for all data models including JiraTask, EndpointSpec, TestContext, GeneratedTests, TestResults, etc.

### Modules

1. **Jira Listener** (`jira-listener/`)
   - Monitors Jira for new API testing tasks
   - Supports both polling and webhook modes
   - Retrieves task details and metadata

2. **Endpoint Parser** (`endpoint-parser/`)
   - Extracts API endpoint specifications from Jira task descriptions
   - Supports JSON, YAML, and Markdown table formats
   - Validates endpoint specifications

3. **Repository Resolver** (`repository-resolver/`)
   - Determines which repository contains the API being tested
   - Resolves from custom fields, task description, or project mapping

4. **Context Retrieval** (`context-retrieval/`)
   - Retrieves ONLY test-relevant files from repository
   - Finds API specs, existing tests, and documentation
   - Detects existing test frameworks

5. **Test Script Generator** (`test-script-generator/`)
   - AI-powered test script generation
   - Supports multiple test frameworks (pytest, jest, postman)
   - Generates comprehensive test scenarios

6. **Test Executor** (`test-executor/`)
   - Executes tests in isolated Docker containers
   - Handles timeouts and retries
   - Captures test output and metrics

7. **Test Reporter** (`test-reporter/`)
   - Reports test results to Jira with formatted comments
   - Updates task status based on test outcomes
   - Adds appropriate labels (test-failed, permanently-failed)
   - Generates comprehensive Markdown documentation
   - Saves reports to docs/api-tests/ directory

## Directory Structure

```
src/api-testing/
├── models/
│   ├── enums.ts              # Enumerations
│   ├── types.ts              # TypeScript interfaces
│   └── index.ts              # Model exports
├── jira-listener/
│   ├── JiraListener.ts       # Main class (to be implemented)
│   └── index.ts              # Module exports
├── endpoint-parser/
│   ├── EndpointParser.ts     # Main class (to be implemented)
│   └── index.ts              # Module exports
├── repository-resolver/
│   ├── RepositoryResolver.ts # Main class (to be implemented)
│   └── index.ts              # Module exports
├── context-retrieval/
│   ├── ContextRetrieval.ts   # Main class (to be implemented)
│   └── index.ts              # Module exports
├── test-script-generator/
│   ├── TestScriptGenerator.ts # Main class (to be implemented)
│   └── index.ts              # Module exports
├── test-executor/
│   ├── TestExecutor.ts       # Main class (to be implemented)
│   └── index.ts              # Module exports
├── test-reporter/
│   ├── TestReporter.ts       # Main class (to be implemented)
│   └── index.ts              # Module exports
├── index.ts                  # Main module export
└── README.md                 # This file
```

## Key Design Principles

1. **Context-Aware Retrieval**: Only retrieve test-relevant files, never entire repositories
2. **Ephemeral Isolation**: Each test runs in a fresh Docker container
3. **Safety First**: Environment-aware execution with safeguards
4. **Framework Flexibility**: Support multiple test frameworks
5. **Credential Security**: Zero-trust approach to sensitive data
6. **Structured AI Communication**: Well-defined prompt/response contracts

## Data Flow

```
Jira Task → Endpoint Parser → Repository Resolver → Context Retrieval
    ↓
Test Script Generator (AI) → Test Executor (Docker) → Test Reporter
    ↓                                                      ↓
Test Results                                          Jira + SCM
```

## Implementation Status

- [x] Task 1: Project structure and core data models
- [x] Task 2: Jira Listener module
- [x] Task 3: Endpoint Parser module
- [x] Task 5: Repository Resolver module
- [x] Task 6: Context Retrieval module
- [x] Task 7: Test Script Generator module
- [x] Task 9: Test Executor module
- [x] Task 11: Test Reporter module
- [~] Task 12: SCM integration (partial - placeholder in TestReporter)
- [x] Task 20: Orchestration module

## Testing

Tests will be organized as:
- `tests/api-testing/unit/` - Unit tests for each module
- `tests/api-testing/property/` - Property-based tests
- `tests/api-testing/integration/` - End-to-end integration tests

## Configuration

Environment variables for API testing:
- `REQUIRE_APPROVAL` - Enable approval mode (default: false)
- `COMMIT_TEST_SCRIPTS` - Commit generated tests (default: true)
- `COMMIT_TEST_RESULTS` - Commit test results (default: false)
- `CREATE_PULL_REQUEST` - Auto-create PRs (default: false)
- `TEST_TIMEOUT_SECONDS` - Test timeout (default: 300)
- `MAX_RETRY_ATTEMPTS` - Max retries (default: 3)
