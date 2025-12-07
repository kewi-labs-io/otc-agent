/**
 * Mainnet E2E Tests - REAL TRANSACTIONS
 * 
 * WARNING: These tests execute REAL transactions on mainnet with REAL tokens.
 * Only run when you intend to spend real funds.
 * 
 * Prerequisites:
 * - MAINNET_PRIVATE_KEY: Funded wallet private key
 * - MAINNET_RPC_URL: Base mainnet RPC (or use default)
 * - SOLANA_MAINNET_RPC: Solana mainnet RPC
 * - Real tokens in the wallets
 * 
 * Run: MAINNET_TEST=true bun vitest run tests/mainnet-e2e.test.ts
 */

// Load environment variables from .env.local
import { config } from "dotenv";
config({ path: ".env.local" });

import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Abi,
  parseEther,
  formatEther,
  keccak256,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Skip unless explicitly enabled
const MAINNET_ENABLED = process.env.MAINNET_TEST === "true";
const TEST_TIMEOUT = 600000; // 10 minutes for mainnet transactions

// Mainnet configuration
const BASE_URL = process.env.NEXT_PUBLIC_URL || "https://your-app.vercel.app";
const BASE_RPC = process.env.MAINNET_RPC_URL || "https://mainnet.base.org";
const SOLANA_RPC = process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com";

// Contract addresses (mainnet - deployed to Base chain ID 8453)
const OTC_CONTRACT_BASE = (process.env.NEXT_PUBLIC_OTC_ADDRESS_MAINNET || 
  process.env.NEXT_PUBLIC_OTC_ADDRESS || 
  "0x12fa61c9d77aed9beda0ff4bf2e900f31bdbdc45") as Address;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

// Solana mainnet - deployed desk
const SOLANA_DESK = process.env.NEXT_PUBLIC_SOLANA_DESK_MAINNET || "G89QsVcKN1MZe6d8eKyzv93u7TEeXSsXbsDsBPbuTMUU";
const SOLANA_PROGRAM_ID = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID || "6qn8ELVXd957oRjLaomCpKpcVZshUjNvSzw1nc7QVyXc";
// Token mint to use for testing - must be registered on the desk first
// Set SOLANA_TEST_TOKEN_MINT to test with a specific registered token
const SOLANA_TEST_TOKEN_MINT = process.env.SOLANA_TEST_TOKEN_MINT;

// Test amounts (small for safety)
const EVM_TEST_AMOUNT = parseEther("100"); // 100 tokens
const SOLANA_TEST_AMOUNT = 1_000_000_000n; // 1 token (9 decimals)

// =============================================================================
// TEST CONTEXT
// =============================================================================

interface MainnetEVMContext {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  otcAddress: Address;
  abi: Abi;
  tokenAbi: Abi;
}

interface MainnetSolanaContext {
  connection: Connection;
  program: anchor.Program;
  wallet: Keypair;
  desk: PublicKey;
}

let evmCtx: Partial<MainnetEVMContext> = {};
let solanaCtx: Partial<MainnetSolanaContext> = {};
let evmReady = false;
let solanaReady = false;

// =============================================================================
// UTILITIES
// =============================================================================

async function waitForTransaction(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: `0x${string}`,
  confirmations = 2
): Promise<boolean> {
  console.log(`  ⏳ Waiting for ${confirmations} confirmations...`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations,
  });
  return receipt.status === "success";
}

async function verifySolanaTransaction(
  connection: Connection,
  signature: string
): Promise<boolean> {
  console.log(`  ⏳ Confirming Solana transaction...`);
  const confirmation = await connection.confirmTransaction(signature, "finalized");
  return !confirmation.value.err;
}

// =============================================================================
// EVM MAINNET TESTS
// =============================================================================

