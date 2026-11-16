#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==================================================="
echo "      Vajra Governance - Local Dev Runner"
echo "==================================================="

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js (v18+) from https://nodejs.org/"
    exit 1
fi

echo "[OK] Detected Node.js $(node -v)"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    echo "[INFO] Creating .env from .env.example..."
    cp .env.example .env
fi

if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
fi

echo ""
echo "==================================================="
echo " Starting local server..."
echo " - Web UI:       http://localhost:3000"
echo " - Swagger Docs: http://localhost:3000/docs"
echo " - API Base:     http://localhost:3000/api"
echo "==================================================="
echo "Press Ctrl+C to stop the server."
echo ""

npm run dev
