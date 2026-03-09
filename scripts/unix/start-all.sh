#!/bin/bash

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

clear
echo ""
echo "============================================================"
echo ""
echo "          MCP Jira Automation - Dev Environment"
echo ""
echo "============================================================"
echo ""

# Change to project root
cd "$(dirname "$0")/.."

echo -e "${YELLOW}[1/3]${NC} Starting MCP Atlassian server..."
gnome-terminal --title="MCP Atlassian Server" -- bash -c "./scripts/start-mcp-atlassian.sh; exec bash" 2>/dev/null || \
xterm -title "MCP Atlassian Server" -e "./scripts/start-mcp-atlassian.sh; bash" 2>/dev/null || \
konsole --title "MCP Atlassian Server" -e "./scripts/start-mcp-atlassian.sh" 2>/dev/null || \
x-terminal-emulator -e "./scripts/start-mcp-atlassian.sh" 2>/dev/null
echo -e "       ${GREEN}>${NC} MCP Atlassian window opened"
echo ""

echo -e "${YELLOW}[2/3]${NC} Waiting for MCP Atlassian to initialize..."
sleep 8
echo -e "       ${GREEN}>${NC} Initialization complete"
echo ""

echo -e "${YELLOW}[3/3]${NC} Starting main application..."
gnome-terminal --title="AI Cyber Bot - Main App" -- bash -c "npm run dev; exec bash" 2>/dev/null || \
xterm -title "AI Cyber Bot - Main App" -e "npm run dev; bash" 2>/dev/null || \
konsole --title "AI Cyber Bot - Main App" -e "npm run dev" 2>/dev/null || \
x-terminal-emulator -e "npm run dev" 2>/dev/null
echo -e "       ${GREEN}>${NC} Main app window opened"
echo ""

echo "============================================================"
echo "   All services started successfully!"
echo "============================================================"
echo ""
echo "Two windows have been opened:"
echo "   1. MCP Atlassian Server (port 9000)"
echo "   2. AI Cyber Bot Main App"
echo ""
echo "To stop all services:"
echo "   Close both windows or press Ctrl+C in each"
echo ""
echo "This launcher will close automatically in 3 seconds..."
sleep 3
exit 0
