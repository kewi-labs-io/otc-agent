#!/bin/bash

# Keep prices fresh on both chains for local dev
# Updates every 30 seconds to prevent staleness

echo "🔄 Starting price keeper for local dev..."
echo "Updates every 30 seconds to prevent staleness"

while true; do
  # Update Solana prices
  cd /Users/shawwalters/eliza-nextjs-starter/solana/otc-program
  ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=./id.json \
    npx ts-node scripts/set-prices.ts > /dev/null 2>&1 && \
    echo "$(date +%H:%M:%S) ✅ Solana prices updated" || \
    echo "$(date +%H:%M:%S) ⚠️  Solana price update failed"
  
  # Update EVM prices
  cd /Users/shawwalters/eliza-nextjs-starter/contracts
  npx hardhat run scripts/update-prices.ts --network localhost > /dev/null 2>&1 && \
    echo "$(date +%H:%M:%S) ✅ EVM prices updated" || \
    echo "$(date +%H:%M:%S) ⚠️  EVM price update failed"
  
  # Wait 30 seconds
  sleep 30
done
