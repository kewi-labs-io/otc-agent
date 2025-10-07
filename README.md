## Eliza OTC Desk Agent

Production-ready starter that demonstrates an Eliza agent negotiating OTC token deals as a discount from spot for 1–52 week lockups. It includes a modern Next.js app, a negotiation agent, local smart contracts, and end‑to‑end workflows from quote to on‑chain acceptance.

### Highlights
- **Agent negotiation**: Discount-from-spot quotes (2%–25%) with 1–52w lockups
- **Eliza plugin architecture**: Purpose-built OTC Desk plugin with actions
- **On-chain demo**: Local Hardhat network and OTC contracts with Chainlink price oracles
- **Web3 UI**: Wallet connect, quote views, and acceptance flows
- **Robust backend**: API routes, background worker, and persistence (Drizzle)
- **Testing**: Cypress E2E plus unit tests
- **Security-optimized transaction flow**: User commits to payment before approval

### Recent Improvements (Oct 2025)

#### Deal Completion & USD Calculation Fixes
- ✅ **Fixed NaN in Discount ROI**: Added safety check `discountedUsd > 0` before division
- ✅ **Fixed $0.00 displays**: API now fetches real on-chain offer data from smart contract
- ✅ **Chainlink oracle integration**: USD values calculated from on-chain Chainlink price feeds
- ✅ **Graceful fallbacks**: Shows "N/A" for unavailable values instead of crashing
- ✅ **Proper deal tracking**: Completed deals now appear in "My Deals" page
- ✅ **Transaction hash recording**: Payment transactions properly stored for audit trail

#### Security & Transaction Flow Optimization
- ✅ **Improved transaction security**: User pre-authorizes payment BEFORE approval to prevent approved-but-unpaid offers
- ✅ **Atomic-like execution**: Payment executes immediately after approval (minimized window)
- ✅ **Better error handling**: Clear recovery paths if payment fails after approval
- ✅ **User commitment**: For USDC, allowance approved upfront; for ETH, balance verified before approval

#### Type & Build Fixes
- ✅ **Type fixes**: Added shared icon components (`/src/components/icons.tsx`) for Base and Solana logos
- ✅ **Build passing**: All TypeScript errors resolved
- ✅ **Linter clean**: Zero linter errors

---

## Transaction Flow (Security-Optimized)

### EVM (Base/Hardhat)
```
1. User creates offer              (User Tx #1)
2. User pre-authorizes payment:
   - USDC: Approves allowance      (User Tx #2a)
   - ETH: Verifies balance
3. Backend approves offer           (Approver Tx)
4. Payment executes immediately     (User Tx #2 or #3)
```

**Why this order matters:**
- User commits to paying BEFORE approval happens
- Prevents approved-but-unpaid offers
- Approver knows payment is ready before approving
- If payment fails, clear error with retry path

**Contract constraint:** `fulfillOffer()` requires `approved == true`, so we can't pay before approval, but we CAN prepare payment first.

### Solana
```
1. User creates offer + escrowed payment  (Combined Tx #1)
2. Approver approves                      (Approver Tx)
3. Payment released automatically          (No additional user action)
```

## What’s inside
- `src/lib/agent.ts`: Eliza character, style, and negotiation examples (uses REPLY and CREATE_OTC_QUOTE)
- `src/lib/plugin-otc-desk`: Provider graph, quote logic, actions, and helpers
- `src/app/api/*`: HTTP endpoints for quotes, notifications, health checks, workers, etc.
- `contracts`: Hardhat EVM project with local OTC contracts and deploy scripts
- `solana`: Solana anchor project for Solana support
- `drizzle/*`: Schema and migrations (Drizzle ORM)

## Prerequisites
- Node.js 18+ or Bun (recommended for scripts: `bun run <script>`)
- pnpm (required by `contracts/`): `npm i -g pnpm`
- Solana CLI: `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
- Anchor CLI: `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.0 && avm use 0.31.0`
- Rust toolchain (Anchor expects nightly used in the program): `rustup toolchain install nightly-2025-04-14`
- Docker (optional; for local Postgres via `scripts/start-postgres.sh`)

## Quick start (local dev: EVM + Solana + Next.js)
```bash
git clone <your-repo-url>
cd eliza-nextjs-starter
bun install # or npm install

