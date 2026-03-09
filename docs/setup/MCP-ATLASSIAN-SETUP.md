# MCP Atlassian Setup Guide

This guide will help you set up the MCP Atlassian server for Jira integration.

## Prerequisites

- Node.js 20+
- Jira account with API access
- Jira API token

## Configuration

1. Copy the example configuration:
```bash
cp mcp-atlassian.env.example mcp-atlassian.env
```

2. Edit `mcp-atlassian.env` with your credentials:
```env
ATLASSIAN_INSTANCE_URL=https://your-domain.atlassian.net
ATLASSIAN_EMAIL=your-email@example.com
ATLASSIAN_API_TOKEN=your-api-token-here
MCP_SERVER_PORT=9000
MCP_LOG_LEVEL=INFO
```

## Getting Your API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a name (e.g., "MCP Jira Bot")
4. Copy the token and paste it into `mcp-atlassian.env`

## Starting the Server

### Windows
```bash
.\scripts\start-mcp-only.bat
```

### Linux/Mac
```bash
./scripts/start-mcp-only.sh
```

## Verifying Connection

The server should start on port 9000. You should see:
```
============================================================
           MCP Atlassian Server
============================================================

Loading configuration from mcp-atlassian.env...
  > Configuration loaded

Starting MCP Atlassian server on port 9000...
```

## Troubleshooting

### "Connection refused"
- Check if port 9000 is already in use
- Verify `MCP_SERVER_PORT` in `mcp-atlassian.env`

### "Authentication failed"
- Verify your API token is correct
- Check your email address matches your Jira account
- Ensure your Jira instance URL is correct

### "Module not found"
- Run `npm install` in the project root
- The MCP server will be installed automatically

## Next Steps

After MCP Atlassian is running:
1. Start the main application
2. Create a test Jira task
3. Assign it to your bot

See `QUICK-START.md` for complete setup instructions.
