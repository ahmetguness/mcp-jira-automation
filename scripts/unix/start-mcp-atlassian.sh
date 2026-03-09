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

# Start the server
npx -y @modelcontextprotocol/server-atlassian || {
    echo ""
    echo -e "${RED}ERROR: Failed to start MCP Atlassian server${NC}"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
}
