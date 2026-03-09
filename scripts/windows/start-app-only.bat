@echo off
chcp 65001 >nul 2>&1
title AI Cyber Bot - Main App

cls
echo.
echo ============================================================
echo.
echo              AI Cyber Bot - Main Application
echo.
echo ============================================================
echo.

cd /d "%~dp0\.."

echo Note: Make sure MCP Atlassian is running on port 9000
echo       Use scripts\start-mcp-only.bat if not already started
echo.
echo Starting main application...
echo.

npm run dev