# (Optional) set Postgres URL or start local Postgres
# export POSTGRES_URL=postgres://eliza:password@localhost:5439/eliza
# ./scripts/start-postgres.sh

# Prepare database (Drizzle)
bun run db:push

# Start full local stack (Hardhat + Solana validator + program deploy + Next)
# This starts:
# - Hardhat node and deploys EVM OTC contracts
# - Solana local validator and deploys the Anchor OTC program
# - Next.js dev server on port 2222
bun run dev
```

Open the app at `http://localhost:2222`.

Notes:
- On first run, generate a Solana keypair for the Anchor program: `cd solana/otc-program && solana-keygen new -o id.json`.
- If `anchor deploy` fails, ensure Anchor CLI and Rust nightly are installed (see prerequisites).

## MetaMask Setup for Local Development

To connect MetaMask to your local Hardhat node:

### 1. Add Hardhat Network to MetaMask
1. Open MetaMask
2. Click the network dropdown (top-left)
3. Click "Add Network" → "Add a network manually"
4. Enter these details:
   - **Network Name:** `Hardhat Local`
   - **RPC URL:** `http://127.0.0.1:8545`
   - **Chain ID:** `31337`
   - **Currency Symbol:** `ETH`
5. Click "Save"

### 2. Import Test Account
When you run `bun run dev`, Hardhat will display test accounts in the terminal. Import the first account:

1. Copy the Private Key from the terminal output (look for "Account #0")
2. In MetaMask: Click account icon → "Import Account"
3. Paste the private key
4. This account has 10,000 ETH for testing

**Default Test Private Key:**
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### 3. Connect to the App
1. Refresh your browser at `http://localhost:2222`
2. Click "Connect" and select "Base" (EVM)
3. Choose your Hardhat Local network in MetaMask
4. Approve the connection

### Troubleshooting

**"Chain ID mismatch" or "Wrong network" errors:**
- Make sure you selected "Hardhat Local" (Chain ID 31337) in MetaMask
- Try disconnecting and reconnecting the wallet

**"Nonce too high" or transaction errors:**
```bash
# Reset MetaMask account:
# Settings → Advanced → Clear activity tab data
# Or restart Hardhat node:
bun run dev:cleanup
bun run dev
```

**Can't connect to Hardhat:**
```bash
# Check if Hardhat is running:
curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# Should return: {"jsonrpc":"2.0","id":1,"result":"0x7a69"}  (31337 in hex)
```

**View detailed setup instructions:**
```bash
./scripts/setup-metamask.sh
```

## Environment
Create `.env.local` and set only what you need. Common options:

