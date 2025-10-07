#!/bin/bash

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Hardhat Connection Diagnostics"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Check if port 8545 is in use
echo "1️⃣  Checking port 8545..."
if lsof -i:8545 > /dev/null 2>&1; then
    echo "   ✅ Port 8545 is in use"
    PROCESS=$(lsof -i:8545 | tail -n 1 | awk '{print $1}')
    echo "   📋 Process: $PROCESS"
else
    echo "   ❌ Port 8545 is NOT in use"
    echo "   ➜  Start Hardhat with: cd contracts && npx hardhat node"
    exit 1
fi

echo ""
echo "2️⃣  Testing JSON-RPC connectivity..."

# Test 2: Basic connection
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ HTTP connection successful (200 OK)"
else
    echo "   ❌ HTTP error (Code: $HTTP_CODE)"
    exit 1
fi

# Test 3: Parse JSON response
if echo "$BODY" | jq . > /dev/null 2>&1; then
    echo "   ✅ Valid JSON response"
    CHAIN_ID=$(echo "$BODY" | jq -r '.result')
    if [ "$CHAIN_ID" = "0x7a69" ]; then
        echo "   ✅ Chain ID: 31337 (0x7a69) - Correct!"
    else
        echo "   ⚠️  Chain ID: $CHAIN_ID (Expected: 0x7a69)"
    fi
else
    echo "   ❌ Invalid JSON response!"
    echo "   Response body: $BODY"
    exit 1
fi

echo ""
echo "3️⃣  Testing CORS headers..."

CORS_RESPONSE=$(curl -s -v -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:2222" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>&1)

if echo "$CORS_RESPONSE" | grep -qi "Access-Control-Allow-Origin"; then
    echo "   ✅ CORS is enabled"
    CORS_ORIGIN=$(echo "$CORS_RESPONSE" | grep -i "Access-Control-Allow-Origin" | head -n 1)
    echo "   📋 $CORS_ORIGIN"
else
    echo "   ⚠️  CORS headers not found (may cause browser wallet issues)"
fi

echo ""
echo "4️⃣  Testing eth_accounts..."

ACCOUNTS_RESPONSE=$(curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}')

ACCOUNT_COUNT=$(echo "$ACCOUNTS_RESPONSE" | jq -r '.result | length' 2>/dev/null)

if [ ! -z "$ACCOUNT_COUNT" ] && [ "$ACCOUNT_COUNT" -gt 0 ]; then
    echo "   ✅ Found $ACCOUNT_COUNT test accounts"
    FIRST_ACCOUNT=$(echo "$ACCOUNTS_RESPONSE" | jq -r '.result[0]')
    echo "   📋 First account: $FIRST_ACCOUNT"
else
    echo "   ⚠️  No accounts found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All Diagnostics Passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🦊 MetaMask/Rabby Setup:"
echo ""
echo "Network Name:    Hardhat Local"
echo "RPC URL:         http://127.0.0.1:8545"
echo "Chain ID:        31337"
echo "Currency Symbol: ETH"
echo ""
echo "🔑 Import this private key for testing:"
echo "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo ""
echo "📝 If MetaMask/Rabby still shows errors:"
echo "   1. Make sure you selected 'Hardhat Local' network (Chain ID: 31337)"
echo "   2. Try clearing MetaMask activity: Settings → Advanced → Clear activity"
echo "   3. Disconnect and reconnect your wallet"
echo "   4. Restart your browser"
echo ""
