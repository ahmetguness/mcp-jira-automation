# Test Execution Reporting - Test Suite Documentation

This directory contains comprehensive tests for the Test Execution Reporting feature.

## Test Organization

### Unit Tests
- `config.test.ts` - Configuration management tests
- `types.test.ts` - Type definitions and interfaces tests
- `test-executor.test.ts` - Test executor component tests
- `result-collector.test.ts` - Result collector component tests
- `language-detector.test.ts` - Language detector component tests
- `report-generator.test.ts` - Report generator component tests
- `pipeline.test.ts` - End-to-end pipeline integration tests

### Property-Based Tests
- `test-executor-properties.test.ts` - Property tests for test executor
- `result-collector-properties.test.ts` - Property tests for result collector
- `language-detector-properties.test.ts` - Property tests for language detector
- `report-generator-properties.test.ts` - Property tests for report generator
- `pr-updater-properties.test.ts` - Property tests for PR updater

### Edge Case Tests
- `edge-cases.test.ts` - Comprehensive edge case coverage including:
  - Empty test files
  - Files with only skipped tests
  - Very large output (memory limits)
  - Concurrent executions
  - Non-ASCII characters in filenames and test names
  - Special markdown characters in test names
  - Timeout with partial output
  - Malformed JSON output
  - Framework detection edge cases

## Custom Generators

The `generators.ts` file provides custom fast-check generators for property-based testing:

- `testStatusArb` - Generates test status values (passed, failed, skipped)
- `errorTypeArb` - Generates error types (syntax, assertion, timeout, dependency, runtime)
- `testFrameworkArb` - Generates test framework names (jest, mocha, vitest, node:test, unknown)
- `errorArb` - Generates realistic test errors with various error types
- `testCaseArb` - Generates individual test cases with special characters and non-ASCII names
- `testOutputArb` - Generates complete test results with realistic data
- `jiraTaskArb` - Generates Jira task content in Turkish, English, or mixed languages
- `testFileArb` - Generates test files with framework indicators and non-ASCII filenames
- `rawTestResultArb` - Generates raw test execution results

## Test Coverage

The test suite validates all requirements from the design document:

### Requirements Coverage
- **Requirement 1**: Execute Generated Test Files ✅
- **Requirement 2**: Collect Test Results ✅
- **Requirement 3**: Detect Report Language ✅
- **Requirement 4**: Generate Markdown Test Report ✅
- **Requirement 5**: Add Report to Pull Request ✅
- **Requirement 6**: Handle Test Execution Errors ✅
- **Requirement 7**: Support Multiple Test Frameworks ✅
- **Requirement 8**: Preserve Test File Integrity ✅

### Property Coverage
All 10 correctness properties from the design document are validated:
1. Complete Output Capture ✅
2. Execution Timeout Enforcement ✅
3. Statistics Calculation Correctness ✅
4. Language Detection Accuracy ✅
5. Report Completeness ✅
6. Report Filename Format ✅
7. Report Commit Creation ✅
8. Error Report Handling ✅
9. Framework Detection ✅
10. File Integrity Preservation ✅

## Running Tests

```bash
# Run all tests
npm test tests/test-execution-reporting/

# Run specific test file
npm test tests/test-execution-reporting/edge-cases.test.ts --run

# Run with coverage
npm test tests/test-execution-reporting/ -- --coverage
```

## Test Statistics

- **Total Test Files**: 13
- **Total Tests**: 186
- **Property-Based Tests**: 67 (with 20 iterations each)
- **Unit Tests**: 103
- **Edge Case Tests**: 16
- **Test Duration**: ~77 seconds (includes long-running timeout tests)

## Notes

- Property-based tests use `numRuns: 20` for faster execution while maintaining good coverage
- Some tests involve actual file system operations and process spawning
- Timeout tests can take several seconds to complete
- All tests clean up temporary files after execution