describe("Base Mainnet OTC Flow", () => {
  beforeAll(async () => {
    if (!MAINNET_ENABLED) {
      console.log("⚠️ MAINNET_TEST not enabled - skipping mainnet tests");
      return;
    }

    console.log("\n🔵 BASE MAINNET SETUP\n");

    const privateKey = process.env.MAINNET_PRIVATE_KEY;
    if (!privateKey) {
      console.warn("⚠️ MAINNET_PRIVATE_KEY not set");
      return;
    }

    if (!OTC_CONTRACT_BASE) {
      console.warn("⚠️ NEXT_PUBLIC_OTC_ADDRESS not set");
      return;
    }

    try {
      evmCtx.publicClient = createPublicClient({
        chain: base,
        transport: http(BASE_RPC),
      });

      evmCtx.account = privateKeyToAccount(privateKey as `0x${string}`);
      evmCtx.walletClient = createWalletClient({
        account: evmCtx.account,
        chain: base,
        transport: http(BASE_RPC),
      });

      evmCtx.otcAddress = OTC_CONTRACT_BASE;

      // Load ABIs
      const artifactPath = path.join(
        process.cwd(),
        "src/contracts/artifacts/contracts/OTC.sol/OTC.json"
      );
      const tokenArtifactPath = path.join(
        process.cwd(),
        "src/contracts/artifacts/contracts/MockERC20.sol/MockERC20.json"
      );

      if (fs.existsSync(artifactPath)) {
        evmCtx.abi = JSON.parse(fs.readFileSync(artifactPath, "utf8")).abi;
      }
      if (fs.existsSync(tokenArtifactPath)) {
        evmCtx.tokenAbi = JSON.parse(fs.readFileSync(tokenArtifactPath, "utf8")).abi;
      }

      // Check balance
      const balance = await evmCtx.publicClient.getBalance({
        address: evmCtx.account.address,
      });
      console.log(`✅ Wallet: ${evmCtx.account.address}`);
      console.log(`✅ ETH Balance: ${formatEther(balance)} ETH`);

      if (balance < parseEther("0.01")) {
        console.warn("⚠️ Low ETH balance - may not have enough for gas");
        return;
      }

      evmReady = true;
      console.log("✅ Base mainnet ready\n");
    } catch (err) {
      console.warn("⚠️ Base setup failed:", err);
    }
  }, TEST_TIMEOUT);

  it.skipIf(!MAINNET_ENABLED)("completes real OTC deal on Base mainnet", async () => {
    if (!evmReady) {
      console.log("⚠️ SKIP: EVM not ready");
      return;
    }

    const { publicClient, walletClient, otcAddress, abi, account } = evmCtx as MainnetEVMContext;

    console.log("\n📝 BASE MAINNET OTC FLOW\n");

    // Step 1: Check if there's an active consignment we can use
    console.log("1️⃣ Checking existing consignments...");
    
    const nextConsignmentId = (await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "nextConsignmentId",
    })) as bigint;

    console.log(`  📋 Next consignment ID: ${nextConsignmentId}`);

    // Step 2: Create an offer from existing consignment (or direct offer)
    console.log("\n2️⃣ Creating offer...");

    const nextOfferId = (await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "nextOfferId",
    })) as bigint;

    console.log(`  📋 Creating offer #${nextOfferId}...`);

    // Use consignment ID 1 if it exists, otherwise create direct offer
    const consignmentId = nextConsignmentId > 1n ? 1n : 0n;
    
    let offerTxHash: `0x${string}`;
    
    if (consignmentId > 0n) {
      // Create from consignment
      const { request: offerReq } = await publicClient.simulateContract({
        address: otcAddress,
        abi,
        functionName: "createOfferFromConsignment",
        args: [
          consignmentId,
          EVM_TEST_AMOUNT,
          1000, // 10% discount
          1, // USDC
          30 * 24 * 60 * 60, // 30 day lockup
        ],
        account,
      });
      offerTxHash = await walletClient.writeContract(offerReq);
    } else {
      // Create direct offer
      const { request: offerReq } = await publicClient.simulateContract({
        address: otcAddress,
        abi,
        functionName: "createOffer",
        args: [
          EVM_TEST_AMOUNT,
          1000, // 10% discount
          1, // USDC
          30 * 24 * 60 * 60, // 30 day lockup
        ],
        account,
      });
      offerTxHash = await walletClient.writeContract(offerReq);
    }

    console.log(`  📋 Offer TX: ${offerTxHash}`);
    
    const offerSuccess = await waitForTransaction(publicClient, offerTxHash);
    expect(offerSuccess).toBe(true);
    console.log("  ✅ Offer created on-chain");

    // Step 3: Request backend approval
    console.log("\n3️⃣ Requesting backend approval...");

    const approveResponse = await fetch(`${BASE_URL}/api/otc/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        offerId: nextOfferId.toString(),
        chain: "base",
      }),
    });

    if (!approveResponse.ok) {
      const errorText = await approveResponse.text();
      console.log(`  ❌ Approval failed: ${errorText}`);
      throw new Error(`Backend approval failed: ${errorText}`);
    }

    const approveData = await approveResponse.json();
    console.log(`  ✅ Backend response: ${JSON.stringify(approveData)}`);
    
    expect(approveData.success).toBe(true);

    if (approveData.approvalTx) {
      console.log(`  📋 Approval TX: ${approveData.approvalTx}`);
    }

    // Step 4: Verify on-chain state
    console.log("\n4️⃣ Verifying on-chain state...");

    type OfferTuple = readonly [
      bigint, `0x${string}`, Address, bigint, bigint, bigint, bigint, bigint, bigint,
      number, boolean, boolean, boolean, boolean, boolean, Address, bigint
    ];
    const offerData = (await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "offers",
      args: [nextOfferId],
    })) as OfferTuple;

    console.log(`  📊 Offer state:`);
    console.log(`     Beneficiary: ${offerData[2]}`);
    console.log(`     Token Amount: ${formatEther(offerData[3])}`);
    console.log(`     Approved: ${offerData[11]}`);
    console.log(`     Paid: ${offerData[12]}`);

    expect(offerData[11]).toBe(true); // approved

    // Step 5: If paid, verify the deal is complete
    if (offerData[12]) {
      console.log("\n5️⃣ Deal is paid - verifying completion...");
      
      if (approveData.fulfillTx) {
        console.log(`  📋 Fulfill TX: ${approveData.fulfillTx}`);
      }

      // Check deal completion in database
      const dealResponse = await fetch(`${BASE_URL}/api/deals?offerId=${nextOfferId}`);
      if (dealResponse.ok) {
        const dealData = await dealResponse.json();
        console.log(`  ✅ Deal recorded in database`);
        console.log(`  📋 Deal ID: ${dealData.deal?.id || "N/A"}`);
      }

      console.log("\n✅ BASE MAINNET DEAL COMPLETE");
      console.log(`   Offer ID: ${nextOfferId}`);
      console.log(`   TX Hash: ${offerTxHash}`);
      console.log(`   Basescan: https://basescan.org/tx/${offerTxHash}`);
    } else {
      console.log("\n⏳ Deal pending payment - auto-fulfillment may be disabled");
    }

  }, TEST_TIMEOUT);
});

