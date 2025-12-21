#!/bin/bash
# Deploy Solana OTC Program to Mainnet
# 
# Prerequisites:
# 1. Install Solana CLI: sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
# 2. Install Anchor CLI: cargo install --git https://github.com/coral-xyz/anchor anchor-cli
# 3. Have a funded wallet at ~/.config/solana/id.json (needs ~3 SOL for deployment)
#
# Usage:
#   ./scripts/deploy-solana-mainnet.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PROGRAM_DIR="$PROJECT_ROOT/solana/otc-program"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Solana Mainnet OTC Program Deployment"
echo "═══════════════════════════════════════════════════════════════════════"
echo

# Check prerequisites
if ! command -v solana &> /dev/null; then
    echo "ERROR: Solana CLI not installed"
    echo "Install: sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    exit 1
fi

if ! command -v anchor &> /dev/null; then
    echo "ERROR: Anchor CLI not installed"
    echo "Install: cargo install --git https://github.com/coral-xyz/anchor anchor-cli"
    exit 1
fi

# Check wallet
WALLET_PATH="${SOLANA_WALLET:-$HOME/.config/solana/id.json}"
if [ ! -f "$WALLET_PATH" ]; then
    echo "ERROR: No wallet found at $WALLET_PATH"
    echo "Create one with: solana-keygen new"
    exit 1
fi

# Check balance
echo "Checking wallet balance..."
BALANCE=$(solana balance --url mainnet-beta 2>/dev/null | grep -oE '[0-9.]+' | head -1)
echo "Wallet balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo "WARNING: Low balance. Deployment requires ~2-3 SOL."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Build program
echo
echo "Building program..."
cd "$PROGRAM_DIR"
anchor build

# Get program ID from keypair
PROGRAM_KEYPAIR="$PROGRAM_DIR/target/deploy/otc-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    echo "ERROR: Program keypair not found at $PROGRAM_KEYPAIR"
    exit 1
fi

PROGRAM_ID=$(solana address -k "$PROGRAM_KEYPAIR")
echo "Program ID: $PROGRAM_ID"

# Check if program exists
echo
echo "Checking if program is already deployed..."
PROGRAM_STATUS=$(solana program show "$PROGRAM_ID" --url mainnet-beta 2>&1 || true)

if echo "$PROGRAM_STATUS" | grep -q "has been closed"; then
    echo "Program was previously closed. Redeploying..."
elif echo "$PROGRAM_STATUS" | grep -q "Program Id:"; then
    echo "Program already deployed. Upgrading..."
else
    echo "Program not found. Fresh deployment..."
fi

# Deploy
echo
echo "Deploying to mainnet..."
echo "This may take a few minutes..."
echo

anchor deploy \
    --provider.cluster mainnet \
    --provider.wallet "$WALLET_PATH" \
    --program-keypair "$PROGRAM_KEYPAIR" \
    --program-name otc

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Deployment Complete"
echo "═══════════════════════════════════════════════════════════════════════"
echo
echo "Program ID: $PROGRAM_ID"
echo
echo "Next steps:"
echo "  1. Initialize the desk: bun run scripts/init-solana-mainnet-desk.ts"
echo "  2. Update .env.local with NEXT_PUBLIC_NETWORK=mainnet"
echo "  3. Restart your dev server"
echo
