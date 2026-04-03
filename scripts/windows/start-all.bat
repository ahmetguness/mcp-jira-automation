@echo off
chcp 65001 >nul 2>&1
title MCP Jira Automation

cd /d "%~dp0\.."

echo.
echo ============================================================
echo          MCP Jira Automation - Dev Environment
echo ============================================================
echo.

echo [1/2] Starting MCP Atlassian server in background...
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-mcp-atlassian.ps1" >nul 2>&1 &
echo       ^> MCP Atlassian started (background)
echo.

echo [2/2] Waiting for MCP Atlassian to initialize...
timeout /t 8 /nobreak >nul
echo       ^> Ready
echo.

echo ============================================================
echo   Starting main application... (Ctrl+C to stop)
echo ============================================================
echo.

npm run dev