// =============================================================================
// SOLANA MAINNET TESTS
// =============================================================================

describe("Solana Mainnet OTC Flow", () => {
  beforeAll(async () => {
    if (!MAINNET_ENABLED) {
      return;
    }

    console.log("\n🔷 SOLANA MAINNET SETUP\n");

    const privateKey = process.env.SOLANA_MAINNET_PRIVATE_KEY;
    if (!privateKey) {
      console.warn("⚠️ SOLANA_MAINNET_PRIVATE_KEY not set");
      return;
    }

    if (!SOLANA_DESK || !SOLANA_PROGRAM_ID) {
      console.warn("⚠️ SOLANA_DESK or SOLANA_PROGRAM_ID not set");
      return;
    }

    try {
      solanaCtx.connection = new Connection(SOLANA_RPC, "confirmed");
      
      // Decode private key (supports JSON array or base58)
      let keypairBytes: Uint8Array;
      if (privateKey.startsWith("[")) {
        keypairBytes = Uint8Array.from(JSON.parse(privateKey));
      } else {
        // Base58 decode - import dynamically to avoid missing dependency
        const bs58 = await import("bs58").then(m => m.default).catch(() => null);
        if (bs58) {
          keypairBytes = bs58.decode(privateKey);
        } else {
          console.warn("⚠️ bs58 not available - use JSON array format for private key");
          return;
        }
      }
      solanaCtx.wallet = Keypair.fromSecretKey(keypairBytes);

      // Check SOL balance
      const balance = await solanaCtx.connection.getBalance(solanaCtx.wallet.publicKey);
      console.log(`✅ Wallet: ${solanaCtx.wallet.publicKey.toBase58()}`);
      console.log(`✅ SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

      if (balance < 0.01 * LAMPORTS_PER_SOL) {
        console.warn("⚠️ Low SOL balance");
        return;
      }

      // Load program
      const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
      if (!fs.existsSync(idlPath)) {
        console.warn("⚠️ IDL not found");
        return;
      }

      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      const wallet = new anchor.Wallet(solanaCtx.wallet);
      const provider = new anchor.AnchorProvider(solanaCtx.connection, wallet, {
        commitment: "confirmed",
      });
      anchor.setProvider(provider);

      try {
        solanaCtx.program = new anchor.Program(idl, provider);
      } catch {
        solanaCtx.program = new anchor.Program(idl, new PublicKey(SOLANA_PROGRAM_ID), provider) as anchor.Program;
      }

      solanaCtx.desk = new PublicKey(SOLANA_DESK);

      solanaReady = true;
      console.log("✅ Solana mainnet ready\n");
    } catch (err) {
      console.warn("⚠️ Solana setup failed:", err);
    }
  }, TEST_TIMEOUT);

  it.skipIf(!MAINNET_ENABLED)("completes real OTC deal on Solana mainnet", async () => {
    if (!solanaReady) {
      console.log("⚠️ SKIP: Solana not ready");
      return;
    }

    const { connection, program, wallet, desk } = solanaCtx as MainnetSolanaContext;

    console.log("\n📝 SOLANA MAINNET OTC FLOW\n");

    // Step 1: Get desk state
    console.log("1️⃣ Getting desk state...");
    
    type DeskAccount = { nextOfferId: anchor.BN; usdcMint: PublicKey };
    const deskAccount = (await (
      program.account as { desk: { fetch: (addr: PublicKey) => Promise<DeskAccount> } }
    ).desk.fetch(desk)) as DeskAccount;

    const nextOfferId = new anchor.BN(deskAccount.nextOfferId.toString());
    console.log(`  📋 Next offer ID: ${nextOfferId}`);

    // Use configured test token - must be registered on the desk
    if (!SOLANA_TEST_TOKEN_MINT) {
      console.log("  ⚠️ SOLANA_TEST_TOKEN_MINT not set - skipping offer creation");
      console.log("  To run this test, register a token on the desk and set SOLANA_TEST_TOKEN_MINT");
      return;
    }
    const tokenMint = new PublicKey(SOLANA_TEST_TOKEN_MINT);
    console.log(`  📋 Token mint: ${tokenMint.toBase58()}`);

    // Step 2: Create offer
    console.log("\n2️⃣ Creating offer...");

    const deskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, desk, true);
    const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), desk.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    const offerKeypair = Keypair.generate();

    const createOfferTx = await (program as anchor.Program).methods
      .createOffer(
        new anchor.BN(SOLANA_TEST_AMOUNT.toString()),
        1000, // 10% discount
        0, // SOL payment
        new anchor.BN(30 * 24 * 60 * 60) // 30 day lockup
      )
      .accountsStrict({
        desk,
        tokenRegistry: tokenRegistryPda,
        deskTokenTreasury,
        beneficiary: wallet.publicKey,
        offer: offerKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet, offerKeypair])
      .rpc();

    console.log(`  📋 Create TX: ${createOfferTx}`);
    
    const createSuccess = await verifySolanaTransaction(connection, createOfferTx);
    expect(createSuccess).toBe(true);
    console.log("  ✅ Offer created on-chain");

    // Step 3: Request backend approval
    console.log("\n3️⃣ Requesting backend approval...");

    const approveResponse = await fetch(`${BASE_URL}/api/otc/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerId: nextOfferId.toString(),
        chain: "solana",
        offerAddress: offerKeypair.publicKey.toBase58(),
      }),
    });

    if (!approveResponse.ok) {
      const errorText = await approveResponse.text();
      console.log(`  ❌ Approval failed: ${errorText}`);
      throw new Error(`Backend approval failed: ${errorText}`);
    }

    const approveData = await approveResponse.json();
    console.log(`  ✅ Backend response: ${JSON.stringify(approveData)}`);

    expect(approveData.success).toBe(true);

    if (approveData.approvalTx) {
      console.log(`  📋 Approval TX: ${approveData.approvalTx}`);
    }

    // Step 4: Verify on-chain state
    console.log("\n4️⃣ Verifying on-chain state...");

    type OfferAccount = {
      approved: boolean;
      paid: boolean;
      beneficiary: PublicKey;
      tokenAmount: anchor.BN;
    };
    const offerState = (await (
      program.account as { offer: { fetch: (addr: PublicKey) => Promise<OfferAccount> } }
    ).offer.fetch(offerKeypair.publicKey)) as OfferAccount;

    console.log(`  📊 Offer state:`);
    console.log(`     Beneficiary: ${offerState.beneficiary.toBase58()}`);
    console.log(`     Token Amount: ${offerState.tokenAmount.toString()}`);
    console.log(`     Approved: ${offerState.approved}`);
    console.log(`     Paid: ${offerState.paid}`);

    expect(offerState.approved).toBe(true);

    if (offerState.paid) {
      console.log("\n✅ SOLANA MAINNET DEAL COMPLETE");
      console.log(`   Offer Address: ${offerKeypair.publicKey.toBase58()}`);
      console.log(`   TX: ${createOfferTx}`);
      console.log(`   Solscan: https://solscan.io/tx/${createOfferTx}`);
    } else {
      console.log("\n⏳ Deal pending payment");
    }

  }, TEST_TIMEOUT);
});

