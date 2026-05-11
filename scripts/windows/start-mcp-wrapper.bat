@echo off
REM MCP Atlassian Wrapper - Loads mcp-atlassian.env and starts the server

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

REM Load environment variables (skip comments and empty lines)
for /f "usebackq tokens=1,* delims==" %%a in ("mcp-atlassian.env") do (
    set "line=%%a"
    if not "!line:~0,1!"=="#" (
        if not "!line!"=="" (
            set "%%a=%%b"
        )
    )
)

REM Use values from env file with fallbacks
if "!TRANSPORT!"=="" set TRANSPORT=streamable-http
if "!PORT!"=="" set PORT=9000
if "!HOST!"=="" set HOST=0.0.0.0
if "!MCP_HTTP_PATH!"=="" set MCP_HTTP_PATH=/mcp

echo Starting MCP Atlassian server (%TRANSPORT%) on %HOST%:%PORT%...
echo Press Ctrl+C to stop
echo.

REM Build args based on transport
set MCP_ARGS=--env-file mcp-atlassian.env --transport %TRANSPORT% --host %HOST% --port %PORT%
if "%TRANSPORT%"=="streamable-http" set MCP_ARGS=%MCP_ARGS% --path %MCP_HTTP_PATH%

REM Check for local venv binary first, fall back to PATH
set LOCAL_MCP=.venv-mcp\Scripts\mcp-atlassian.exe
if exist "%LOCAL_MCP%" (
    echo Using local MCP Atlassian: %LOCAL_MCP%
    %LOCAL_MCP% %MCP_ARGS%
) else (
    echo Using MCP Atlassian from PATH
    mcp-atlassian %MCP_ARGS%
)

echo.
echo MCP Atlassian server stopped.
echo.

endlocal
