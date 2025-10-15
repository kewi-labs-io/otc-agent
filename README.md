# Eliza OTC Desk

Eliza agent that negotiates OTC token deals. Next.js frontend, EVM and Solana contracts, quote engine with Chainlink price feeds.

## 🚨 Privy Migration Complete

**This project now uses Privy as the single authentication provider for all wallet connections.**

### What Changed
- ✅ **Single login flow**: Privy handles EVM, Solana, and social logins
- ✅ **Removed**: RainbowKit, Solana Wallet Adapter UI
- ✅ **Better UX**: Embedded wallets, social login, single modal

### ⚠️ Required Setup
Before running the app, you MUST:

1. **Get a Privy App ID** from [dashboard.privy.io](https://dashboard.privy.io)
2. **Add to `.env.local`**:
   ```env
   NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id-here
   ```
3. **Configure Privy Dashboard**:
   - Enable login methods: Wallet, Email, Google, Farcaster
   - Add chains: Base (8453), Hardhat (31337)
   - Enable Solana (devnet for testing)

### 📚 Migration Docs
- **[PRIVY_MIGRATION_GUIDE.md](./PRIVY_MIGRATION_GUIDE.md)** - Complete migration guide
- **[PRIVY_MIGRATION_SUMMARY.md](./PRIVY_MIGRATION_SUMMARY.md)** - Detailed summary of changes
- **[PRIVY_API_REFERENCE.md](./PRIVY_API_REFERENCE.md)** - API quick reference

---

## Structure

- `src/lib/agent.ts` - Eliza character and negotiation logic
- `src/lib/plugin-otc-desk` - OTC plugin (providers, actions, quote service)
- `src/app/api/*` - API routes
- `contracts/` - Hardhat contracts (EVM)
- `solana/otc-program/` - Anchor program (Solana)
- `drizzle/` - DB schema (Drizzle ORM)

## Setup

```bash
# Install
bun install
pnpm install --prefix contracts

# Database (optional - falls back to defaults)
# export POSTGRES_URL=postgres://eliza:password@localhost:5439/eliza
bun run db:push

# Generate Solana keypair (first run only)
cd solana/otc-program && solana-keygen new -o id.json && cd ../..

# Start everything (Hardhat + Solana + Next.js on :2222)
bun run dev
```

### Prerequisites
- Bun or Node.js 18+
- pnpm: `npm i -g pnpm`
- Solana CLI: `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
- Anchor: `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.0 && avm use 0.31.0`
- Rust nightly: `rustup toolchain install nightly-2025-04-14`

## MetaMask Local Setup

Add network: RPC `http://127.0.0.1:8545`, Chain ID `31337`

Import test account (has 10k ETH):
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Chain Reset Handling (NEW!)

When you reset the local chain, the app now automatically detects and handles nonce errors:

- **Automatic Detection**: Shows a toast notification when chain reset is detected
- **One-Click Recovery**: "Reset Wallet" button in error messages
- **Dev Reset Button**: Fixed 🔧 button in bottom-right (development only)
- **Smart Error Handling**: All transaction errors are caught with helpful recovery options

No more manual MetaMask resets needed! See [`docs/CHAIN_RESET_HANDLING.md`](./docs/CHAIN_RESET_HANDLING.md) for details.

## Environment

`.env.local`:
```env
# EVM
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_OTC_ADDRESS=<set by deploy>
APPROVER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Solana
NEXT_PUBLIC_SOLANA_RPC=http://127.0.0.1:8899
NEXT_PUBLIC_SOLANA_PROGRAM_ID=<program id from deploy>

# Privy (REQUIRED - Single auth provider for all wallets & social login)
NEXT_PUBLIC_PRIVY_APP_ID=<your-privy-app-id>  # Get from dashboard.privy.io
NEXT_PUBLIC_URL=http://localhost:2222  # or your production URL

# Agent
GROQ_API_KEY=<your key>

# Auth (dev defaults)
API_SECRET_KEY=dev-admin-key
WORKER_AUTH_TOKEN=dev-worker-secret
CRON_SECRET=dev-cron-secret

# Database (optional)
POSTGRES_URL=postgres://eliza:password@localhost:5439/eliza

# Twitter (optional)
X_CONSUMER_KEY=<key>
X_CONSUMER_SECRET=<secret>
```

## 🎯 Multi-Network Support

Your OTC desk supports multiple networks and authentication methods:

### Network Options

**Without Privy (Default):**
- Menu shows: `[ Base | Solana ]`
- RainbowKit for EVM wallets (MetaMask, Rabby, etc.)
- Phantom for Solana wallets

**With Privy (Optional):**
- Menu shows: `[ Base | Solana | Farcaster ]`
- Additional social login via Farcaster, Google, or Email
- Auto-login in Farcaster Mini App

### Privy Setup (Optional - for Farcaster Integration)

**Quick Start:**
1. Create account at [dashboard.privy.io](https://dashboard.privy.io/)
2. Create new app, copy App ID
3. Enable: Farcaster, Email, Google (User Management > Authentication)
4. Add domains: `http://localhost:2222`, `https://farcaster.xyz`, your production URL
5. Set in `.env.local`:
   ```env
   NEXT_PUBLIC_PRIVY_APP_ID=your-app-id
   NEXT_PUBLIC_URL=http://localhost:2222
   ```

**Behavior:**
- **If Privy App ID is set**: Farcaster option appears in network menu
- **If Privy App ID is NOT set**: App works normally with just Base + Solana
- **Graceful degradation**: No Privy errors if not configured

### Testing Farcaster Mini App

**Setup Tunnel (One-Time):**
```bash
npm run tunnel:install
```

**Test Farcaster Integration:**
```bash
# Terminal 1
npm run dev

# Terminal 2
npm run tunnel
# Copy the public HTTPS URL

# Test at: farcaster.xyz/~/developers/mini-apps/embed
```

**Auto-login:** Only works when accessed through Farcaster clients, not direct browser access.

---

## 🎨 Architecture

**Network Menu:** Users choose Base, Solana, or Farcaster (if enabled)

**Clean Separation:**
- **Privy** = Social authentication (Farcaster, Google, Email) - OPTIONAL
- **RainbowKit** = EVM wallet connections (MetaMask, Rabby, etc.) - ALWAYS
- **Solana Adapter** = Solana wallet connections (Phantom, Solflare) - ALWAYS

### 📚 Complete Documentation

- **`README.md`** (this file) - Quick reference and setup
- **`QUICK_START.md`** - 30-second setup guide
- **`FINAL_ARCHITECTURE.md`** - Complete technical architecture
- **`NETWORK_MENU_GUIDE.md`** - Visual guide with screenshots
- **`TUNNEL_SETUP.md`** - Cloudflare tunnel for Farcaster testing
- **`INTEGRATION_COMPLETE.md`** - What was built and why

## Scripts

```bash
bun run dev              # Full stack (Hardhat + Solana + Next.js)
bun run db:push          # Apply DB schema
npm run worker:start     # Quote approval worker

# Farcaster Testing
npm run tunnel:install   # Install Cloudflare Tunnel (one-time)
npm run tunnel           # Start public tunnel for Farcaster testing

# EVM only
npm run rpc:start        # Hardhat + deploy
npm run rpc:deploy       # Deploy contracts

# Solana only  
npm run sol:validator    # Local validator
npm run sol:deploy       # Build + deploy program
npm run sol:dev          # Validator + deploy

# Tests
npm run test             # Unit tests
npm run cypress:run      # E2E tests
```

## Deploy

### EVM
```bash
cd contracts
export ETH_RPC_URL=https://sepolia.infura.io/v3/<key>
export DEPLOYER_PRIVATE_KEY=0x...
pnpm hardhat ignition deploy ./ignition/modules/OTCDesk.ts --network sepolia
```

### Solana
```bash
cd solana/otc-program
solana config set -u devnet
anchor build
anchor deploy
# Set NEXT_PUBLIC_SOLANA_PROGRAM_ID to output
```

### Production
```bash
npm run build
npm start  # Port 2222
```

Deploy to Vercel/Netlify/etc with production env vars.