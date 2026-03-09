@echo off
chcp 65001 >nul 2>&1
title MCP Jira Automation - Launcher

cls
echo.
echo ============================================================
echo.
echo          MCP Jira Automation - Dev Environment
echo.
echo ============================================================
echo.

cd /d "%~dp0\.."

echo [1/3] Starting MCP Atlassian server...
start "MCP Atlassian Server" powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start-mcp-atlassian.ps1"
echo       ^> MCP Atlassian window opened
echo.

echo [2/3] Waiting for MCP Atlassian to initialize...
timeout /t 8 /nobreak >nul
echo       ^> Initialization complete
echo.

echo [3/3] Starting main application...
start "AI Cyber Bot - Main App" cmd /k "npm run dev"
echo       ^> Main app window opened
echo.

echo ============================================================
echo   All services started successfully!
echo ============================================================
echo.
echo Two windows have been opened:
echo   1. MCP Atlassian Server (port 9000)
echo   2. AI Cyber Bot Main App
echo.
echo To stop all services:
echo   Close both windows or press Ctrl+C in each
echo.
echo This launcher will close automatically in 3 seconds...
timeout /t 3 /nobreak >nul
exit
