#!/bin/bash

echo "🔨 Starting Hardhat Node for MetaMask/Rabby..."
echo ""

# Get project root (script is in scripts/ subdirectory)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT/contracts"

# Kill any existing Hardhat processes
pkill -9 -f "hardhat node" 2>/dev/null || true
sleep 1

# Clear port 8545
lsof -t -i:8545 | xargs kill -9 2>/dev/null || true
sleep 1

echo "Starting Hardhat with CORS enabled..."
echo ""

# Start Hardhat node with proper settings
# --hostname 0.0.0.0 allows external connections (including from browser)
npx hardhat node --hostname 127.0.0.1 --port 8545

