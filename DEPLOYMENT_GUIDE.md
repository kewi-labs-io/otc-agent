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
forge wallet new

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

## Step 1: Deploy Base Contracts

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

# Solana (existing)
NEXT_PUBLIC_SOLANA_PROGRAM_ID=...        # Already configured
NEXT_PUBLIC_SOLANA_DESK=...              # Already configured
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

### 3.1 Update Server Entry Point

Add to `src/server/index.ts` or wherever your backend initializes:

```typescript
import { startBaseListener } from '@/services/token-registration-listener-base';
import { startSolanaListener } from '@/services/token-registration-listener-solana';

// Start listeners on server startup
async function startListeners() {
  try {
    await Promise.all([
      startBaseListener(),
      startSolanaListener(),
    ]);
    console.log('✅ Token registration listeners started');
  } catch (error) {
    console.error('❌ Failed to start listeners:', error);
  }
}

// Call during server initialization
startListeners();
```

### 3.2 Start Development Server

```bash
bun run dev
```

You should see:
```
[Base Listener] Starting listener for 0x...
[Base Listener] Now listening for token registrations
[Solana Listener] Starting listener for ...
[Solana Listener] Now listening for token registrations
```

## Step 4: Verify Deployment

Run the verification script:

```bash
bun run scripts/verify-multichain-deployment.ts
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

- Ensure `NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS` is correct
- Check RPC URL has websocket support
- Verify listeners started successfully (check logs)
- Try restarting server

## Success Criteria Checklist

- [ ] OTC contract deployed and verified on Basescan
- [ ] RegistrationHelper deployed and verified
- [ ] Environment variables updated in Vercel
- [ ] Backend listeners running
- [ ] Verification script passes all checks
- [ ] Wallet scanning works (shows tokens with balances)
- [ ] Test token registration works end-to-end
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

