@echo off
title MCP Jira Automation - Dev Environment

echo ==========================================
echo Starting MCP Jira Automation Environment
echo ==========================================
echo.

set "ROOT_DIR=D:\repo\Github\mcp-jira-automation"
set "ATLASSIAN_DIR=%ROOT_DIR%\mcp-atlassian"

echo Starting MCP Atlassian server...
start "" wt -w 0 new-tab -d "%ATLASSIAN_DIR%" powershell -NoExit -Command ".\run.ps1"

echo Waiting for MCP Atlassian to initialize...
timeout /t 10 /nobreak >nul

echo Starting main project...
wt -w 0 split-pane -H -d "%ROOT_DIR%" powershell -NoExit -Command "npm run dev"

echo.
echo Development environment started.
echo.