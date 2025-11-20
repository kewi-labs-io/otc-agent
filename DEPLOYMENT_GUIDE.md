# Multi-Chain Token-Agnostic OTC Deployment Guide

This guide walks through deploying the token-agnostic OTC system to Base mainnet and configuring the complete multi-chain setup.

## Prerequisites

- [ ] Foundry installed (`curl -L https://foundry.paradigm.xyz | bash`)
- [ ] Base mainnet RPC URL (public RPC works fine: https://mainnet.base.org)
- [ ] Private key with ETH on Base mainnet (~0.05 ETH for deployment)
- [ ] Optional: Helius API key (for enhanced Solana token metadata)

## Fresh Wallet Setup (Recommended)

For security best practices, create a fresh wallet specifically for deployment:

```bash
# Generate a new wallet
cast wallet new

# Output will show:
# Address: 0x...
# Private key: 0x...

# Fund the wallet with ~0.05 ETH on Base mainnet
# Use a bridge like https://bridge.base.org/

# Export for deployment
export APPROVER_PRIVATE_KEY=0x...  # Your new private key
export OWNER_ADDRESS=0x...         # Your new wallet address
```

**Why use a fresh wallet?**
- Isolates deployment risks from your main wallet
- Limits exposure if private key is accidentally exposed
- Makes it easier to track deployment-related transactions
- Can be discarded after deployment if desired

## Step 1: Deploy Base Contracts (EVM)

### 1.1 Set Environment Variables

```bash
export APPROVER_PRIVATE_KEY=0x...  # Your private key
export OWNER_ADDRESS=0x...         # Owner address (defaults to deployer)
export AGENT_ADDRESS=0x...         # Agent address (defaults to deployer)
export APPROVER_ADDRESS=0x...      # Approver address (defaults to deployer)
```

### 1.2 Run Deployment Script

```bash
cd contracts

# Dry run (simulation)
forge script script/DeployOTCMainnet.s.sol:DeployOTCMainnet \
  --rpc-url https://mainnet.base.org \
  --slow

# Actual deployment
forge script script/DeployOTCMainnet.s.sol:DeployOTCMainnet \
  --rpc-url https://mainnet.base.org \
  --broadcast \
  --verify \
  --slow
```

**Note**: The script is located at `contracts/script/DeployOTCMainnet.s.sol` (singular `script`, not `scripts`).

### 1.3 Save Deployed Addresses

The script will output:
```
OTC Contract: 0x...
RegistrationHelper: 0x...
```

Save these addresses - you'll need them for environment variables.

### 1.4 Verify Contracts on Basescan

If auto-verification fails:

```bash
# Verify OTC
forge verify-contract <OTC_ADDRESS> OTC \
  --chain-id 8453 \
  --watch \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" <OWNER> <USDC> <ETH_USD_FEED> <AGENT>)

# Verify RegistrationHelper
forge verify-contract <REGISTRATION_HELPER_ADDRESS> RegistrationHelper \
  --chain-id 8453 \
  --watch \
  --constructor-args $(cast abi-encode "constructor(address,address)" <OTC_ADDRESS> <ETH_USD_FEED>)
```

## Step 1.5: Deploy Solana Program (Optional)

**Note**: If you already have a Solana program deployed (e.g., from devnet/testing), you can skip this step and use the existing program ID. The verification script will check if your configured program exists on mainnet.

### Prerequisites

- [ ] Solana CLI installed (`sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`)
- [ ] Anchor CLI installed (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install latest && avm use latest`)
- [ ] SOL in your wallet for deployment (~2-5 SOL recommended for mainnet)
- [ ] Keypair file for deployment

### 1.5.1 Set Up Solana Wallet

```bash
# Generate a new keypair (or use existing)
solana-keygen new --outfile ~/.config/solana/mainnet-deployer.json

# Set as default keypair
solana config set --keypair ~/.config/solana/mainnet-deployer.json

# Set Solana cluster to mainnet
solana config set --url https://api.mainnet-beta.solana.com

# Check balance (need ~2-5 SOL for deployment)
solana balance
```

**If you need SOL:**
- Use a faucet (for devnet/testnet) or
- Buy SOL and transfer to your deployment wallet

### 1.5.2 Build Solana Program

```bash
cd solana/otc-program

# Build the program (Anchor builds in release mode by default)
anchor build

# This creates: target/deploy/otc.so
# Note: Anchor doesn't have a --release flag - it builds optimized by default
```

### 1.5.3 Deploy to Mainnet

**Option A: Using Anchor (Recommended)**

```bash
# Deploy (Anchor will use the Solana CLI config you set earlier)
anchor deploy --provider.cluster mainnet --provider.wallet ~/.config/solana/mainnet-deployer.json

# Save the program ID from output
# Example: Program Id: 8X2wDShtcJ5mFrcsJPjK8tQCD16zBqzsUGwhSCM4ggko

# Note: Make sure you've set the Solana config first:
# solana config set --url https://api.mainnet-beta.solana.com
# solana config set --keypair ~/.config/solana/mainnet-deployer.json
```

**Option B: Using Solana CLI**

```bash
# Deploy the program
solana program deploy \
  --program-id target/deploy/otc-keypair.json \
  --keypair ~/.config/solana/mainnet-deployer.json \
  --url https://api.mainnet-beta.solana.com \
  target/deploy/otc.so

# Save the program ID (from otc-keypair.json or output)
```

### 1.5.4 Initialize Desk Account

After deployment, you need to initialize the desk account:

```bash
# Using the quick-init script (if available)
cd solana/otc-program
bun run scripts/quick-init.ts

# Or manually via Anchor
anchor run init-desk --provider.cluster mainnet
```

**What gets initialized:**
- Desk PDA account (stores OTC state)
- Price feeds configuration
- Limits and parameters

### 1.5.5 Save Deployment Info

Save these values for environment variables:

```
Program ID: 8X2wDShtcJ5mFrcsJPjK8tQCD16zBqzsUGwhSCM4ggko  (from deployment)
Desk Address: <from init-desk output>
Desk Owner: <your wallet address>
```

### 1.5.6 Verify Deployment

```bash
# Check program exists
solana program show <PROGRAM_ID> --url https://api.mainnet-beta.solana.com

# Check desk account
solana account <DESK_ADDRESS> --url https://api.mainnet-beta.solana.com
```

**Expected output:**
- Program should show as "Executable"
- Desk account should exist with data

### Troubleshooting Solana Deployment

**"Insufficient funds"**
- Need ~2-5 SOL for deployment
- Check balance: `solana balance`
- Get SOL from exchange or faucet

**"Program already deployed"**
- If re-deploying, use `--upgrade-authority` flag
- Or deploy to a new program ID

**"Desk initialization fails"**
- Ensure program is deployed first
- Check you have enough SOL for account creation
- Verify program ID matches in Anchor.toml

**Note**: If you're deploying to devnet/testnet first for testing, use:
```bash
solana config set --url https://api.devnet.solana.com  # or testnet
anchor deploy --provider.cluster devnet
```

## Step 2: Update Environment Variables

### 2.1 Production Environment (Vercel)

Add these to your Vercel project settings:

```bash
# Base Contracts (Required)
NEXT_PUBLIC_BASE_OTC_ADDRESS=0x...
NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS=0x...

# Base RPC (public RPC works fine)
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org

# Optional APIs
HELIUS_API_KEY=...                       # Optional, for enhanced Solana metadata

# Cron Job Security (Required for automated listeners)
CRON_SECRET=your-random-secret-key-here  # Generate a random string for cron endpoint auth

# Solana (Required if deploying Solana program)
NEXT_PUBLIC_SOLANA_PROGRAM_ID=8X2wDShtcJ5mFrcsJPjK8tQCD16zBqzsUGwhSCM4ggko  # From Step 1.5
NEXT_PUBLIC_SOLANA_DESK=...              # Desk PDA address from init-desk
NEXT_PUBLIC_SOLANA_DESK_OWNER=...       # Your wallet address (deployer)
NEXT_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com  # Or use Helius/RPC provider
```

### 2.2 Local Development (.env.local)

```bash
# Copy to .env.local
cp .env .env.local

# Add the new variables
echo "NEXT_PUBLIC_BASE_OTC_ADDRESS=0x..." >> .env.local
echo "NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS=0x..." >> .env.local
echo "NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org" >> .env.local

# Optional: Enhanced Solana metadata
echo "HELIUS_API_KEY=..." >> .env.local

# Cron secret (for production - not needed locally)
# echo "CRON_SECRET=..." >> .env.local
```

## Step 2.5: Understanding Wallet Scanning

### Base (EVM) Token Discovery

**No API Keys Required** ✅

The system checks balances for 20+ popular Base tokens including:
- USDC, WETH, elizaOS, DEGEN, BRETT, HIGHER, DAI, and more
- Uses multicall for efficiency (single RPC call)
- Works with any standard Base RPC endpoint

To add more tokens to the scan list, edit `src/utils/popular-base-tokens.ts`:

```typescript
export const POPULAR_BASE_TOKENS: PopularToken[] = [
  {
    address: "0x...",
    symbol: "TOKEN",
    name: "Token Name",
    decimals: 18,
    logoUrl: "https://...",
  },
  // Add more tokens here
];
```

### Solana Token Discovery

Uses native Solana RPC to list ALL SPL tokens in wallet:
- No API key required for basic scanning
- Optional: Helius API key enhances with token names/logos
- Without Helius, tokens show as "SPL Token"

## Step 3: Start Backend Event Listeners

The token registration listeners monitor blockchain events and automatically register tokens to your database when users register them on-chain.

### 3.1 Start Listeners (Development)

**Option A: Standalone Script (Recommended for Development)**

```bash
# Start listeners in a separate terminal
bun run listeners:start

# Or directly:
bun run scripts/start-listeners.ts
```

**Option B: Via API Endpoint**

After starting your Next.js server, call the API endpoint:

```bash
# Start all listeners
curl -X POST http://localhost:5004/api/listeners/start \
  -H "Content-Type: application/json" \
  -d '{"chain": "all"}'

# Or start specific chain
curl -X POST http://localhost:5004/api/listeners/start \
  -H "Content-Type: application/json" \
  -d '{"chain": "base"}'
```

### 3.2 Start Development Server

In a separate terminal, start the Next.js app:

```bash
bun run dev
```

### 3.3 Verify Listeners Started

You should see output like:
```
🚀 Starting token registration listeners...
📡 Starting Base listener...
[Base Listener] Starting listener for 0x...
✅ Base listener started
📡 Starting Solana listener...
[Solana Listener] Starting listener for ...
✅ Solana listener started
🎯 All listeners initialized successfully!
```

### 3.4 Production Deployment (Vercel) - Automated ✅

**The listeners are now automated via Vercel Cron Jobs!** No manual setup required.

When you deploy to Vercel, the cron job automatically runs every minute to poll for new token registrations. The cron job is configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/poll-token-registrations",
      "schedule": "* * * * *"
    }
  ]
}
```

**What happens automatically:**
- ✅ Polls Base chain every minute for new `TokenRegistered` events
- ✅ Polls Solana every minute for new token registrations
- ✅ Automatically registers new tokens to your database
- ✅ Handles errors gracefully and continues polling

**Note:** The cron job is a backup - when users register tokens through the UI, they're synced immediately (see below).

**Environment Variable Required:**

Add to your Vercel project settings:
```bash
CRON_SECRET=your-secret-key-here  # Used to secure the cron endpoint
```

**How it works:**
- The cron job uses polling (not websockets) which works perfectly with Vercel's serverless functions
- Each run checks the last ~1000 blocks (safe window for 1-minute intervals)
- The database automatically prevents duplicates (tokens are keyed by `chain-address`)
- Even if the same block is processed multiple times, duplicate registrations are safely ignored
- No long-running processes needed - perfect for serverless!

**Immediate Sync (Better UX):**
- When users register tokens through the UI, they're synced immediately via `/api/tokens/sync`
- The UI polls the database until the token appears (max 30 seconds)
- Users see "Syncing token..." status instead of waiting for the cron job
- This provides near-instant feedback while the cron job serves as a backup

**Alternative Options (if you need real-time):**
1. **Separate Worker Process**: Deploy `scripts/start-listeners.ts` on Railway/Render/Fly.io for real-time websocket listening
2. **API Endpoint**: Call `/api/listeners/start` via external cron service (not recommended - use built-in cron instead)

## Step 4: Verify Deployment

Run the verification script:

```bash
bun run scripts/verify-multichain-deployment.ts

# Or if the script is executable:
./scripts/verify-multichain-deployment.ts
```

Expected output:
```
=== Verifying Base Deployment ===
✅ OTC contract is deployed
✅ RegistrationHelper is deployed

=== Verifying Solana Deployment ===
✅ Solana program is deployed
✅ Desk account exists

=== Verification Summary ===
Base Deployment: ✅ PASS
Solana Deployment: ✅ PASS
Wallet Scanning: ✅ PASS

🎉 All verifications passed!
```

## Step 5: Test Token Registration

### 5.1 In the UI

1. Navigate to "Create Listing"
2. Click "Register Token from Wallet"
3. Select chain (Base or Solana)
4. Click "Scan My Wallet"
   - **Base**: Shows tokens you hold from the popular list
   - **Solana**: Shows ALL SPL tokens in your wallet
5. Select a token from your wallet (or paste address manually)
6. Review the automatically found oracle/pool
7. Pay registration fee (0.005 ETH on Base, 0.01 SOL on Solana)
8. Confirm transaction
9. Token should now appear in token selection

### 5.1b Manual Token Registration

If your token isn't in the popular list:
1. Scroll to bottom of token selection modal
2. Paste token address in "Or enter token address manually" field
3. Press Enter
4. System will find oracle/pool automatically
5. Complete registration

### 5.2 Monitor Backend Logs

You should see:
```
[Base Listener] Token registered: 0x... by 0x...
[Base Listener] ✅ Successfully registered DEGEN (0x...) to database
```

## Step 6: Optional - Backfill Historical Events

If tokens were registered before the listener started:

```typescript
import { backfillBaseEvents } from '@/services/token-registration-listener-base';
import { backfillSolanaEvents } from '@/services/token-registration-listener-solana';

// Backfill last 10,000 blocks on Base
await backfillBaseEvents();

// Backfill last 100 transactions on Solana
await backfillSolanaEvents();
```

## Step 7: Monitor and Maintain

### 7.1 Monitor Registration Events

- Check Basescan for RegistrationHelper transactions
- Monitor backend logs for TokenRegistered events
- Verify tokens appear in database

### 7.2 Adjust Registration Fee (if needed)

```bash
# Connect as owner
cast send <REGISTRATION_HELPER_ADDRESS> "setRegistrationFee(uint256)" 7500000000000000 \
  --rpc-url https://mainnet.base.org \
  --private-key $OWNER_PRIVATE_KEY
  
# This sets fee to 0.0075 ETH (~$22 at $3000 ETH)
```

### 7.3 Expand Pool Observation Cardinality

For better TWAP security (30-minute vs 5-minute):

```bash
# Step 1: Expand cardinality on popular pools
cast send <POOL_ADDRESS> "increaseObservationCardinalityNext(uint16)" 100 \
  --rpc-url https://mainnet.base.org \
  --private-key $ANY_PRIVATE_KEY

# Step 2: Wait 1-2 hours for observations to accumulate

# Step 3: Upgrade oracle TWAP interval (as oracle owner)
cast send <ORACLE_ADDRESS> "setTWAPInterval(uint32)" 1800 \
  --rpc-url https://mainnet.base.org \
  --private-key $OWNER_PRIVATE_KEY
```

## Troubleshooting

### "Contract not deployed" errors

- Verify `NEXT_PUBLIC_BASE_OTC_ADDRESS` is set correctly
- Check contract exists on Basescan
- Ensure RPC URL is correct

### "No tokens found" when scanning (Base)

- Wallet must hold one of the 20+ popular tokens
- Popular tokens include: USDC, WETH, elizaOS, DEGEN, BRETT, HIGHER
- Use manual address input for tokens not in the popular list
- Check `src/utils/popular-base-tokens.ts` for full list

### "No tokens found" when scanning (Solana)

- Ensure wallet has SPL tokens with balance > 0
- Native SOL is not shown (only SPL tokens)
- Check wallet is connected properly

### "No oracle found" when registering

- Check token has Uniswap V3 pool on Base (or Pyth/Jupiter on Solana)
- Verify pool has liquidity > $50k
- Try different fee tiers (0.05%, 0.3%, 1%)

### Backend listener not receiving events

- **Listeners must be started manually** - they don't auto-start with Next.js
- Ensure listeners are running: `bun run listeners:start` or via API endpoint
- Verify `NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS` is correct
- Check RPC URL is accessible (websocket support not required for HTTP polling)
- Check listener logs for errors
- Ensure environment variables are set correctly
- Try restarting listeners

## Success Criteria Checklist

- [ ] OTC contract deployed and verified on Basescan
- [ ] RegistrationHelper deployed and verified
- [ ] **Solana program deployed (if using Solana)** - Program ID saved
- [ ] **Solana desk initialized (if using Solana)** - Desk address saved
- [ ] Environment variables updated in Vercel
- [ ] CRON_SECRET environment variable set in Vercel
- [ ] Automated cron job configured (already in vercel.json)
- [ ] Verify cron job is running (check Vercel logs after deployment)
- [ ] Verification script passes all checks
- [ ] Wallet scanning works (shows tokens with balances)
- [ ] Test token registration works end-to-end (Base)
- [ ] Test token registration works end-to-end (Solana, if deployed)
- [ ] Tokens appear in database after registration
- [ ] Can create consignments with registered tokens
- [ ] Manual address input works for unlisted tokens

## Next Steps

1. **Expand Popular Token List** (Recommended)
   - Add more tokens to `src/utils/popular-base-tokens.ts`
   - Include tokens your users frequently trade
   - Makes wallet scanning more useful

2. **Seed Initial Tokens** (Optional)
   - Register popular tokens (DEGEN, BRETT, etc.) yourself
   - This provides liquidity for early users
   - Reduces barrier to entry

3. **Monitor Usage**
   - Track token registration events on Basescan
   - Monitor gas costs and optimize if needed
   - Collect user feedback on token discovery UX

4. **Scale as Needed**
   - Increase RPC rate limits if needed
   - Optimize oracle reads for heavily used tokens
   - Add more supported chains (Arbitrum, Optimism, etc.)

## Support

For issues or questions:
- Check logs in Vercel/backend
- Review contract transactions on Basescan
- Verify environment variables are set correctly
- Ensure wallets have sufficient balance for transactions

