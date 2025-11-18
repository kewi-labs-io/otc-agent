# Quick Start: Multi-Chain Token Registration

This guide gets you from zero to deployed in ~30 minutes.

## Prerequisites (5 minutes)

```bash
# 1. Install dependencies
bun install  # required - do not use npm

# 2. Create fresh deployment wallet (recommended)
cd contracts
forge wallet new

# Save the output:
# Address: 0x...  (fund with ~0.05 ETH on Base mainnet)
# Private key: 0x... (export as APPROVER_PRIVATE_KEY)

# 3. Optional: Helius API key for enhanced Solana metadata
- Get free key at https://www.helius.dev/ (optional)
- Without it, Solana tokens will show as "SPL Token"
```

**Why use a fresh wallet?**
- Isolates deployment risks from your main wallet
- Limits exposure if private key is accidentally exposed
- Makes it easier to track deployment-related transactions
- Can be discarded after deployment if desired

## Deploy Contracts (10 minutes)

```bash
cd contracts

# Set environment variables
export APPROVER_PRIVATE_KEY=0x...

# Deploy to Base mainnet
forge script script/DeployOTCMainnet.s.sol:DeployOTCMainnet \
  --rpc-url https://mainnet.base.org \
  --broadcast \
  --verify \
  --slow

# Save the output addresses:
# OTC Contract: 0x...
# RegistrationHelper: 0x...
```

## Configure Environment (5 minutes)

### Local Development

```bash
# Add to .env.local
echo "NEXT_PUBLIC_BASE_OTC_ADDRESS=0x..." >> .env.local
echo "NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS=0x..." >> .env.local

# Optional: For enhanced Solana metadata
echo "HELIUS_API_KEY=your_key" >> .env.local
```

### Production (Vercel)

Add to Vercel Environment Variables:
- `NEXT_PUBLIC_BASE_OTC_ADDRESS`
- `NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS`
- `HELIUS_API_KEY` (optional, for Solana metadata)

## Start Backend Listeners (5 minutes)

Add to your server entry point (e.g., `src/server/index.ts`):

```typescript
import { startBaseListener } from '@/services/token-registration-listener-base';
import { startSolanaListener } from '@/services/token-registration-listener-solana';

// On server startup
await Promise.all([
  startBaseListener(),
  startSolanaListener(),
]);
```

Then start your dev server:

```bash
bun run dev
```

## Verify Deployment (5 minutes)

```bash
bun run scripts/verify-multichain-deployment.ts
```

Expected output:
```
✅ Base Deployment: PASS
✅ Solana Deployment: PASS  
✅ Wallet Scanning: PASS
🎉 All verifications passed!
```

## Test Registration (5 minutes)

### How Wallet Scanning Works

**Base (EVM)**:
- Checks balances for 20+ popular tokens (USDC, WETH, elizaOS, DEGEN, etc.)
- Uses multicall for fast, single RPC call
- No API keys needed - works with standard Base RPC

**Solana**:
- Lists ALL SPL tokens in your wallet using native RPC
- Optional: Helius API enhances with token names/logos

### Test Flow

1. Open app in browser
2. Connect wallet (Privy or Farcaster)
3. Go to "Create Listing"
4. Click "Register Token from Wallet"
5. Select Base or Solana
6. Click "Scan My Wallet"
7. Select a token from the list (or paste address manually)
8. Review oracle/pool automatically found
9. Pay registration fee (0.005 ETH or 0.01 SOL)
10. Confirm transaction
11. ✅ Token appears in selection

## Troubleshooting

### "Contract not deployed"
- Check `NEXT_PUBLIC_BASE_OTC_ADDRESS` is set
- Verify contract exists on Basescan

### "No tokens found" (Base)
- Wallet must hold one of the 20+ popular tokens
- Try manual address input at bottom of modal
- Popular tokens include: USDC, WETH, elizaOS, DEGEN, BRETT, HIGHER

### "No tokens found" (Solana)
- Ensure wallet has SPL tokens with balance > 0
- Native SOL is not shown (only SPL tokens)

### "No oracle found"
- Verify token has Uniswap V3 pool (Base) or Pyth/Jupiter (Solana)
- Check pool has liquidity > $50k
- Try popular trading pairs (vs USDC, WETH)

### Backend not receiving events
- Ensure listeners started (check logs)
- Verify `NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS` is correct
- Check RPC URL supports websockets

## Next Steps

- Read `DEPLOYMENT_GUIDE.md` for detailed instructions
- Monitor registrations on Basescan
- Seed popular tokens yourself to bootstrap marketplace
- Add more tokens to `src/utils/popular-base-tokens.ts` as needed

## Support

Need help? Check:
1. Logs in Vercel/backend
2. Contract transactions on Basescan
3. Environment variables are set correctly
4. Wallet has sufficient balance

---

**🎉 That's it! Your multi-chain token-agnostic OTC desk is ready.**

Users can now register any token themselves by:
1. Scanning their wallet
2. Selecting a token
3. Paying a small fee

No more admin bottleneck!

