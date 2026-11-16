<#
.SYNOPSIS
    Starts the Vajra Governance application locally on Windows.
.DESCRIPTION
    Checks for Node.js, ensures .env exists, installs dependencies if missing,
    and launches the Fastify development server with hot-reload.
#>

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "      Vajra Governance - Local Dev Runner          " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# 1. Check if Node.js is in PATH, add default location if not
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (Test-Path "C:\Program Files\nodejs") {
        $env:PATH = "C:\Program Files\nodejs;$env:PATH"
    } elseif (Test-Path "$env:LOCALAPPDATA\Programs\node") {
        $env:PATH = "$env:LOCALAPPDATA\Programs\node;$env:PATH"
    } else {
        Write-Host "[ERROR] Node.js is not found in PATH." -ForegroundColor Red
        Write-Host "Please install Node.js (v18+) from https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
}

$nodeVer = & node -v
Write-Host "[OK] Detected Node.js: $nodeVer" -ForegroundColor Green

# 2. Check for .env file
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "[OK] Created .env from .env.example (uses embedded PGlite database)" -ForegroundColor Green
    }
}

# 3. Check node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] node_modules not found. Installing dependencies..." -ForegroundColor Yellow
    & cmd.exe /c "npm.cmd install"
}

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " Starting local server..." -ForegroundColor Green
Write-Host " - Web UI:       http://localhost:3000" -ForegroundColor White
Write-Host " - Swagger Docs: http://localhost:3000/docs" -ForegroundColor White
Write-Host " - API Base:     http://localhost:3000/api" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server.`n" -ForegroundColor DarkGray

# Launch dev server using npm.cmd to avoid PowerShell execution policy blocks
& cmd.exe /c "npm.cmd run dev"