```env
# App
NEXT_PUBLIC_NODE_ENV=development
NEXT_TELEMETRY_DISABLED=true

# Public URLs
NEXT_PUBLIC_APP_URL=http://localhost:2222
NEXT_PUBLIC_API_URL=http://localhost:2222

# Wallet / RPC
NEXT_PUBLIC_PROJECT_ID=demo-project-id              # WalletConnect/Wagmi project id (dev ok)
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545           # Hardhat RPC
NEXT_PUBLIC_OTC_ADDRESS=0x...                       # Filled by deploy scripts or API/devnet/ensure

# Solana Configuration
NEXT_PUBLIC_SOLANA_RPC=http://127.0.0.1:8899        # Solana validator RPC
NEXT_PUBLIC_SOLANA_PROGRAM_ID=EPqRoaDur9VtTKABWK3QQArV2wCYKoN3Zu8kErhrtUxp  # Your deployed program ID
NEXT_PUBLIC_SOLANA_DESK_OWNER=...                   # Wallet that owns the OTC desk (set after init)
NEXT_PUBLIC_SOLANA_TOKEN_MINT=...                   # SPL token mint address (set after creation)
NEXT_PUBLIC_SOLANA_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  # USDC mint (devnet default)

# Agent/LLM providers (as needed by your plugins)
GROQ_API_KEY=your-groq-api-key

# Database (optional; falls back to defaults if unset)
POSTGRES_URL=postgres://eliza:password@localhost:5439/eliza
POSTGRES_DEV_PORT=5439

# Internal worker/API secrets
API_SECRET_KEY=dev-admin-key                        # Authorizes admin API calls (prod required)
ADMIN_API_KEY=dev-admin-key
WORKER_AUTH_TOKEN=dev-worker-secret
QUOTE_SIGNATURE_SECRET=default-secret-key

# Approver wallet used by backend to fulfill/claim (Hardhat Account #0 for local dev)
APPROVER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Cron auth
CRON_SECRET=dev-cron-secret

# X (Twitter) OAuth (optional; enable sharing with media upload)
# Provide either OAuth 1.0a or OAuth 2.0 credentials (or both).
# Your backend must expose: /api/share/oauth/request_token, /api/share/oauth1/callback,
# /api/share/upload-media, /api/share/tweet, and /api/share/oauth/callback
X_CONSUMER_KEY=your-twitter-consumer-key            # aka TWITTER_CONSUMER_KEY
X_CONSUMER_SECRET=your-twitter-consumer-secret      # aka TWITTER_CONSUMER_SECRET
X_CLIENT_ID=your-twitter-client-id                  # OAuth 2.0
X_CLIENT_SECRET=your-twitter-client-secret          # OAuth 2.0
X_OAUTH_CALLBACK_URL=http://localhost:2222/callback
```

## How it works
1. You chat with the agent in the UI.
2. The agent replies concisely and, when appropriate, emits `CREATE_OTC_QUOTE`.
3. Quote providers compute a discount band from spot given lockup (1–52w).
4. The UI shows the quote; you can accept on-chain via the local OTC contract.
5. A background worker (`quoteApprovalWorker`) monitors and finalizes deal flow.

### Architecture (high level)
```
[Next.js UI] → [API Routes] → [Agent Runtime + OTC Plugin] → [Quote Providers]
      ↓                                                             ↑
  [Wallet/Wagmi] → [OTC Contract on Hardhat] ← [Worker + DB]
```

## Useful scripts
- `bun run dev`: Starts Hardhat + deploys contracts + starts Solana localnet + deploys program + Next.js dev
- `npm run rpc:start`: Start Hardhat node + auto-deploy Eliza OTC on localhost
- `npm run rpc:deploy`: Deploy OTC contracts to local chain
- `npm run db:push`: Apply Drizzle schema
- `npm run worker:start`: Start the quote approval worker
- `npm run test`: Unit tests (Vitest)
- `npm run cypress:run`: E2E tests

Solana:
- `npm run sol:validator`: Start local Solana validator (reset each run)
- `npm run sol:deploy`: Build and deploy Anchor program to the local validator
- `npm run sol:dev`: Combo: validator + deploy and keep running

Convenience: `./scripts/run-otc-desk.sh` starts the full local stack and prints URLs/logs.

## Testing
```bash
npm run test           # unit tests
npm run cypress:run    # E2E tests
```

### EVM testnet/mainnet
Add networks to `contracts/hardhat.config.ts` and set env for your target network:

```bash
export ETH_RPC_URL=https://sepolia.infura.io/v3/<key>   # or mainnet RPC
export DEPLOYER_PRIVATE_KEY=0x...
# (optional) for verification
export ETHERSCAN_API_KEY=...

cd contracts
pnpm hardhat ignition deploy ./ignition/modules/OTCDesk.ts --network sepolia # or mainnet
```

Then surface the deployed OTC address to the app:

```bash
export NEXT_PUBLIC_RPC_URL=$ETH_RPC_URL
export NEXT_PUBLIC_OTC_ADDRESS=0x...
```

