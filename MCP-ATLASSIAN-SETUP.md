# MCP Atlassian Setup Guide

This project uses the **MCP Atlassian** server to communicate with Jira. This guide explains how to install and configure MCP Atlassian.

## 📋 Requirements

- Python 3.8 or higher
- pip (Python package manager)

## 🔧 Installation Steps

### 1. Install MCP Atlassian

```bash
pip install mcp-atlassian
```

### 2. Create Configuration File

```bash
cp mcp-atlassian.env.example mcp-atlassian.env
```

### 3. Enter Your Jira Information

Open the `mcp-atlassian.env` file and fill in the following information:

```env
JIRA_URL=https://your-company.atlassian.net
JIRA_USERNAME=your.email@example.com
JIRA_API_TOKEN=your_jira_api_token_here
```

**How to Get Jira API Token:**
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token" button
3. Give the token a name (e.g., "MCP Atlassian")
4. Copy the generated token and paste it into the `JIRA_API_TOKEN` field

### 4. Check Port Settings

The `PORT` value in the `mcp-atlassian.env` file must match the `MCP_SSE_URL` value in the main `.env` file:

**mcp-atlassian.env:**
```env
PORT=9000
```

**Main .env file:**
```env
MCP_SSE_URL=http://127.0.0.1:9000/sse
```

## 🚀 Running

### Option 1: With Batch File (Easiest)

**MCP Atlassian Only:**
```bash
.\scripts\start-mcp-only.bat
```

**Start Entire System (MCP Atlassian + Main App):**
```bash
.\scripts\start-all.bat
```

### Option 2: With PowerShell

```powershell
.\scripts\start-mcp-atlassian.ps1
```

### Option 3: Manual Start

```bash
# With environment file (recommended)
mcp-atlassian --env-file mcp-atlassian.env --transport sse --port 9000

# Note: Log verbosity is controlled by FASTMCP_LOG_LEVEL in mcp-atlassian.env
# For troubleshooting, you can add -v or -vv flags:
# mcp-atlassian --env-file mcp-atlassian.env --transport sse --port 9000 -vv
```

### With Docker Compose

If using Docker Compose, MCP Atlassian starts automatically:

```bash
docker-compose up -d
```

## ✅ Testing

When MCP Atlassian starts successfully, you should see these messages:

```
Starting MCP Atlassian Server...
Loading configuration from mcp-atlassian.env
Starting server on http://127.0.0.1:9000/sse
```

When the main application starts, check the logs:

```
✅ Connected to mcp-atlassian
✅ mcp-atlassian provides X tools
```

## 🔍 Troubleshooting

### "Connection refused" error

- Make sure MCP Atlassian server is running
- Check that the port number is correct (9000)
- Check firewall settings

### "Authentication failed" error

- Check that Jira URL is correct
- Check that API token is valid
- Check that username (email) is correct

### "Module not found" error

```bash
pip install mcp-atlassian
```

### Too many logs (DEBUG logs)

If you see repetitive DEBUG logs like:
```
DEBUG - docket.worker - Scheduling due tasks
DEBUG - docket.worker - Getting redeliveries
DEBUG - docket.worker - Getting new deliveries
```

These are internal FastMCP worker logs that can be suppressed.

**Solution:** Open the `mcp-atlassian.env` file and configure logging:

```env
# =============================================
# LOGGING CONFIGURATION (Recommended Settings)
# =============================================

# FastMCP Log Level - Controls internal MCP server logs
# Set to ERROR to suppress verbose worker logs
FASTMCP_LOG_LEVEL=ERROR

# MCP Verbose Mode - Controls tool execution logs
# Comment out both lines for minimal logging (recommended)
# MCP_VERY_VERBOSE=true   # DEBUG level - very verbose
# MCP_VERBOSE=true        # INFO level - shows operations
```

**Log Level Options:**
- `FASTMCP_LOG_LEVEL=ERROR` - Only errors (recommended, cleanest output)
- `FASTMCP_LOG_LEVEL=WARNING` - Errors and warnings
- `FASTMCP_LOG_LEVEL=INFO` - Normal operations (moderate verbosity)
- `FASTMCP_LOG_LEVEL=DEBUG` - All internal details (very verbose)

After making changes, restart MCP Atlassian for the settings to take effect.

### "TOOLSETS is not set" warning

If you see this warning:
```
WARNING - TOOLSETS is not set — currently defaults to all toolsets. 
In v0.22.0, the default will change to 6 core toolsets only.
```

**Solution:** Open `mcp-atlassian.env` and explicitly set:

```env
# Enable all available toolsets (recommended)
TOOLSETS=all
```

**Toolset Options:**
- `all` - All available toolsets (recommended for full functionality)
- `default` - 6 core toolsets only (minimal set)
- `jira` - Jira-specific tools only
- `confluence` - Confluence-specific tools only
- `jira-admin` - Jira admin tools
- `confluence-admin` - Confluence admin tools

After making changes, restart MCP Atlassian.

### Terminal becomes unresponsive after Ctrl+C

If your terminal becomes unresponsive or stops showing typed characters after stopping MCP Atlassian with Ctrl+C:

**Immediate Fix (Type blindly - you won't see it):**
```bash
# Windows PowerShell:
[Console]::ResetColor(); cls

# Windows CMD:
cls

# Unix/Linux/Mac:
reset
stty sane
```

**Recommended Solution - Use Batch File (Windows):**
```bash
# Use the wrapper script that handles cleanup properly:
.\scripts\windows\start-mcp-wrapper.bat
```

This batch file wrapper ensures clean terminal shutdown even after Ctrl+C.

**Alternative - Run in Separate Window:**
```bash
# Windows - Opens in new window that can be closed safely:
start powershell -NoExit -File .\scripts\windows\start-mcp-atlassian.ps1

# Or use the batch wrapper in new window:
start cmd /k .\scripts\windows\start-mcp-wrapper.bat
```

**Why this happens:**
Python applications (including mcp-atlassian) can change terminal settings (like echo mode) and may not restore them properly when interrupted with Ctrl+C. The wrapper scripts attempt to restore terminal state, but the most reliable solution is running in a separate window that can be closed.

**Best Practice:**
Run MCP Atlassian in a dedicated terminal window that you can close when done, rather than using Ctrl+C in your main working terminal.

- [MCP Atlassian GitHub](https://github.com/sooperset/mcp-atlassian)
- [Jira API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
