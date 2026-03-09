# MCP Atlassian Server Launcher
# Loads environment from mcp-atlassian.env and starts the server

$ErrorActionPreference = "Stop"

# Change to project root
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "           MCP Atlassian Server" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Load environment variables from mcp-atlassian.env
if (Test-Path "mcp-atlassian.env") {
    Write-Host "Loading configuration from mcp-atlassian.env..." -ForegroundColor Yellow
    Get-Content "mcp-atlassian.env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
            Write-Host "  > $name set" -ForegroundColor Green
        }
    }
    Write-Host ""
} else {
    Write-Host "ERROR: mcp-atlassian.env not found!" -ForegroundColor Red
    Write-Host "Please copy mcp-atlassian.env.example to mcp-atlassian.env" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "Starting MCP Atlassian server on port 9000..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Start the server
try {
    npx -y @modelcontextprotocol/server-atlassian
} catch {
    Write-Host ""
    Write-Host "ERROR: Failed to start MCP Atlassian server" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    pause
    exit 1
}
