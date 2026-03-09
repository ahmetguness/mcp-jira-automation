# Startup Scripts

Cross-platform startup scripts for MCP Jira Automation.

## Quick Start (Recommended)

### Installation

First, build the project and link the CLI tool globally (one-time setup):

```bash
npm run build
npm link
```

### Usage

Now you can use `mja` command directly from anywhere in the project:

```bash
# Start everything (MCP + App)
mja run

# Start only MCP Atlassian
mja mcp

# Start only main app
mja app

# Show help
mja help
```

These commands automatically detect your OS and run the appropriate script.

### Alternative (without npm link)

If you prefer not to use `npm link`, you can still use npm scripts:

```bash
npm run mja        # Start everything
npm run mja:mcp    # Start MCP only
npm run mja:app    # Start app only
```

## Platform-Specific Scripts

### Windows

```bash
# Start everything (recommended)
.\scripts\windows\start-all.bat

# Start only MCP Atlassian
.\scripts\windows\start-mcp-only.bat
# or PowerShell version:
.\scripts\windows\start-mcp-atlassian.ps1

# Start only main app
.\scripts\windows\start-app-only.bat
```

## Linux/Mac

```bash
# Make scripts executable (first time only)
chmod +x scripts/unix/*.sh

# Start everything (recommended)
./scripts/unix/start-all.sh

# Start only MCP Atlassian
./scripts/unix/start-mcp-only.sh
# or alternative:
./scripts/unix/start-mcp-atlassian.sh

# Start only main app
./scripts/unix/start-app-only.sh
```

## What Each Script Does

### `start-all` (Recommended)
- Starts MCP Atlassian server in a new window
- Waits 8 seconds for initialization
- Starts main application in another window
- Auto-closes launcher after 3 seconds

### `start-mcp-only`
- Starts only MCP Atlassian server
- Use when you want to run MCP separately

### `start-app-only`
- Starts only the main application
- Requires MCP Atlassian to be running on port 9000

## Terminal Support (Linux)

The scripts will try to use these terminals in order:
1. gnome-terminal (GNOME)
2. xterm (Universal)
3. konsole (KDE)
4. x-terminal-emulator (Debian/Ubuntu default)

## Troubleshooting

### Linux: "Permission denied"
```bash
chmod +x scripts/unix/*.sh
```

### Linux: "Terminal not found"
Install a terminal emulator:
```bash
# Ubuntu/Debian
sudo apt install gnome-terminal

# Fedora
sudo dnf install gnome-terminal

# Arch
sudo pacman -S gnome-terminal
```

### Windows: "Execution policy"
Run PowerShell as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Configuration

All scripts load configuration from:
- `.env` - Main application config
- `mcp-atlassian.env` - MCP Atlassian config

Make sure these files exist before running the scripts.
