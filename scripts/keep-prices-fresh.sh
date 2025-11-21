#!/bin/bash

# Keep prices fresh on both chains for local dev
# Updates every 30 seconds to prevent staleness

# Get project root (script is in scripts/ subdirectory)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load environment variables from .env.local
if [ -f "$PROJECT_ROOT/.env.local" ]; then
  set -a
  source "$PROJECT_ROOT/.env.local"
  set +a
fi

# Check if using production networks
NETWORK="${NETWORK:-${NEXT_PUBLIC_NETWORK:-localnet}}"
IS_PRODUCTION_NETWORK=false
if [[ "$NETWORK" =~ ^(base|bsc|jeju-mainnet|mainnet)$ ]]; then
  IS_PRODUCTION_NETWORK=true
fi

# Check if using production Solana
IS_PRODUCTION_SOLANA=false
if [[ "$NEXT_PUBLIC_SOLANA_RPC" =~ https://api\.mainnet-beta ]]; then
  IS_PRODUCTION_SOLANA=true
fi

if [ "$IS_PRODUCTION_NETWORK" = true ] || [ "$IS_PRODUCTION_SOLANA" = true ]; then
  echo "✅ Using production networks - price updates handled by on-chain oracles"
  echo "   Skipping manual price updates"
  echo "   Network: $NETWORK"
  echo "   Solana: $([ "$IS_PRODUCTION_SOLANA" = true ] && echo 'mainnet' || echo 'local')"
  exit 0
fi

echo "🔄 Starting price keeper for local dev..."
echo "Updates every 30 seconds to prevent staleness"

while true; do
  # Update Solana prices
  cd "$PROJECT_ROOT/solana/otc-program"
  
  # Add Solana platform tools and anchor to PATH
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/binaries/anchor-0.31.1:$PATH"
  
  # Build Anchor program if IDL doesn't exist
  if [ ! -f "./target/idl/otc.json" ]; then
    echo "$(date +%H:%M:%S) 🔨 Building Anchor program (IDL missing)..."
    
    # Check if anchor is available after adding to PATH
    if ! command -v anchor &> /dev/null; then
      echo "$(date +%H:%M:%S) ⚠️  Anchor not found. Install with: cargo install --git https://github.com/coral-xyz/anchor avm --locked --force && avm install 0.31.1 && avm use 0.31.1"
      echo "$(date +%H:%M:%S) ⚠️  Or build manually: cd solana/otc-program && bun run build"
      sleep 30
      continue
    fi
    
    # Check if cargo-build-sbf is available
    if ! command -v cargo-build-sbf &> /dev/null; then
      echo "$(date +%H:%M:%S) ⚠️  Solana platform tools not found. Install with: curl --proto '=https' --tlsv1.2 -sSf https://release.anza.xyz/stable/install | sh"
      sleep 30
      continue
    fi
    
    # Try to build
    bun run build > /dev/null 2>&1
    if [ ! -f "./target/idl/otc.json" ]; then
      echo "$(date +%H:%M:%S) ⚠️  Solana price update skipped (build failed - run manually to see errors: cd solana/otc-program && bun run build)"
      sleep 30
      continue
    fi
    echo "$(date +%H:%M:%S) ✅ Anchor program built successfully"
  fi
  
  # Run price update and capture output
  OUTPUT=$(ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=./id.json \
    bun scripts/set-prices.ts 2>&1)
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo "$(date +%H:%M:%S) ✅ Solana prices updated"
  else
    # Extract the actual error message - look for lines with "error:" (lowercase) after ❌ Error:
    ERROR_MSG=$(echo "$OUTPUT" | grep -A 5 "❌ Error:" | grep "^error:" | head -1 | sed 's/^error: //' | sed 's/^[[:space:]]*//' | cut -c1-80)
    if [ -z "$ERROR_MSG" ]; then
      # Fallback: get error message from throw new Error lines
      ERROR_MSG=$(echo "$OUTPUT" | grep -E "throw new Error|Error:" | grep -v "at " | head -1 | sed 's/.*Error: //; s/.*error: //' | sed "s/['\"]//g" | cut -c1-80)
    fi
    if [ -z "$ERROR_MSG" ]; then
      # Last resort: get any line with "not deployed" or "not running"
      ERROR_MSG=$(echo "$OUTPUT" | grep -E "(not deployed|not running|Cannot verify)" | head -1 | cut -c1-80)
    fi
    if [ -n "$ERROR_MSG" ]; then
      echo "$(date +%H:%M:%S) ⚠️  Solana price update failed: $ERROR_MSG"
    else
      echo "$(date +%H:%M:%S) ⚠️  Solana price update failed"
    fi
  fi
  
  # Update EVM prices (using cast with local Anvil)
  cd "$PROJECT_ROOT"
  
  # Set manual prices on local Anvil: $1.00 token, $3000 ETH (8 decimals)
  # Token: 1.00 * 10^8 = 100000000
  # ETH: 3000 * 10^8 = 300000000000
  # Check for network-specific contract address
  DEPLOYED_OTC=""
  if [ -f ".env.local" ]; then
    if [ "$NETWORK" = "base" ]; then
      DEPLOYED_OTC=$(grep "^NEXT_PUBLIC_BASE_OTC_ADDRESS=" .env.local 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
    elif [ "$NETWORK" = "bsc" ]; then
      DEPLOYED_OTC=$(grep "^NEXT_PUBLIC_BSC_OTC_ADDRESS=" .env.local 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
    else
      DEPLOYED_OTC=$(grep "^NEXT_PUBLIC_OTC_ADDRESS=" .env.local 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
    fi
  fi
  
  # Only update prices if we have a local deployment (not production)
  if [ -n "$DEPLOYED_OTC" ] && [[ "$DEPLOYED_OTC" =~ ^0x[0-9a-fA-F]{40}$ ]] && [ "$IS_PRODUCTION_NETWORK" = false ]; then
    # Check if Anvil is running
    if curl -s http://127.0.0.1:8545 > /dev/null 2>&1; then
      cast send "$DEPLOYED_OTC" "setManualPrices(uint256,uint256,bool)" 100000000 300000000000 true \
        --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 > /dev/null 2>&1 && \
        echo "$(date +%H:%M:%S) ✅ EVM prices updated" || \
        echo "$(date +%H:%M:%S) ⚠️  EVM price update failed"
    else
      echo "$(date +%H:%M:%S) ⚠️  EVM price update skipped (Anvil not running)"
    fi
  else
    echo "$(date +%H:%M:%S) ⚠️  EVM price update skipped (using production network or no local deployment)"
  fi
  
  # Wait 30 seconds
  sleep 30
done

