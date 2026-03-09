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

cd /d "%~dp0\..\.."

echo Starting MCP Atlassian server on port 9000...
echo Using wrapper script for clean terminal handling...
echo.

REM Use the wrapper script for better terminal handling
REM Both scripts are in the same directory (scripts/windows/)
call "%~dp0\start-mcp-wrapper.bat"
