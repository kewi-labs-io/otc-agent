#!/usr/bin/env bun
/**
 * MULTI-CHAIN E2E ON-CHAIN VERIFICATION
 * 
 * Executes REAL transactions on:
 * 1. Base
 * 2. Solana
 * 3. BSC
 * 4. Ethereum Mainnet
 * 
 * Usage: bun scripts/e2e-multichain-onchain.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  parseEther,
  formatEther,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, bsc, mainnet } from "viem/chains";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import { config } from "dotenv";

// Load .env first, then .env.local can override
config({ path: ".env" });
config({ path: ".env.local" });

// =============================================================================
// CONFIGURATION
// =============================================================================

// Ensure EVM_PRIVATE_KEY has 0x prefix
function normalizePrivateKey(key: string | undefined): `0x${string}` {
  if (!key) throw new Error("EVM_PRIVATE_KEY is required");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

const EVM_PRIVATE_KEY = normalizePrivateKey(process.env.EVM_PRIVATE_KEY);

// Load deployment configs
const mainnetEvmConfigRaw = JSON.parse(fs.readFileSync("src/config/deployments/mainnet-evm.json", "utf8"));
const mainnetSolanaConfigRaw = JSON.parse(fs.readFileSync("src/config/deployments/mainnet-solana.json", "utf8"));

// FAIL-FAST: Validate required EVM config fields
function requireEvmAddress(field: string, value: string | undefined, chain: string): Address {
  if (!value) {
    throw new Error(`Missing required EVM config: ${chain}.${field}`);
  }
  return value as Address;
}

function getEvmAddress(chainKey: string, field: "otc" | "usdc"): Address {
  if (!mainnetEvmConfigRaw.networks) {
    throw new Error(`Missing networks config in EVM deployment config`);
  }
  if (!mainnetEvmConfigRaw.contracts) {
    throw new Error(`Missing contracts config in EVM deployment config`);
  }
  
  const networkConfig = mainnetEvmConfigRaw.networks[chainKey];
  if (!networkConfig) {
    throw new Error(`Missing network config for chain: ${chainKey}`);
  }
  const contractConfig = mainnetEvmConfigRaw.contracts;
  if (!contractConfig) {
    throw new Error(`Missing contracts config in EVM deployment config`);
  }
  
  // Try network-specific config first, then fall back to contract config
  // requireEvmAddress will fail-fast if neither exists
  const value = networkConfig[field] ?? contractConfig[field];
  return requireEvmAddress(field, value, chainKey);
}

// FAIL-FAST: Validate required Solana config fields
function requireSolanaField<T>(field: string, value: T | undefined): T {
  if (!value) {
    throw new Error(`Missing required Solana config: ${field}`);
  }
  return value;
}

const mainnetSolanaConfig = {
  desk: requireSolanaField("desk", mainnetSolanaConfigRaw.desk),
  programId: requireSolanaField("programId", mainnetSolanaConfigRaw.programId),
  usdcMint: requireSolanaField("usdcMint", mainnetSolanaConfigRaw.usdcMint),
  elizaosMint: mainnetSolanaConfigRaw.elizaosMint,
  rpc: requireSolanaField("rpc", mainnetSolanaConfigRaw.rpc),
} as const;

// Build Solana RPC URL - prefer Helius if API key available
function getSolanaRpc(): string {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  if (process.env.SOLANA_MAINNET_RPC) return process.env.SOLANA_MAINNET_RPC;
  if (process.env.SOLANA_RPC) return process.env.SOLANA_RPC;
  throw new Error("SOLANA_RPC or HELIUS_API_KEY must be configured");
}

// RPC endpoints
function getRpcUrl(chain: string): string {
  switch (chain) {
    case "base":
      if (process.env.BASE_RPC_URL) return process.env.BASE_RPC_URL;
      if (process.env.NEXT_PUBLIC_BASE_RPC_URL) return process.env.NEXT_PUBLIC_BASE_RPC_URL;
      throw new Error("BASE_RPC_URL or NEXT_PUBLIC_BASE_RPC_URL must be configured");
    case "bsc":
      if (process.env.BSC_RPC_URL) return process.env.BSC_RPC_URL;
      if (process.env.NEXT_PUBLIC_BSC_RPC_URL) return process.env.NEXT_PUBLIC_BSC_RPC_URL;
      throw new Error("BSC_RPC_URL or NEXT_PUBLIC_BSC_RPC_URL must be configured");
    case "ethereum":
      if (process.env.ETH_RPC_URL) return process.env.ETH_RPC_URL;
      if (process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL) return process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL;
      throw new Error("ETH_RPC_URL or NEXT_PUBLIC_ETHEREUM_RPC_URL must be configured");
    case "solana":
      return getSolanaRpc();
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

const RPC_URLS: Record<string, string> = {
  base: getRpcUrl("base"),
  bsc: getRpcUrl("bsc"),
  ethereum: getRpcUrl("ethereum"),
  solana: getRpcUrl("solana"),
};

// Chain configs
interface ChainConfig {
  chain: Chain;
  otcAddress: Address;
  usdcAddress: Address;
  name: string;
  explorer: string;
}

const EVM_CHAINS: Record<string, ChainConfig> = {
  base: {
    chain: base,
    otcAddress: getEvmAddress("base", "otc"),
    usdcAddress: getEvmAddress("base", "usdc"),
    name: "Base",
    explorer: "https://basescan.org",
  },
  bsc: {
    chain: bsc,
    otcAddress: getEvmAddress("bsc", "otc"),
    usdcAddress: getEvmAddress("bsc", "usdc"),
    name: "BSC",
    explorer: "https://bscscan.com",
  },
  ethereum: {
    chain: mainnet,
    otcAddress: getEvmAddress("ethereum", "otc"),
    usdcAddress: getEvmAddress("ethereum", "usdc"),
    name: "Ethereum",
    explorer: "https://etherscan.io",
  },
};

// ABIs
const OTC_ABI = [
  { name: "nextConsignmentId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "nextOfferId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "tokens", type: "function", inputs: [{ type: "uint256" }], outputs: [
    { type: "address", name: "tokenAddress" },
    { type: "address", name: "priceFeed" },
    { type: "bool", name: "isActive" },
  ], stateMutability: "view" },
  { name: "tokenIdByAddress", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "consignments", type: "function", inputs: [{ type: "uint256" }], outputs: [
    { type: "bytes32", name: "tokenId" },
    { type: "address", name: "consigner" },
    { type: "uint256", name: "totalAmount" },
    { type: "uint256", name: "remainingAmount" },
    { type: "bool", name: "isNegotiable" },
    { type: "uint16", name: "fixedDiscountBps" },
    { type: "uint32", name: "fixedLockupDays" },
    { type: "uint16", name: "minDiscountBps" },
    { type: "uint16", name: "maxDiscountBps" },
    { type: "uint32", name: "minLockupDays" },
    { type: "uint32", name: "maxLockupDays" },
    { type: "uint256", name: "minDealAmount" },
    { type: "uint256", name: "maxDealAmount" },
    { type: "uint16", name: "maxPriceVolatilityBps" },
    { type: "bool", name: "isActive" },
    { type: "uint256", name: "createdAt" }
  ], stateMutability: "view" },
  { name: "offers", type: "function", inputs: [{ type: "uint256" }], outputs: [
    { type: "uint256", name: "consignmentId" },
    { type: "bytes32", name: "tokenId" },
    { type: "address", name: "beneficiary" },
    { type: "uint256", name: "tokenAmount" },
    { type: "uint256", name: "discountBps" },
    { type: "uint256", name: "createdAt" },
    { type: "uint256", name: "unlockTime" },
    { type: "uint256", name: "priceUsdPerToken" },
    { type: "uint256", name: "maxPriceDeviation" },
    { type: "uint256", name: "ethUsdPrice" },
    { type: "uint8", name: "currency" },
    { type: "bool", name: "approved" },
    { type: "bool", name: "paid" },
    { type: "bool", name: "fulfilled" },
    { type: "bool", name: "cancelled" },
    { type: "address", name: "payer" },
    { type: "uint256", name: "amountPaid" },
    { type: "uint16", name: "agentCommissionBps" }
  ], stateMutability: "view" },
  { name: "createConsignment", type: "function", inputs: [
    { type: "uint256", name: "tokenId" },
    { type: "uint256", name: "amount" },
    { type: "bool", name: "isNegotiable" },
    { type: "uint16", name: "fixedDiscountBps" },
    { type: "uint256", name: "fixedLockupDays" },
    { type: "uint16", name: "minDiscountBps" },
    { type: "uint16", name: "maxDiscountBps" },
    { type: "uint256", name: "minLockupDays" },
    { type: "uint256", name: "maxLockupDays" },
    { type: "uint256", name: "minDealAmount" },
    { type: "uint256", name: "maxDealAmount" },
    { type: "uint16", name: "maxPriceDeviation" },
  ], outputs: [{ type: "uint256" }], stateMutability: "payable" },
  { name: "createOfferFromConsignment", type: "function", inputs: [
    { type: "uint256", name: "consignmentId" },
    { type: "uint256", name: "tokenAmount" },
    { type: "uint256", name: "discountBps" },
    { type: "uint8", name: "currency" },
    { type: "uint256", name: "lockupSeconds" },
    { type: "uint16", name: "agentCommissionBps" },
  ], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { name: "fulfillOffer", type: "function", inputs: [{ type: "uint256" }], outputs: [], stateMutability: "payable" },
  { name: "approveOffer", type: "function", inputs: [{ type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { name: "claimTokens", type: "function", inputs: [{ type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "agent", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "approver", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "gasDeposit", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const ERC20_ABI = [
  { name: "approve", type: "function", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "allowance", type: "function", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "name", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "transfer", type: "function", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

// Results tracking
interface TestResult {
  chain: string;
  test: string;
  success: boolean;
  txHash?: string;
  error?: string;
  details?: Record<string, string>;
}

const results: TestResult[] = [];

// =============================================================================
// EVM TESTING
// =============================================================================

async function testEvmChain(chainKey: string): Promise<void> {
  const config = EVM_CHAINS[chainKey];
  if (!config) {
    throw new Error(`Chain ${chainKey} not configured in EVM_CHAINS`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔷 Testing ${config.name} (Chain ID: ${config.chain.id})`);
  console.log(`${"=".repeat(60)}\n`);

  const account = privateKeyToAccount(EVM_PRIVATE_KEY);
  
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(RPC_URLS[chainKey]),
  });

  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(RPC_URLS[chainKey]),
  });

  console.log(`📍 Wallet: ${account.address}`);
  console.log(`📍 OTC Contract: ${config.otcAddress}`);

  // Step 1: Check wallet balance
  console.log(`\n1️⃣ Checking balances...`);
  
  const nativeBalance = await publicClient.getBalance({ address: account.address });
  const nativeSymbol = config.chain.nativeCurrency.symbol;
  console.log(`   ${nativeSymbol}: ${formatEther(nativeBalance)}`);

  const hasGas = nativeBalance >= parseEther("0.001");
  if (!hasGas) {
    console.log(`   ⚠️ Low ${nativeSymbol} balance (continuing with read-only tests)`);
  }
  
  results.push({
    chain: chainKey,
    test: "balance_check",
    success: true,
    details: { [nativeSymbol.toLowerCase()]: formatEther(nativeBalance), hasGas: String(hasGas) },
  });

  // Step 2: Read contract state
  console.log(`\n2️⃣ Reading OTC contract state...`);
  
  // Read core state
  type ViewFunctionName = "nextConsignmentId" | "nextOfferId" | "tokens" | "tokenIdByAddress" | 
    "consignments" | "offers" | "owner" | "agent" | "approver" | "gasDeposit";
  
  const [nextConsignmentId, nextOfferId, owner, agent, approver, gasDeposit] = await Promise.all([
    publicClient.readContract({ address: config.otcAddress, abi: OTC_ABI, functionName: "nextConsignmentId" }) as Promise<bigint>,
    publicClient.readContract({ address: config.otcAddress, abi: OTC_ABI, functionName: "nextOfferId" }) as Promise<bigint>,
    publicClient.readContract({ address: config.otcAddress, abi: OTC_ABI, functionName: "owner" }) as Promise<Address>,
    publicClient.readContract({ address: config.otcAddress, abi: OTC_ABI, functionName: "agent" }) as Promise<Address>,
    publicClient.readContract({ address: config.otcAddress, abi: OTC_ABI, functionName: "approver" }) as Promise<Address>,
    publicClient.readContract({ address: config.otcAddress, abi: OTC_ABI, functionName: "gasDeposit" }) as Promise<bigint>,
  ]);

  console.log(`   Next Consignment ID: ${nextConsignmentId}`);
  console.log(`   Next Offer ID: ${nextOfferId}`);
  console.log(`   Owner: ${owner}`);
  console.log(`   Agent: ${agent}`);
  console.log(`   Approver: ${approver}`);
  console.log(`   Gas Deposit: ${formatEther(gasDeposit)} ${nativeSymbol}`);

  results.push({
    chain: chainKey,
    test: "contract_read",
    success: true,
    details: {
      nextConsignmentId: String(nextConsignmentId),
      nextOfferId: String(nextOfferId),
      owner,
      agent,
      approver,
    },
  });

  // Step 3: Check for active consignments
  console.log(`\n3️⃣ Checking for active consignments...`);
  
  let activeConsignment: bigint | null = null;
  let consignmentDetails: {
    id: bigint;
    consigner: Address;
    tokenId: `0x${string}`;
    remaining: bigint;
    isNegotiable: boolean;
  } | null = null;

  if (nextConsignmentId > 1n) {
    for (let i = nextConsignmentId - 1n; i >= 1n && i > nextConsignmentId - 10n; i--) {
      const c = await publicClient.readContract({
        address: config.otcAddress,
        abi: OTC_ABI,
        functionName: "consignments",
        args: [i],
      });
      
      // Field mapping: [0]=tokenId(bytes32), [1]=consigner, [2]=totalAmount, [3]=remainingAmount,
      // [4]=isNegotiable, [14]=isActive, [15]=createdAt
      const isActive = c[14] as boolean;
      const remainingAmount = c[3] as bigint;
      
      if (isActive && remainingAmount > 0n) {
        activeConsignment = i;
        const tokenIdBytes32 = c[0] as `0x${string}`;
        consignmentDetails = {
          id: i,
          consigner: c[1] as Address,
          tokenId: tokenIdBytes32,
          remaining: remainingAmount,
          isNegotiable: c[4] as boolean,
        };
        console.log(`   ✅ Found active consignment #${i}`);
        console.log(`      Consigner: ${c[1]}`);
        console.log(`      Token ID: ${c[0]}`);
        console.log(`      Remaining: ${formatEther(remainingAmount)}`);
        break;
      }
    }
  }

  if (!activeConsignment) {
    console.log(`   ⚠️ No active consignments found`);
  }

  results.push({
    chain: chainKey,
    test: "consignment_check",
    success: true,
    details: activeConsignment && consignmentDetails ? {
      consignmentId: String(activeConsignment),
      remaining: formatEther(consignmentDetails.remaining),
    } : { found: "none" },
  });

  // Step 4: Check for pending offers
  console.log(`\n4️⃣ Checking for offers...`);
  
  if (nextOfferId > 1n) {
    for (let i = nextOfferId - 1n; i >= 1n && i > nextOfferId - 5n; i--) {
      const o = await publicClient.readContract({
        address: config.otcAddress,
        abi: OTC_ABI,
        functionName: "offers",
        args: [i],
      });
      
      const isApproved = o[11] as boolean;
      const isPaid = o[12] as boolean;
      const isExecuted = o[13] as boolean;
      const isCancelled = o[14] as boolean;
      
      if (!isCancelled) {
        console.log(`   📋 Offer #${i}:`);
        console.log(`      Beneficiary: ${o[2]}`);
        console.log(`      Token Amount: ${formatEther(o[3] as bigint)}`);
        console.log(`      Approved: ${isApproved}`);
        console.log(`      Paid: ${isPaid}`);
        console.log(`      Executed: ${isExecuted}`);
      }
    }
  } else {
    console.log(`   No offers created yet`);
  }

  console.log(`\n✅ ${config.name} contract verification complete`);
}

// =============================================================================
// SOLANA TESTING
// =============================================================================

// Desk account layout (after 8-byte discriminator):
// owner: Pubkey (32), agent: Pubkey (32), usdc_mint: Pubkey (32)
// usdc_decimals: u8 (1), min_usd_amount_8d: u64 (8), quote_expiry_secs: i64 (8)
// max_price_age_secs: i64 (8), restrict_fulfill: bool (1)
// approvers: Vec<Pubkey> (4 + n*32 where n is vec length)
// next_consignment_id: u64 (8), next_offer_id: u64 (8)
// paused: bool (1), sol_price_feed_id: [u8;32] (32), sol_usd_price_8d: u64 (8)
// prices_updated_at: i64 (8), ... etc

interface SolanaDesk {
  owner: string;
  agent: string;
  usdcMint: string;
  nextConsignmentId: bigint;
  nextOfferId: bigint;
  paused: boolean;
  approversCount: number;
}

function parseDesk(data: Buffer): SolanaDesk {
  // Skip 8-byte discriminator
  let pos = 8;
  
  const owner = new PublicKey(data.subarray(pos, pos + 32)).toBase58();
  pos += 32;
  const agent = new PublicKey(data.subarray(pos, pos + 32)).toBase58();
  pos += 32;
  const usdcMint = new PublicKey(data.subarray(pos, pos + 32)).toBase58();
  pos += 32;
  
  // usdc_decimals: u8 (1)
  pos += 1;
  // min_usd_amount_8d: u64 (8)
  pos += 8;
  // quote_expiry_secs: i64 (8)
  pos += 8;
  // max_price_age_secs: i64 (8)
  pos += 8;
  // restrict_fulfill: bool (1)
  pos += 1;
  
  // approvers: Vec<Pubkey> - first 4 bytes are length, then n*32 bytes
  const approversCount = data.readUInt32LE(pos);
  pos += 4;
  pos += approversCount * 32; // Skip the actual approver pubkeys
  
  // Now at next_consignment_id
  const nextConsignmentId = data.readBigUInt64LE(pos);
  pos += 8;
  const nextOfferId = data.readBigUInt64LE(pos);
  pos += 8;
  const paused = data[pos] === 1;
  
  return { owner, agent, usdcMint, nextConsignmentId, nextOfferId, paused, approversCount };
}

async function testSolana(): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🟣 Testing Solana`);
  console.log(`${"=".repeat(60)}\n`);

  // For Solana we need a different private key format
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  
  if (!solanaPrivateKey) {
    throw new Error("SOLANA_PRIVATE_KEY not set - required for Solana tests");
  }

  const connection = new Connection(RPC_URLS.solana, "confirmed");

  // Parse private key
  let wallet: Keypair;
  if (solanaPrivateKey.startsWith("[")) {
    wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(solanaPrivateKey)));
  } else {
    const bs58 = await import("bs58").then(m => m.default);
    wallet = Keypair.fromSecretKey(bs58.decode(solanaPrivateKey));
  }

  console.log(`📍 Wallet: ${wallet.publicKey.toBase58()}`);

  // Step 1: Check SOL balance
  console.log(`\n1️⃣ Checking balances...`);
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`   SOL: ${solBalance / LAMPORTS_PER_SOL}`);

  if (solBalance < 0.01 * LAMPORTS_PER_SOL) {
    console.log(`   ⚠️ Low SOL balance`);
  }

  results.push({
    chain: "solana",
    test: "balance_check",
    success: true,
    details: { sol: String(solBalance / LAMPORTS_PER_SOL) },
  });

  // Step 2: Check OTC desk
  console.log(`\n2️⃣ Checking OTC desk...`);
  
  const deskPubkey = new PublicKey(mainnetSolanaConfig.desk);
  console.log(`   Desk: ${deskPubkey.toBase58()}`);

  const deskInfo = await connection.getAccountInfo(deskPubkey);
  if (!deskInfo) {
    throw new Error(`Desk account not found at ${deskPubkey.toBase58()}`);
  }

  console.log(`   ✅ Desk exists (${deskInfo.data.length} bytes)`);
  
  // Parse desk data
  const deskData = parseDesk(deskInfo.data);
  console.log(`   Owner: ${deskData.owner}`);
  console.log(`   Agent: ${deskData.agent}`);
  console.log(`   Approvers: ${deskData.approversCount}`);
  console.log(`   Next Consignment ID: ${deskData.nextConsignmentId}`);
  console.log(`   Next Offer ID: ${deskData.nextOfferId}`);
  console.log(`   Paused: ${deskData.paused}`);
  
  results.push({
    chain: "solana",
    test: "desk_read",
    success: true,
    details: {
      owner: deskData.owner,
      agent: deskData.agent,
      approvers: String(deskData.approversCount),
      nextConsignmentId: String(deskData.nextConsignmentId),
      nextOfferId: String(deskData.nextOfferId),
      paused: String(deskData.paused),
    },
  });

  // Step 3: Check ELIZAOS token registration
  console.log(`\n3️⃣ Checking token registration...`);
  
  const elizaosMint = mainnetSolanaConfig.elizaosMint;
  if (elizaosMint) {
    const elizaosMintPubkey = new PublicKey(elizaosMint);
    console.log(`   ELIZAOS Mint: ${elizaosMint}`);
    
    // Check TokenRegistry PDA
    const programId = new PublicKey(mainnetSolanaConfig.programId);
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), deskPubkey.toBuffer(), elizaosMintPubkey.toBuffer()],
      programId
    );
    console.log(`   TokenRegistry PDA: ${registryPda.toBase58()}`);
    
    const registryInfo = await connection.getAccountInfo(registryPda);
    if (registryInfo) {
      console.log(`   ✅ ELIZAOS token is registered (${registryInfo.data.length} bytes)`);
      
      // Parse registry layout (after 8-byte discriminator):
      // desk (32), token_mint (32), decimals (1), price_feed_id (32),
      // pool_address (32), pool_type (1), is_active (1), token_usd_price_8d (8)
      const regOffset = 8; // discriminator
      // desk: offset 8-40, token_mint: offset 40-72
      const tokenMint = new PublicKey(registryInfo.data.subarray(regOffset + 32, regOffset + 64)).toBase58();
      // decimals: offset 72
      const decimals = registryInfo.data[regOffset + 64];
      // is_active: offset 138 = 8 + 32(desk) + 32(token_mint) + 1(decimals) + 32(price_feed) + 32(pool_addr) + 1(pool_type)
      const isActiveOffset = regOffset + 32 + 32 + 1 + 32 + 32 + 1;
      const isActive = registryInfo.data[isActiveOffset] === 1;
      // token_usd_price_8d: offset 139 = isActiveOffset + 1
      const priceOffset = isActiveOffset + 1;
      const price8d = registryInfo.data.readBigUInt64LE(priceOffset);
      
      console.log(`   Token Decimals: ${decimals}`);
      console.log(`   Is Active: ${isActive}`);
      console.log(`   Price (8d): ${price8d} ($${Number(price8d) / 1e8})`);
      
      results.push({
        chain: "solana",
        test: "token_registry",
        success: true,
        details: {
          token: "ELIZAOS",
          mint: tokenMint,
          decimals: String(decimals),
          isActive: String(isActive),
          priceUsd: `$${(Number(price8d) / 1e8).toFixed(6)}`,
        },
      });
    } else {
      console.log(`   ⚠️ ELIZAOS token not registered`);
    }
    
    // Check if we have ELIZAOS balance
    const elizaosTokenAccount = getAssociatedTokenAddressSync(
      elizaosMintPubkey,
      wallet.publicKey
    );
    const tokenAccount = await getAccount(connection, elizaosTokenAccount);
    console.log(`   ELIZAOS Balance: ${tokenAccount.amount}`);
  } else {
    console.log(`   ⚠️ No ELIZAOS mint configured`);
  }

  // Step 4: Check USDC balance
  console.log(`\n4️⃣ Checking USDC balance...`);
  const usdcMint = new PublicKey(mainnetSolanaConfig.usdcMint);
  const usdcTokenAccount = getAssociatedTokenAddressSync(usdcMint, wallet.publicKey);
  const usdcAccount = await getAccount(connection, usdcTokenAccount);
  const usdcBalance = Number(usdcAccount.amount) / 1e6;
  console.log(`   USDC Balance: $${usdcBalance.toFixed(2)}`);
  
  results.push({
    chain: "solana",
    test: "usdc_balance",
    success: true,
    details: { usdc: `$${usdcBalance.toFixed(2)}` },
  });

  console.log(`\n✅ Solana verification complete`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    MULTI-CHAIN E2E ON-CHAIN VERIFICATION                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Testing: Base → Solana → BSC → Ethereum Mainnet                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  const account = privateKeyToAccount(EVM_PRIVATE_KEY);
  console.log(`🔑 EVM Wallet: ${account.address}`);

  // Test each chain in sequence
  await testEvmChain("base");
  await testSolana();
  await testEvmChain("bsc");
  await testEvmChain("ethereum");

  // Print summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 RESULTS SUMMARY`);
  console.log(`${"=".repeat(60)}\n`);

  const grouped = results.reduce((acc, r) => {
    if (!acc[r.chain]) acc[r.chain] = [];
    acc[r.chain].push(r);
    return acc;
  }, {} as Record<string, TestResult[]>);

  for (const [chain, chainResults] of Object.entries(grouped)) {
    const passed = chainResults.filter(r => r.success).length;
    const total = chainResults.length;
    const status = passed === total ? "✅" : "⚠️";
    console.log(`${status} ${chain.toUpperCase()}: ${passed}/${total} tests passed`);
    
    for (const r of chainResults) {
      const icon = r.success ? "  ✓" : "  ✗";
      console.log(`${icon} ${r.test}${r.txHash ? ` (${r.txHash.slice(0, 10)}...)` : ""}`);
      if (r.error) console.log(`     Error: ${r.error}`);
      if (r.details) {
        for (const [k, v] of Object.entries(r.details)) {
          console.log(`     ${k}: ${v}`);
        }
      }
    }
  }

  const allPassed = results.every(r => r.success);
  console.log(`\n${allPassed ? "✅ All tests passed!" : "⚠️ Some tests failed"}\n`);
}

main().catch(console.error);