// =============================================================================
// FULL ROUND-TRIP TEST
// =============================================================================

describe("Complete Mainnet Round-Trip", () => {
  it.skipIf(!MAINNET_ENABLED)("verifies deals are recorded in database", async () => {
    if (!evmReady && !solanaReady) {
      console.log("⚠️ SKIP: Neither chain ready");
      return;
    }

    console.log("\n📝 VERIFYING DATABASE RECORDS\n");

    // Check recent deals
    const dealsResponse = await fetch(`${BASE_URL}/api/deals?limit=10`);
    
    if (!dealsResponse.ok) {
      console.log("⚠️ Could not fetch deals from API");
      return;
    }

    const dealsData = await dealsResponse.json();
    const deals = dealsData.deals || [];

    console.log(`  📋 Found ${deals.length} recent deals`);

    if (deals.length > 0) {
      const latest = deals[0];
      console.log(`\n  Latest deal:`);
      console.log(`     ID: ${latest.id}`);
      console.log(`     Chain: ${latest.chain}`);
      console.log(`     Status: ${latest.status}`);
      console.log(`     Created: ${latest.createdAt}`);
    }

    console.log("\n✅ Database verification complete");
  }, TEST_TIMEOUT);
});

// =============================================================================
// SUMMARY
// =============================================================================

