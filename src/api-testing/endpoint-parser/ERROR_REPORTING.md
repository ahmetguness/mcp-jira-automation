# Error Reporting for Invalid Endpoint Specifications

## Overview

This document describes the error reporting functionality implemented for Task 3.4 of the API Endpoint Testing Transformation spec.

## Requirements

**Requirement 1.4**: IF endpoint bilgileri eksik veya geçersizse, THEN THE API_Test_System SHALL Jira task'ına açıklayıcı bir hata yorumu ekler

(Translation: IF endpoint information is missing or invalid, THEN THE API_Test_System SHALL add a descriptive error comment to the Jira task)

## Implementation

### New Methods Added to EndpointParser

#### 1. `formatErrorCommentForJira()`

Formats validation errors as a user-friendly Jira comment with:
- Clear error messages for each invalid endpoint
- Warnings for potential issues
- Examples of correct formats (JSON, YAML, Markdown table)
- List of required and optional fields
- Helpful guidance for fixing the issues

**Signature:**
```typescript
formatErrorCommentForJira(
  validationResults: Array<{ spec?: EndpointSpec; validation: ValidationResult }>,
  _taskDescription: string
): string
```

**Returns:** A formatted Markdown string ready to be posted as a Jira comment, or empty string if no errors.

#### 2. `parseAndValidateEndpoints()`

Convenience method that combines parsing and validation:
- Parses all endpoints from task description
- Validates each endpoint
- Returns both valid endpoints and validation results
- Provides a `hasErrors` flag for quick checking

**Signature:**
```typescript
parseAndValidateEndpoints(taskDescription: string): {
  endpoints: EndpointSpec[];
  validationResults: Array<{ spec: EndpointSpec; validation: ValidationResult }>;
  hasErrors: boolean;
}
```

## Error Message Format

The error message includes:

### 1. Header
```
❌ *Invalid Endpoint Specification*

The following issues were found in your endpoint specifications:
```

### 2. Error Details per Endpoint
```
*Endpoint 1:*
- URL: `/api/users`
  • URL is required
  • Invalid HTTP method: INVALID_METHOD

  _Warnings:_
  ⚠️ Request body provided for GET method (typically not used)
```

### 3. Format Examples
Shows complete examples in all three supported formats:
- JSON format with code block
- YAML format with code block
- Markdown table format

### 4. Field Documentation
Lists all required and optional fields with descriptions:
- Required: `url`, `method`
- Optional: `headers`, `requestBody`, `expectedStatus`, `authType`, `testScenarios`, `performanceThresholdMs`

## Usage Example

```typescript
import { EndpointParser } from './EndpointParser.js';

const parser = new EndpointParser();

// Parse and validate endpoints
const result = parser.parseAndValidateEndpoints(task.description);

// Check for errors
if (result.hasErrors) {
  // Format error comment
  const errorComment = parser.formatErrorCommentForJira(
    result.validationResults,
    task.description
  );
  
  // Post to Jira
  await jiraClient.addComment(task.key, errorComment);
  
  // Stop processing - don't generate tests for invalid specs
  return;
}

// Continue with valid endpoints
const validEndpoints = result.endpoints;
```

## Validation Rules

The following validations are performed:

### Required Fields
- **URL**: Must be present and non-empty
- **HTTP Method**: Must be a valid HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)

### Format Validations
- **URL Format**: Must be either a valid full URL (http/https) or a path starting with `/`
- **Headers**: Must be a valid object with string key-value pairs
- **Request Body**: Must be a valid object (if provided)
- **Expected Status**: Must be between 100-599

### Warnings
- Request body on GET/HEAD/DELETE methods (typically not used)
- Missing test scenarios (will use default)

## Test Coverage

Comprehensive test coverage includes:
- Error formatting for missing URL
- Error formatting for invalid URL format
- Multiple endpoints with errors
- Warnings included in error messages
- Empty string returned when no errors
- All format examples present
- Required and optional fields listed
- Parse and validate integration
- Mixed valid/invalid endpoints

All 36 tests pass successfully.

## Integration Points

This functionality integrates with:
1. **JiraListener**: Receives tasks from Jira
2. **JiraClient**: Posts error comments back to Jira
3. **Main Pipeline**: Validates endpoints before test generation
4. **Test Script Generator**: Only receives valid endpoints

## Error Handling Flow

```
Task Received
    ↓
Parse Endpoints
    ↓
Validate Each Endpoint
    ↓
Has Errors? ──Yes──→ Format Error Comment
    │                      ↓
    │                 Post to Jira
    │                      ↓
    │                 Stop Processing
    │
    No
    ↓
Continue with Valid Endpoints
    ↓
Generate Tests
```

## Benefits

1. **User-Friendly**: Clear, actionable error messages
2. **Educational**: Provides examples and field documentation
3. **Comprehensive**: Shows all errors at once, not just the first one
4. **Consistent**: Uses the same format for all error types
5. **Integrated**: Works seamlessly with existing Jira workflow
6. **Preventive**: Stops invalid specifications from reaching test generation

## Future Enhancements

Potential improvements for future iterations:
- Add links to full API documentation
- Suggest fixes based on common patterns
- Validate against OpenAPI/Swagger specs if available
- Check for duplicate endpoints
- Validate authentication requirements against available credentials
