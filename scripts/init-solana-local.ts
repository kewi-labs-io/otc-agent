#!/usr/bin/env bun

/**
 * Initialize Solana Local Desk
 * Creates the desk account for local development on solana-test-validator
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// Local network config - use same program ID as mainnet for simplicity
const PROGRAM_ID = new PublicKey("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");
const RPC_URL = "http://127.0.0.1:8899";

// Anchor discriminator for init_desk (sha256("global:init_desk")[0..8])
const INIT_DESK_DISCRIMINATOR = Buffer.from([0xd7, 0xb5, 0x5f, 0xf5, 0x1f, 0xbe, 0x40, 0xd0]);

function serializeInitDeskArgs(
  minUsdAmount: bigint,
  maxTokenPerOrder: bigint,
  quoteExpirySecs: bigint,
  defaultUnlockDelaySecs: bigint,
): Buffer {
  const minUsdBuf = Buffer.alloc(8);
  minUsdBuf.writeBigUInt64LE(minUsdAmount);

  const maxTokenBuf = Buffer.alloc(8);
  maxTokenBuf.writeBigUInt64LE(maxTokenPerOrder);

  const quoteExpiryBuf = Buffer.alloc(8);
  quoteExpiryBuf.writeBigInt64LE(quoteExpirySecs);

  const defaultUnlockBuf = Buffer.alloc(8);
  defaultUnlockBuf.writeBigInt64LE(defaultUnlockDelaySecs);

  return Buffer.concat([
    INIT_DESK_DISCRIMINATOR,
    minUsdBuf,
    maxTokenBuf,
    quoteExpiryBuf,
    defaultUnlockBuf,
  ]);
}

async function _loadOrCreateKeypair(filepath: string): Promise<Keypair> {
  if (fs.existsSync(filepath)) {
    const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(filepath, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function main() {
  console.log("═".repeat(70));
  console.log("  Solana LOCAL Desk Initialization");
  console.log("═".repeat(70));
  console.log();

  // Create connection
  const connection = new Connection(RPC_URL, "confirmed");

  // Check if validator is running
  await connection.getSlot();

  // Load or create faucet keypair (the one with SOL from test-validator)
  const faucetPath = path.join(process.cwd(), "test-ledger/faucet-keypair.json");
  let payer: Keypair;

  if (fs.existsSync(faucetPath)) {
    const data = JSON.parse(fs.readFileSync(faucetPath, "utf-8"));
    payer = Keypair.fromSecretKey(Uint8Array.from(data));
    console.log(`Using faucet keypair: ${payer.publicKey.toBase58()}`);
  } else {
    // Create a new keypair and airdrop
    payer = Keypair.generate();
    console.log(`Created new keypair: ${payer.publicKey.toBase58()}`);
    console.log("Requesting airdrop...");
    const sig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  }

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  console.log();

  // Check if program is deployed
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    console.error(`ERROR: Program ${PROGRAM_ID.toBase58()} is not deployed.`);
    console.error("Deploy it with:");
    console.error("  cd solana/otc-program && anchor deploy --provider.cluster localnet");
    process.exit(1);
  }
  console.log(`Program ID: ${PROGRAM_ID.toBase58()} (deployed)`);

  // Create a mock USDC mint for local testing
  const { createMint } = await import("@solana/spl-token");
  const usdcMint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6, // USDC has 6 decimals
  );
  console.log(`Created mock USDC mint: ${usdcMint.toBase58()}`);

  // Generate desk keypair
  const deskKeypair = Keypair.generate();
  console.log(`Desk Address: ${deskKeypair.publicKey.toBase58()}`);
  console.log();

  // Calculate rent
  const DESK_SIZE = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1;
  const rentExemption = await connection.getMinimumBalanceForRentExemption(DESK_SIZE);
  console.log(`Rent exemption: ${rentExemption / LAMPORTS_PER_SOL} SOL for ${DESK_SIZE} bytes`);

  // Build instruction data
  const data = serializeInitDeskArgs(
    BigInt(1_000000), // $1 min (6 decimals for USDC)
    BigInt("1000000000000000"), // 1M tokens max
    BigInt(30 * 60), // 30 minutes quote expiry
    BigInt(0), // No lockup
  );

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: payer.publicKey, isSigner: true, isWritable: false }, // owner
      { pubkey: payer.publicKey, isSigner: false, isWritable: false }, // agent
      { pubkey: usdcMint, isSigner: false, isWritable: false }, // usdc_mint
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: deskKeypair.publicKey, isSigner: true, isWritable: true }, // desk
    ],
    programId: PROGRAM_ID,
    data: data,
  });

  console.log("Sending initDesk transaction...");

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(instruction);

  const signature = await sendAndConfirmTransaction(connection, tx, [payer, deskKeypair], {
    commitment: "confirmed",
  });

  console.log(`✅ Desk initialized`);
  console.log(`   Transaction: ${signature}`);
  console.log(`   Desk Address: ${deskKeypair.publicKey.toBase58()}`);
  console.log();

  // Save desk keypair
  const deskKeypairPath = path.join(process.cwd(), "solana/otc-program/desk-local-keypair.json");
  fs.writeFileSync(deskKeypairPath, JSON.stringify(Array.from(deskKeypair.secretKey)));
  console.log(`Saved desk keypair to: ${deskKeypairPath}`);

  // Update local config
  const configPath = path.join(process.cwd(), "src/config/deployments/local-solana.json");
  const config = {
    network: "solana-local",
    rpc: "http://127.0.0.1:8899",
    programId: PROGRAM_ID.toBase58(),
    desk: deskKeypair.publicKey.toBase58(),
    deskOwner: payer.publicKey.toBase58(),
    usdcMint: usdcMint.toBase58(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Updated config: ${configPath}`);

  console.log();
  console.log("═".repeat(70));
  console.log("  Local Desk Initialization Complete");
  console.log("═".repeat(70));
  console.log();
  console.log("Next steps:");
  console.log("  1. Restart your Next.js dev server to pick up new config");
  console.log("  2. The app should now work with local Solana");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