### Solana devnet/mainnet
Configure Anchor for your cluster and deploy:

```bash
cd solana/otc-program
solana config set -u devnet   # or mainnet-beta
solana-keygen new -o id.json # or use an existing key
anchor build
anchor deploy                 # uses [provider] and [programs.*] from Anchor.toml
```

After deployment, initialize your OTC desk:

```bash
# The program ID from anchor deploy
export NEXT_PUBLIC_SOLANA_PROGRAM_ID=<your-program-id>

# Your wallet address that will own the desk
export NEXT_PUBLIC_SOLANA_DESK_OWNER=<your-wallet-pubkey>

# Create and set your token mint address
# (You can use an existing SPL token or create a new one)
export NEXT_PUBLIC_SOLANA_TOKEN_MINT=<token-mint-address>

# USDC mint (devnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
export NEXT_PUBLIC_SOLANA_USDC_MINT=<usdc-mint-address>

# Solana RPC endpoint
export NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
```

See `solana/otc-program/tests/otc.flows.ts` for examples of initializing a desk programmatically.

## Troubleshooting
- App builds but APIs fail: ensure local chain is running and contracts are deployed (`rpc:start`, `rpc:deploy`).
- DB errors: run `npm run db:push` and verify `POSTGRES_URL` or use the included Drizzle defaults.
- Quotes look off: confirm you’re using week-based lockups (1–52w) and discounts (not APR).
- Solana program failing to deploy: verify Anchor CLI is installed, correct Rust nightly is active, and `solana-test-validator` is running.
- X sharing: ensure `NEXT_PUBLIC_API_URL` points to your app origin and that the `/api/share/*` routes are implemented and configured with X credentials.

## Production
```bash
npm run build
npm start   # serves on port 2222 by default
```
Deploy to your platform of choice (Vercel, Netlify, etc.). Provide production env vars (DB, provider keys, etc.).

### Components deployed in production
- Next.js frontend (this app)
- EVM OTC contracts (per network)
- Solana OTC program (per cluster)
- Background worker (quote approval) with `WORKER_AUTH_TOKEN`
- Optional: X sharing backend routes with appropriate credentials

## Testing & Verification

### Quick Verification (1 second)
```bash
npm test
```
Runs 12 architecture tests verifying:
- ✅ NO MOCK FUNCTIONS (all blockchain interactions are real)
- ✅ EVM contract compiles and has all functions
- ✅ Solana program compiles with Pyth oracle
- ✅ Database services ready
- ✅ API endpoints functional
- ✅ Frontend uses real contract calls

### Full E2E Test (30 seconds)
```bash
# Terminal 1: Start Hardhat
cd contracts && npm run rpc:start

# Terminal 2: Deploy & Test
cd contracts
npm run deploy:eliza
npm run test:e2e
```

Tests complete OTC flow with REAL blockchain transactions:
- User creates offer → Contract deployed
- Agent approves → Transaction confirmed
- Backend approver fulfills → Real transfer verified
- Time advances → evm_increaseTime
- User claims tokens → Real tokens received

**Result:** ✅ All steps PASS with verified on-chain transactions

## Security Features

### EVM Contract
- ✅ **Multi-Approver Support** (1-10 configurable)
- ✅ **Oracle Fallback** (Chainlink + manual override)
- ✅ **ReentrancyGuard** on all state changes
- ✅ **Pausable** for emergencies
- ✅ **Emergency Refunds** (30-day window)
- ✅ **Price Staleness Checks** (max 1 hour)
- ✅ **Storage Cleanup** (prevents unbounded growth)

### Solana Program  
- ✅ **Pyth Oracle Integration** (trustless pricing)
- ✅ **Price Deviation Limits** (prevents manipulation)
- ✅ **PDA Validation** on all instructions
- ✅ **Multi-Approver Support** (up to 32)
- ✅ **Overflow Protection** (safe arithmetic)
- ✅ **Pausable State**

---

Built for agent-driven OTC deal flows with ElizaOS and a clean Next.js app.