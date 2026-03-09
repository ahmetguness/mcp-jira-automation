#!/bin/bash

# MCP Atlassian Server Launcher
# Loads environment from mcp-atlassian.env and starts the server

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Change to project root
cd "$(dirname "$0")/.."

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}           MCP Atlassian Server${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""

# Load environment variables from mcp-atlassian.env
if [ -f "mcp-atlassian.env" ]; then
    echo -e "${YELLOW}Loading configuration from mcp-atlassian.env...${NC}"
    
    # Export variables
    set -a
    source mcp-atlassian.env
    set +a
    
    echo -e "  ${GREEN}> Configuration loaded${NC}"
    echo ""
else
    echo -e "${RED}ERROR: mcp-atlassian.env not found!${NC}"
    echo -e "${YELLOW}Please copy mcp-atlassian.env.example to mcp-atlassian.env${NC}"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

echo -e "${GREEN}Starting MCP Atlassian server on port 9000...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""
echo -e "${NC}Note: Verbose logging is controlled by FASTMCP_LOG_LEVEL in mcp-atlassian.env${NC}"
echo ""

# Function to restore terminal on exit
restore_terminal() {
    echo ""
    echo -e "${YELLOW}Shutting down MCP Atlassian server...${NC}"
    
    # Restore terminal settings
    stty sane 2>/dev/null || true
    
    # Reset terminal
    reset 2>/dev/null || tput reset 2>/dev/null || true
    
    echo -e "${GREEN}Terminal restored${NC}"
    exit 0
}

# Trap Ctrl+C (SIGINT) and other termination signals
trap restore_terminal SIGINT SIGTERM EXIT

# Start the server using Python package
mcp-atlassian --env-file mcp-atlassian.env --transport sse --port 9000 || {
    echo ""
    echo -e "${RED}ERROR: Failed to start MCP Atlassian server${NC}"
    echo -e "${YELLOW}Make sure mcp-atlassian is installed:${NC}"
    echo -e "${YELLOW}  pip install mcp-atlassian${NC}"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
}
