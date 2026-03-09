# Log Configuration Guide

This guide explains how to configure logging for different components of the system.

## 📊 Overview

The system has three logging layers:

1. **Main Application Logs** - Controlled by `LOG_LEVEL` in `.env`
2. **Test Logs** - Automatically suppressed during test runs
3. **MCP Server Logs** - Controlled by `FASTMCP_LOG_LEVEL` in `mcp-atlassian.env`

## 🎯 Main Application Logging

Configure in `.env` file:

```env
# Log Level Options: debug, info, warn, error, silent
LOG_LEVEL=info
```

**Recommended Settings:**
- **Development**: `info` - Shows important operations
- **Production**: `warn` - Only warnings and errors
- **Debugging**: `debug` - Detailed information
- **Testing**: `silent` - No logs (automatically set during tests)

## 🧪 Test Logging

Test logs are automatically suppressed via `vitest.config.ts`:

```typescript
test: {
    env: {
        LOG_LEVEL: "silent",
    },
}
```

This ensures clean test output without INFO/WARN/ERROR messages.

## 🔌 MCP Server Logging

Configure in `mcp-atlassian.env` file:

```env
# =============================================
# LOGGING CONFIGURATION
# =============================================

# FastMCP Log Level (controls internal MCP server logs)
# Options: DEBUG, INFO, WARNING, ERROR, CRITICAL
FASTMCP_LOG_LEVEL=ERROR

# MCP Verbose Mode (controls tool execution logs)
# Leave commented out for minimal logging
# MCP_VERY_VERBOSE=true   # DEBUG level
# MCP_VERBOSE=true        # INFO level
```

### Common MCP Log Issues

**Problem:** Seeing repetitive DEBUG logs like:
```
DEBUG - docket.worker - Scheduling due tasks
DEBUG - docket.worker - Getting redeliveries
DEBUG - docket.worker - Getting new deliveries
```

**Solution:** Set `FASTMCP_LOG_LEVEL=ERROR` in `mcp-atlassian.env`

### MCP Log Level Options

| Level | Description | Use Case |
|-------|-------------|----------|
| `ERROR` | Only errors | **Recommended** - Clean output |
| `WARNING` | Errors + warnings | Production monitoring |
| `INFO` | Normal operations | Development |
| `DEBUG` | All internal details | Troubleshooting only |
| `CRITICAL` | Only critical errors | Minimal logging |

## 🎨 Log Format

### Development Mode (Human-Readable)

```
[13:26:33] INFO: mcp:manager | Initializing MCP connections...
[13:26:33] INFO: mcp:spawn | Connected to mcp-atlassian ✅
```

### Production Mode (JSON)

Set `LOG_FORMAT=json` in `.env`:

```json
{"level":"info","time":"2024-01-15T13:26:33.123Z","scope":"mcp:manager","msg":"Initializing MCP connections..."}
```

## 🔧 Quick Configuration Examples

### Minimal Logging (Recommended for Production)

**.env:**
```env
LOG_LEVEL=warn
LOG_FORMAT=json
```

**mcp-atlassian.env:**
```env
FASTMCP_LOG_LEVEL=ERROR
# MCP_VERBOSE=true (commented out)
```

### Verbose Logging (Debugging)

**.env:**
```env
LOG_LEVEL=debug
```

**mcp-atlassian.env:**
```env
FASTMCP_LOG_LEVEL=DEBUG
MCP_VERY_VERBOSE=true
```

### Balanced Logging (Development)

**.env:**
```env
LOG_LEVEL=info
```

**mcp-atlassian.env:**
```env
FASTMCP_LOG_LEVEL=ERROR
# MCP_VERBOSE=true (commented out)
```

## 🚀 Applying Changes

After modifying log configuration:

1. **Main Application**: Restart the application
   ```bash
   npm run dev
   ```

2. **MCP Server**: Restart MCP Atlassian
   ```bash
   # Windows
   .\scripts\windows\start-mcp-atlassian.ps1
   
   # Unix/Linux/Mac
   ./scripts/unix/start-mcp-atlassian.sh
   ```

3. **Tests**: No restart needed - automatically uses `silent` level

## 📝 Best Practices

1. **Use `ERROR` level for MCP** - Suppresses verbose worker logs
2. **Use `info` or `warn` for main app** - Balance between visibility and noise
3. **Never commit verbose settings** - Keep production configs clean
4. **Use `debug` only when troubleshooting** - Too much information otherwise
5. **Tests always use `silent`** - Ensures clean test output

## 🔍 Troubleshooting

### Logs still appearing during tests

Check `vitest.config.ts` has:
```typescript
env: {
    LOG_LEVEL: "silent",
}
```

### MCP logs still verbose

1. Check `FASTMCP_LOG_LEVEL=ERROR` is set in `mcp-atlassian.env`
2. Ensure `MCP_VERBOSE` and `MCP_VERY_VERBOSE` are commented out
3. Restart MCP server

### No logs at all

1. Check `LOG_LEVEL` is not set to `silent` in `.env`
2. Verify logger is enabled in `src/logger.ts`
3. Check console output is not being redirected

## 📚 Related Documentation

- [MCP Atlassian Setup](../MCP-ATLASSIAN-SETUP.md)
- [Logger Implementation](../src/logger.ts)
- [Test Configuration](../vitest.config.ts)
