# Docker Test Execution Reporting - Test Fixtures

This directory contains test fixtures for the Docker Test Execution Reporting feature.

## Test Files

Sample test files for each supported framework:

- `jest-sample.test.js` - Jest test framework example
- `mocha-sample.test.js` - Mocha test framework example
- `vitest-sample.test.js` - Vitest test framework example
- `node-test-sample.test.js` - Node.js built-in test runner example

Each test file includes:
- Basic assertions
- Async operations
- Object property validation

## Docker Configurations

Sample Docker configuration files:

- `docker-config-default.json` - Default configuration (node:20-alpine, network isolated)
- `docker-config-custom.json` - Custom configuration with registry and higher resources
- `docker-config-network-host.json` - Configuration with host networking enabled

## Container Outputs

Sample container output files for different scenarios:

- `container-output-success.txt` - Successful test execution output
- `container-output-failure.txt` - Failed test execution output
- `container-output-error.txt` - Test execution with module error
- `container-output-timeout.txt` - Test execution timeout scenario

## Usage

These fixtures are used in:
- Unit tests for Docker executor components
- Integration tests for end-to-end Docker execution
- Property-based tests for validating correctness properties

Example:
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

const fixturesDir = 'tests/fixtures/docker-test-execution-reporting';
const jestSample = join(fixturesDir, 'jest-sample.test.js');
const successOutput = readFileSync(
  join(fixturesDir, 'container-output-success.txt'), 
  'utf-8'
);
```
