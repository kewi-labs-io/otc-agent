#!/bin/bash
set -euo pipefail

echo "[playwright] Cleaning previous processes..."
pkill -f "hardhat node" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

ROOT="/Users/shawwalters/eliza-nextjs-starter"
cd "$ROOT"

echo "[playwright] Starting Hardhat node..."
(cd contracts && npx hardhat node > ../hardhat.log 2>&1 & echo $! > ../.hardhat.pid)
sleep 3

echo "[playwright] Waiting for Hardhat RPC..."
for i in {1..30}; do
  if curl -s -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[playwright] Deploying contracts..."
(cd contracts && npx hardhat run scripts/deploy-eliza-otc.ts --network localhost >> ../deploy.log 2>&1 || true)
(cd contracts && npx hardhat run deploy-test-token.ts --network localhost >> ../deploy.log 2>&1 || true)

echo "[playwright] Exporting env for worker..."
export API_SECRET_KEY="test-secret"
export APPROVER_PRIVATE_KEY=$(node -e "const fs=require('fs');const p='./contracts/deployments/eliza-otc-deployment.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j.testWalletPrivateKey);")

echo "[playwright] Starting Next.js..."
echo "[playwright] Building Next..."
npx next build > build.log 2>&1 || true

echo "[playwright] Starting Next and auto-starting quote approval worker..."
NEXT_PUBLIC_API_URL=http://localhost:2222 \
API_SECRET_KEY=$API_SECRET_KEY \
APPROVER_PRIVATE_KEY=$APPROVER_PRIVATE_KEY \
npx next start -p 2222 &
NEXT_PID=$!

# wait for Next to be ready
for i in {1..120}; do
  if curl -s http://localhost:2222 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[playwright] Starting worker via API..."
curl -s -X POST http://localhost:2222/api/worker/quote-approval -H "Authorization: Bearer $API_SECRET_KEY" -H "Content-Type: application/json" -d '{"action":"start"}' || true

wait $NEXT_PID

