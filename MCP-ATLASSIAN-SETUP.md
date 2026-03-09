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
mcp-atlassian --env-file mcp-atlassian.env --transport sse --port 9000 -vv
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

If you see logs like:
```
DEBUG - docket.worker - Getting redeliveries
DEBUG - docket.worker - Getting new deliveries
```

**Solution:** Open the `mcp-atlassian.env` file and make this change:

```env
# Old (too many logs):
MCP_VERY_VERBOSE=true

# New (normal logs):
MCP_VERBOSE=true
```

Then restart MCP Atlassian.

## 📚 More Information

- [MCP Atlassian GitHub](https://github.com/sooperset/mcp-atlassian)
- [Jira API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
