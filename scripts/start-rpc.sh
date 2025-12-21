#!/bin/bash
# Start or connect to EVM RPC (Anvil)
set -e

cd "$(dirname "$0")/.."

# Check if already running
if lsof -nP -iTCP:8545 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Using existing RPC at localhost:8545"
    tail -f /dev/null
else
    echo "Starting Anvil..."
    ./scripts/start-anvil.sh &
    sleep 3
    
    echo "Deploying contracts..."
    cd contracts && bun run deploy:eliza
    cd ..
    
    tail -f /dev/null
fi

