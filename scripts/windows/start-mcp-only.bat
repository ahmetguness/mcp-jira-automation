@echo off
chcp 65001 >nul 2>&1
title MCP Atlassian Server

cls
echo.
echo ============================================================
echo.
echo            MCP Atlassian Server - Standalone
echo.
echo ============================================================
echo.

cd /d "%~dp0\.."

echo Starting MCP Atlassian server on port 9000...
echo.

powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start-mcp-atlassian.ps1"
