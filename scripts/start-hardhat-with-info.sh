#!/bin/bash

echo "🔨 Starting Hardhat Node..."
echo ""

cd /Users/shawwalters/eliza-nextjs-starter/contracts

# Start hardhat in background and capture initial output
npx hardhat node > /tmp/hardhat-startup.log 2>&1 &
HARDHAT_PID=$!

# Wait for node to start
sleep 3

# Check if it's running
if ! ps -p $HARDHAT_PID > /dev/null; then
    echo "❌ Hardhat failed to start. Check logs:"
    cat /tmp/hardhat-startup.log
    exit 1
fi

echo "✅ Hardhat node started (PID: $HARDHAT_PID)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🦊 MetaMask Connection Settings"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Network Name:    Hardhat Local"
echo "RPC URL:         http://127.0.0.1:8545"
echo "Chain ID:        31337"
echo "Currency Symbol: ETH"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔑 Test Account (10000 ETH)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Extract first account info from logs
head -40 /tmp/hardhat-startup.log | grep -A 2 "Account #0" | grep -E "Account #0|Private Key"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Quick Setup:"
echo "  1. Open MetaMask"
echo "  2. Add network with settings above"
echo "  3. Import private key for testing"
echo "  4. Refresh browser and connect!"
echo ""
echo "📝 Full logs: /tmp/hardhat-startup.log"
echo "🛑 Stop: pkill -f 'hardhat node'"
echo ""

# Keep showing logs
tail -f /tmp/hardhat-startup.log
