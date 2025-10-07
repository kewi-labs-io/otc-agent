#!/bin/bash

echo "🦊 MetaMask Setup for Hardhat Local Network"
echo "=============================================="
echo ""
echo "📝 Add this network to MetaMask:"
echo ""
echo "Network Name:    Hardhat Local"
echo "RPC URL:         http://127.0.0.1:8545"
echo "Chain ID:        31337"
echo "Currency Symbol: ETH"
echo ""
echo "📋 Test Accounts (with 10000 ETH each):"
echo ""

# Start hardhat in background, get the first account, then kill it
cd contracts
timeout 5s npx hardhat node 2>&1 | grep -A 20 "Account #0" | head -n 40

echo ""
echo "💡 Quick Setup Steps:"
echo "1. Open MetaMask"
echo "2. Click network dropdown (top-left)"
echo "3. Click 'Add Network' → 'Add a network manually'"
echo "4. Enter the details above"
echo "5. Import Account #0 private key for testing"
echo ""
echo "✅ After setup, refresh your browser and connect!"
