#!/usr/bin/env bun
/**
 * Solana OTC Desk Admin CLI
 *
 * Consolidated admin utilities for managing the Solana OTC desk.
 *
 * Usage:
 *   bun scripts/solana-admin.ts <command> [options]
 *
 * Commands:
 *   create-treasury <TOKEN_MINT>           Create desk token treasury (ATA)
 *   register-token <TOKEN_MINT> [PRICE]    Register token on desk with optional price
 *   set-price <TOKEN_MINT> <PRICE_USD>     Set manual token price
 *   status                                 Show desk status and registered tokens
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getSolanaConfig } from "../src/config/contracts";
import { getAppUrl } from "../src/config/env";

const solanaDeployment = getSolanaConfig("mainnet");

let SOLANA_RPC: string;
if (process.env.SOLANA_MAINNET_RPC) {
  SOLANA_RPC = process.env.SOLANA_MAINNET_RPC;
} else if (solanaDeployment.rpc.startsWith("/")) {
  SOLANA_RPC = `${getAppUrl()}${solanaDeployment.rpc}`;
} else if (solanaDeployment.rpc) {
  SOLANA_RPC = solanaDeployment.rpc;
} else {
  throw new Error(
    "SOLANA_MAINNET_RPC environment variable or solanaDeployment.rpc config is required",
  );
}

const programIdStr = process.env.SOLANA_PROGRAM_ID || solanaDeployment.programId;
if (!programIdStr) {
  throw new Error(
    "SOLANA_PROGRAM_ID environment variable or solanaDeployment.programId config is required",
  );
}
const PROGRAM_ID = new PublicKey(programIdStr);

const deskStr = process.env.SOLANA_DESK || solanaDeployment.desk;
if (!deskStr) {
  throw new Error("SOLANA_DESK environment variable or solanaDeployment.desk config is required");
}
const DESK = new PublicKey(deskStr);

const POOL_TYPE_NONE = 0;
const EMPTY_PYTH_FEED = Buffer.alloc(32, 0);

async function getConnection(): Promise<Connection> {
  return new Connection(SOLANA_RPC, "confirmed");
}

async function getWallet(): Promise<Keypair> {
  const privateKeyStr = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (!privateKeyStr) {
    throw new Error("SOLANA_MAINNET_PRIVATE_KEY not set in environment");
  }

  const secretKey = bs58.decode(privateKeyStr);
  return Keypair.fromSecretKey(secretKey);
}

async function getProgram(connection: Connection, wallet: Keypair): Promise<anchor.Program> {
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  return new anchor.Program(idl, provider);
}

// =============================================================================
// COMMANDS
// =============================================================================

async function createTreasury(tokenMintStr: string): Promise<void> {
  console.log("=== CREATE DESK TOKEN TREASURY ===\n");

  const tokenMint = new PublicKey(tokenMintStr);
  const connection = await getConnection();
  const wallet = await getWallet();

  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Desk:", DESK.toBase58());
  console.log("Wallet:", wallet.publicKey.toBase58());

  // Derive the desk's ATA for the token
  const deskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, DESK, true);
  console.log("Desk Token Treasury (ATA):", deskTokenTreasury.toBase58());

  // Check if it exists
  const ataInfo = await connection.getAccountInfo(deskTokenTreasury);
  if (ataInfo) {
    console.log("\n✅ Treasury already exists");
    return;
  }

  console.log("\nCreating ATA for desk...");

  const createAtaIx = createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    deskTokenTreasury,
    DESK,
    tokenMint,
  );

  const tx = new Transaction().add(createAtaIx);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log("✅ Treasury created");
  console.log("Transaction:", sig);
  console.log("View on Solscan: https://solscan.io/tx/" + sig);
}

async function registerToken(tokenMintStr: string, priceUsd?: number): Promise<void> {
  console.log("=== REGISTER TOKEN ON DESK ===\n");

  const tokenMint = new PublicKey(tokenMintStr);
  const connection = await getConnection();
  const wallet = await getWallet();
  const program = await getProgram(connection, wallet);

  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Desk:", DESK.toBase58());
  console.log("Wallet:", wallet.publicKey.toBase58());
  if (priceUsd) console.log("Initial Price: $" + priceUsd);

  // Derive token registry PDA
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), DESK.toBuffer(), tokenMint.toBuffer()],
    PROGRAM_ID,
  );
  console.log("Token Registry PDA:", tokenRegistryPda.toBase58());

  // Check if already registered
  const registryInfo = await connection.getAccountInfo(tokenRegistryPda);
  if (registryInfo) {
    console.log("\n✅ Token already registered");

    // Set price if provided
    if (priceUsd) {
      await setPrice(tokenMintStr, priceUsd);
    }
    return;
  }

  console.log("\nRegistering token...");

  const tx = await program.methods
    .registerToken(Array.from(EMPTY_PYTH_FEED), SystemProgram.programId, POOL_TYPE_NONE)
    .accountsStrict({
      desk: DESK,
      payer: wallet.publicKey,
      tokenMint: tokenMint,
      tokenRegistry: tokenRegistryPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Token registered");
  console.log("Transaction:", tx);
  console.log("View on Solscan: https://solscan.io/tx/" + tx);

  // Set price if provided
  if (priceUsd) {
    console.log("");
    await setPrice(tokenMintStr, priceUsd);
  }
}

async function setPrice(tokenMintStr: string, priceUsd: number): Promise<void> {
  console.log("=== SET TOKEN PRICE ===\n");

  const tokenMint = new PublicKey(tokenMintStr);
  const connection = await getConnection();
  const wallet = await getWallet();
  const program = await getProgram(connection, wallet);

  // Convert to 8 decimal fixed point
  const price8d = new anchor.BN(Math.floor(priceUsd * 1e8));

  console.log("Token:", tokenMint.toBase58());
  console.log("Price: $" + priceUsd + " (" + price8d.toString() + " in 8d format)");

  // Derive token registry PDA
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), DESK.toBuffer(), tokenMint.toBuffer()],
    program.programId,
  );

  console.log("Token Registry:", tokenRegistryPda.toBase58());
  console.log("\nSetting price...");

  const tx = await program.methods
    .setManualTokenPrice(price8d)
    .accounts({
      tokenRegistry: tokenRegistryPda,
      desk: DESK,
      owner: wallet.publicKey,
    })
    .signers([wallet])
    .rpc();

  console.log("✅ Price set");
  console.log("Transaction:", tx);
  console.log("View on Solscan: https://solscan.io/tx/" + tx);
}

async function setLimits(
  minUsdAmount: number,
  maxTokenPerOrder: number = 1000000000, // Default 1B tokens
  quoteExpirySecs: number = 3600, // Default 1 hour
  defaultUnlockDelaySecs: number = 0, // Default no minimum lockup
  maxLockupSecs: number = 31536000, // Default 1 year
): Promise<void> {
  console.log("=== SET DESK LIMITS ===\n");

  const connection = await getConnection();
  const wallet = await getWallet();
  const program = await getProgram(connection, wallet);

  // Convert to 8 decimal fixed point
  const minUsd8d = new anchor.BN(Math.floor(minUsdAmount * 1e8));
  const maxToken = new anchor.BN(maxTokenPerOrder);
  const quoteExpiry = new anchor.BN(quoteExpirySecs);
  const defaultUnlock = new anchor.BN(defaultUnlockDelaySecs);
  const maxLockup = new anchor.BN(maxLockupSecs);

  console.log("Desk:", DESK.toBase58());
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("\nNew Limits:");
  console.log("  Min USD: $" + minUsdAmount + " (" + minUsd8d.toString() + " in 8d format)");
  console.log("  Max Token Per Order:", maxTokenPerOrder);
  console.log("  Quote Expiry:", quoteExpirySecs + " seconds");
  console.log("  Default Unlock Delay:", defaultUnlockDelaySecs + " seconds");
  console.log("  Max Lockup:", maxLockupSecs + " seconds");

  console.log("\nSetting limits...");

  const tx = await program.methods
    .setLimits(minUsd8d, maxToken, quoteExpiry, defaultUnlock, maxLockup)
    .accounts({
      desk: DESK,
      owner: wallet.publicKey,
    })
    .signers([wallet])
    .rpc();

  console.log("✅ Limits set");
  console.log("Transaction:", tx);
  console.log("View on Solscan: https://solscan.io/tx/" + tx);
}

async function showStatus(): Promise<void> {
  console.log("=== SOLANA OTC DESK STATUS ===\n");

  const connection = await getConnection();

  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Desk:", DESK.toBase58());
  console.log("RPC:", SOLANA_RPC);

  // Check desk account
  const deskInfo = await connection.getAccountInfo(DESK);
  if (!deskInfo) {
    console.log("\n❌ Desk account not found");
    return;
  }

  console.log("\n✅ Desk exists");
  console.log("   Data size:", deskInfo.data.length, "bytes");
  console.log("   Lamports:", deskInfo.lamports / 1e9, "SOL");

  // Try to decode desk state
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  if (fs.existsSync(idlPath)) {
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
    const dummyWallet = new anchor.Wallet(Keypair.generate());
    const provider = new anchor.AnchorProvider(connection, dummyWallet, {
      commitment: "confirmed",
    });
    const program = new anchor.Program(idl, provider);

    interface DeskAccount {
      owner: PublicKey;
      agent: PublicKey;
      nextConsignmentId: anchor.BN;
      nextOfferId: anchor.BN;
      minUsdAmount8D: anchor.BN; // Note: capital D - Anchor converts min_usd_amount_8d to minUsdAmount8D
      maxTokenPerOrder: anchor.BN;
      paused: boolean;
    }

    interface ProgramAccounts {
      desk: {
        fetch: (addr: PublicKey) => Promise<DeskAccount>;
      };
    }

    const deskAccount = await (program.account as ProgramAccounts).desk.fetch(DESK);

    console.log("\n📊 Desk State:");
    console.log("   Owner:", deskAccount.owner.toBase58());
    console.log("   Agent:", deskAccount.agent.toBase58());
    console.log("   Consignments:", deskAccount.nextConsignmentId.toNumber() - 1);
    console.log("   Offers:", deskAccount.nextOfferId.toNumber() - 1);
    console.log("   Min USD: $" + deskAccount.minUsdAmount8D.toNumber() / 1e8);
    console.log("   Max Token Per Order:", deskAccount.maxTokenPerOrder.toString());
    console.log("   Paused:", deskAccount.paused);
  }

  // Check wallet balance
  const privateKeyStr = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (privateKeyStr) {
    const wallet = await getWallet();
    const balance = await connection.getBalance(wallet.publicKey);
    console.log("\n💰 Admin Wallet:");
    console.log("   Address:", wallet.publicKey.toBase58());
    console.log("   Balance:", balance / 1e9, "SOL");
  }
}

// =============================================================================
// MAIN
// =============================================================================

function printUsage(): void {
  console.log(`
Solana OTC Desk Admin CLI

Usage:
  bun scripts/solana-admin.ts <command> [options]

Commands:
  create-treasury <TOKEN_MINT>           Create desk token treasury (ATA)
  register-token <TOKEN_MINT> [PRICE]    Register token on desk with optional price
  set-price <TOKEN_MINT> <PRICE_USD>     Set manual token price
  set-limits <MIN_USD>                   Set desk minimum USD (e.g., 0.01 for $0.01)
  status                                 Show desk status

Examples:
  bun scripts/solana-admin.ts status
  bun scripts/solana-admin.ts create-treasury JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN
  bun scripts/solana-admin.ts register-token JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN 0.50
  bun scripts/solana-admin.ts set-price JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN 0.55
  bun scripts/solana-admin.ts set-limits 0.01   # Set minimum to $0.01

Environment Variables:
  SOLANA_MAINNET_PRIVATE_KEY   Admin wallet private key (bs58 encoded)
  SOLANA_MAINNET_RPC           RPC endpoint (default: mainnet-beta)
  SOLANA_DESK                  Desk address override
  SOLANA_PROGRAM_ID            Program ID override
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case "create-treasury":
      if (!args[1]) {
        console.error("Error: TOKEN_MINT required");
        printUsage();
        process.exit(1);
      }
      await createTreasury(args[1]);
      break;

    case "register-token":
      if (!args[1]) {
        console.error("Error: TOKEN_MINT required");
        printUsage();
        process.exit(1);
      }
      await registerToken(args[1], args[2] ? parseFloat(args[2]) : undefined);
      break;

    case "set-price":
      if (!args[1] || !args[2]) {
        console.error("Error: TOKEN_MINT and PRICE_USD required");
        printUsage();
        process.exit(1);
      }
      await setPrice(args[1], parseFloat(args[2]));
      break;

    case "set-limits":
      if (!args[1]) {
        console.error("Error: MIN_USD required (e.g., 0.01 for $0.01)");
        printUsage();
        process.exit(1);
      }
      await setLimits(parseFloat(args[1]));
      break;

    case "status":
      await showStatus();
      break;

    default:
      console.error("Unknown command:", command);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
