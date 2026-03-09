#!/bin/bash

clear
echo ""
echo "============================================================"
echo ""
echo "            MCP Atlassian Server - Standalone"
echo ""
echo "============================================================"
echo ""

# Change to project root
cd "$(dirname "$0")/.."

echo "Starting MCP Atlassian server on port 9000..."
echo ""

./scripts/start-mcp-atlassian.sh
