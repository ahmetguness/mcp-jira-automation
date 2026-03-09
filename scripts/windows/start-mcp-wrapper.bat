@echo off
REM MCP Atlassian Wrapper - Ensures clean terminal shutdown
REM This wrapper prevents terminal corruption after Ctrl+C

setlocal enabledelayedexpansion

REM Change to project root (two levels up from scripts/windows/)
cd /d "%~dp0\..\.."

echo.
echo ============================================================
echo            MCP Atlassian Server
echo ============================================================
echo.

REM Check if mcp-atlassian.env exists
if not exist "mcp-atlassian.env" (
    echo ERROR: mcp-atlassian.env not found!
    echo Current directory: %CD%
    echo Please copy mcp-atlassian.env.example to mcp-atlassian.env
    echo.
    pause
    exit /b 1
)

echo Loading configuration from mcp-atlassian.env...
echo.

REM Load environment variables
for /f "usebackq tokens=1,* delims==" %%a in ("mcp-atlassian.env") do (
    set "line=%%a"
    if not "!line:~0,1!"=="#" (
        if not "!line!"=="" (
            set "%%a=%%b"
        )
    )
)

echo Starting MCP Atlassian server on port 9000...
echo Press Ctrl+C to stop
echo.
echo Note: Verbose logging is controlled by FASTMCP_LOG_LEVEL in mcp-atlassian.env
echo.

REM Start the server with proper signal handling
mcp-atlassian --env-file mcp-atlassian.env --transport sse --port 9000

REM Restore terminal after exit (whether normal or Ctrl+C)
echo.
echo Shutting down MCP Atlassian server...

REM Force terminal reset
echo. >nul 2>&1
cls >nul 2>&1 || echo.

echo Terminal restored. You can now type commands.
echo.

endlocal
