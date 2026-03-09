# Quick Start Guide

## Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
# Copy example files
cp .env.example .env
cp mcp-atlassian.env.example mcp-atlassian.env

# Edit .env with your credentials
# Edit mcp-atlassian.env with your Jira credentials
```

### 3. Build Project
```bash
npm run build
```

## Running the Application

### Windows

```bash
# Start everything (recommended)
.\scripts\start-all.bat

# Or start components separately
.\scripts\start-mcp-only.bat    # MCP Atlassian only (uses wrapper for clean shutdown)
.\scripts\start-app-only.bat    # Main app only

# Alternative: Use wrapper for better terminal handling
.\scripts\windows\start-mcp-wrapper.bat  # Prevents terminal corruption on Ctrl+C
```

**Note:** If your terminal becomes unresponsive after stopping MCP with Ctrl+C, use the wrapper script or run in a separate window:
```bash
start cmd /k .\scripts\windows\start-mcp-wrapper.bat
```

### Linux/Mac

```bash
# Make scripts executable (first time only)
chmod +x scripts/*.sh

# Start everything (recommended)
./scripts/start-all.sh

# Or start components separately
./scripts/start-mcp-only.sh     # MCP Atlassian only
./scripts/start-app-only.sh     # Main app only
```

## What Happens When You Run

1. **MCP Atlassian Server** starts on port 9000
2. **Main Application** starts and connects to:
   - Jira (via MCP Atlassian)
   - GitHub (via MCP GitHub)
   - OpenAI/Anthropic/Gemini (AI provider)
   - Docker (for isolated testing)

3. **Bot starts polling** Jira for assigned tasks

## Testing

Create a Jira task with:
- **Assignee**: Your bot's display name (from `.env`)
- **Description**: Include repository info
  ```
  Repository: username/repo-name
  
  Create a simple test for the GET / endpoint.
  ```

The bot will:
1. ✅ Fetch code from repository
2. ✅ Analyze with AI
3. ✅ Run tests in Docker
4. ✅ Create Pull Request
5. ✅ Report results to Jira

## Stopping Services

- **Windows**: Close both terminal windows or press Ctrl+C
- **Linux/Mac**: Close terminals or press Ctrl+C

## Troubleshooting

### "MCP Atlassian connection failed"
- Check `mcp-atlassian.env` configuration
- Verify port 9000 is not in use
- Try `scripts/start-mcp-only` first

### "Docker not found"
- Install Docker Desktop
- Make sure Docker is running
- Test with `docker ps`

### "Repository not found"
- Add repository to Jira task description
- Format: `Repository: username/repo-name`
- Or set up custom field (see `JIRA-REPOSITORY-GUIDE.md`)

## Next Steps

- Read `scripts/README.md` for detailed script documentation
- See `MCP-ATLASSIAN-SETUP.md` for MCP setup guide
- Review `JIRA-REPOSITORY-GUIDE.md` for repository configuration

## Support

For detailed documentation, see:
- `README.md` - Full documentation
- `MCP-ATLASSIAN-SETUP.md` - MCP setup guide
- `JIRA-REPOSITORY-GUIDE.md` - Repository configuration
