# MCP Atlassian Server Launcher
# Loads environment from mcp-atlassian.env and starts the server

$ErrorActionPreference = "Stop"

# Find project root by looking for package.json
$currentDir = $PSScriptRoot
for ($i = 0; $i -lt 5; $i++) {
    if (Test-Path (Join-Path $currentDir "package.json")) {
        Set-Location $currentDir
        break
    }
    $currentDir = Split-Path $currentDir -Parent
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "           MCP Atlassian Server" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Working directory: $(Get-Location)" -ForegroundColor Gray
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
    Write-Host "Current directory: $(Get-Location)" -ForegroundColor Yellow
    Write-Host "Please copy mcp-atlassian.env.example to mcp-atlassian.env" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "Starting MCP Atlassian server on port 9000..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""
Write-Host "Note: Verbose logging is controlled by FASTMCP_LOG_LEVEL in mcp-atlassian.env" -ForegroundColor Gray
Write-Host ""

# Save current terminal state
$originalTitle = $host.UI.RawUI.WindowTitle

# Function to restore terminal on exit
function Restore-Terminal {
    Write-Host ""
    Write-Host "Shutting down MCP Atlassian server..." -ForegroundColor Yellow
    
    # Kill any remaining mcp-atlassian processes
    Get-Process | Where-Object { $_.ProcessName -like "*mcp-atlassian*" -or $_.ProcessName -like "*python*" } | ForEach-Object {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        } catch {
            # Ignore errors
        }
    }
    
    # Restore terminal title
    $host.UI.RawUI.WindowTitle = $originalTitle
    
    # Force terminal reset
    Write-Host "`e[0m" -NoNewline  # Reset all attributes
    [Console]::ResetColor()
    
    # Clear any stuck input
    while ([Console]::KeyAvailable) {
        [Console]::ReadKey($true) | Out-Null
    }
    
    Write-Host "Terminal restored. You can now type commands." -ForegroundColor Green
    Write-Host ""
}

# Start the server in a job so we can control it better
$job = Start-Job -ScriptBlock {
    param($envFile)
    
    # Load environment
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
                $name = $matches[1].Trim()
                $value = $matches[2].Trim()
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
    }
    
    # Start MCP server
    & mcp-atlassian --env-file $envFile --transport sse --port 9000
} -ArgumentList (Join-Path $PWD "mcp-atlassian.env")

# Wait for job and handle Ctrl+C
try {
    # Monitor the job
    while ($job.State -eq 'Running') {
        # Receive any output from the job
        Receive-Job -Job $job -ErrorAction SilentlyContinue | Write-Host
        Start-Sleep -Milliseconds 100
    }
    
    # Job finished, get final output
    Receive-Job -Job $job -ErrorAction SilentlyContinue | Write-Host
    
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    # Stop the job if still running
    if ($job.State -eq 'Running') {
        Stop-Job -Job $job -ErrorAction SilentlyContinue
    }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    
    # Always restore terminal
    Restore-Terminal
}