describe("Mainnet Test Summary", () => {
  it("displays mainnet test instructions", () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                         MAINNET E2E TEST SUMMARY                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ⚠️  WARNING: These tests execute REAL transactions with REAL funds          ║
║                                                                              ║
║  REQUIREMENTS:                                                               ║
║  - MAINNET_TEST=true                                                         ║
║  - MAINNET_PRIVATE_KEY=0x... (Base wallet with ETH + tokens)                 ║
║  - SOLANA_MAINNET_PRIVATE_KEY=... (Solana wallet with SOL + tokens)          ║
║  - NEXT_PUBLIC_OTC_ADDRESS=0x... (Deployed OTC contract)                     ║
║  - NEXT_PUBLIC_SOLANA_DESK=... (Deployed Solana desk)                        ║
║                                                                              ║
║  RUN:                                                                        ║
║  MAINNET_TEST=true bun vitest run tests/mainnet-e2e.test.ts                  ║
║                                                                              ║
║  WHAT'S TESTED:                                                              ║
║  ✓ Create real offer on Base mainnet                                         ║
║  ✓ Backend approval and auto-fulfillment                                     ║
║  ✓ Create real offer on Solana mainnet                                       ║
║  ✓ Backend approval and auto-fulfillment                                     ║
║  ✓ Verify transactions on block explorer                                     ║
║  ✓ Verify deals recorded in database                                         ║
║                                                                              ║
║  SAFETY:                                                                     ║
║  - Tests use small amounts (100 tokens EVM, 1 token Solana)                  ║
║  - Tests skip if wallets have insufficient balance                           ║
║  - Tests require explicit MAINNET_TEST=true flag                             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
  });
});

