@echo off
setlocal enabledelayedexpansion
title Vajra Governance - Local Server

echo ===================================================
echo       Vajra Governance - Local Dev Runner
echo ===================================================

cd /d "%~dp0"

:: 1. Ensure Node.js is accessible
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else if exist "%LOCALAPPDATA%\Programs\node\node.exe" (
        set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
    ) else (
        echo [ERROR] Node.js is not found on your system.
        echo Please install Node.js (v18+) from https://nodejs.org/
        pause
        exit /b 1
    )
)

:: 2. Ensure .env file exists
if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] .env not found. Creating from .env.example...
        copy ".env.example" ".env" >nul
        echo [OK] Created .env file with default embedded PGlite database settings.
    )
)

:: 3. Ensure dependencies are installed
if not exist "node_modules" (
    echo [INFO] Installing dependencies (npm install)...
    call npm.cmd install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install npm dependencies.
        pause
        exit /b 1
    )
)

echo.
echo ===================================================
echo [STARTING] Vajra Governance Server...
echo - Web Dashboard:  http://localhost:3000
echo - Swagger Docs:    http://localhost:3000/docs
echo - API Base:        http://localhost:3000/api
echo.
echo Press Ctrl+C in this terminal window to stop.
echo ===================================================
echo.

call npm.cmd run dev
pause
