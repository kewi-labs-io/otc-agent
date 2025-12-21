#!/bin/bash

# Deploy using Forge and update environment
cd "$(dirname "$0")/.."

echo "Deploying with Forge..."
forge script scripts/DeployElizaOTC.s.sol:DeployElizaOTC \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --legacy

# Write sanitized deployment to src config (NO private keys)
mkdir -p ../src/config/deployments
bun -e '
import { readFileSync, writeFileSync } from "fs";

const raw = readFileSync("deployments/eliza-otc-deployment.json", "utf8");
const json = JSON.parse(raw);

const otc = json.contracts?.otc ?? json.contracts?.deal ?? "";
const usdc = json.contracts?.usdc ?? json.contracts?.usdcToken ?? "";

const out = {
  network: "local-anvil",
  chainId: 31337,
  rpc: "http://127.0.0.1:8545",
  timestamp: new Date().toISOString(),
  deployer: json.accounts?.owner,
  contracts: {
    otc,
    usdc,
    elizaToken: json.contracts?.elizaToken,
    elizaUsdFeed: json.contracts?.elizaUsdFeed,
    ethUsdFeed: json.contracts?.ethUsdFeed,
    registrationHelper: json.contracts?.registrationHelper,
  },
  accounts: json.accounts,
};

writeFileSync("../src/config/deployments/local-evm.json", JSON.stringify(out, null, 2));
' || exit 1

echo "✅ Wrote sanitized deployment to src/config/deployments/local-evm.json"

# Merge deployment env vars into .env.local
if [ -f .env.deployment ]; then
  echo ""
  echo "Updating .env.local..."
  
  ENV_LOCAL="../.env.local"
  
  # Create .env.local if it doesn't exist
  touch "$ENV_LOCAL"
  
  # Read each line from .env.deployment and update .env.local
  while IFS='=' read -r key value; do
    # Never merge public config into env - contract addresses live in JSON deployments
    if [[ "$key" == NEXT_PUBLIC_* ]]; then
      continue
    fi
    if [ -n "$key" ] && [ -n "$value" ]; then
      # Remove existing key if present
      sed -i.bak "/^${key}=/d" "$ENV_LOCAL" 2>/dev/null || true
      # Add new value
      echo "${key}=${value}" >> "$ENV_LOCAL"
    fi
  done < .env.deployment
  
  rm -f "${ENV_LOCAL}.bak"
  rm -f .env.deployment
  
  echo "Environment variables updated in .env.local"
fi

echo ""
echo "Deployment complete"

