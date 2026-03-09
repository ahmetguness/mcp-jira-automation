#!/bin/bash

clear
echo ""
echo "============================================================"
echo ""
echo "              AI Cyber Bot - Main Application"
echo ""
echo "============================================================"
echo ""

# Change to project root
cd "$(dirname "$0")/.."

echo "Note: Make sure MCP Atlassian is running on port 9000"
echo "      Use ./scripts/start-mcp-only.sh if not already started"
echo ""
echo "Starting main application..."
echo ""

npm run dev
