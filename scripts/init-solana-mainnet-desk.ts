#!/usr/bin/env bun
/**
 * Initialize Solana Mainnet Desk
 * Creates the main configuration account for the OTC program on mainnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as bs58 from "bs58";

const PROGRAM_ID = new PublicKey("q9MhHpeydqTdtPaNpzDoWvP1qY5s3sFHTF1uYcXjdsc");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const RPC_URL = "https://api.mainnet-beta.solana.com";

// Deployer key (from user)
const DEPLOYER_KEY = "5j9LAUP56hf5Ny45gDzFU1xe1jUjcuJpKUxBtmHuVvDfZuMPXa7GNUNxCfqn2Pmfra3AtJqykbNdmBdW5dbbhi8R";

// Anchor discriminator for init_desk (sha256("global:init_desk")[0..8])
const INIT_DESK_DISCRIMINATOR = Buffer.from([
  0xd7, 0xb5, 0x5f, 0xf5, 0x1f, 0xbe, 0x40, 0xd0
]);

function serializeInitDeskArgs(
  minUsdAmount: bigint,
  maxTokenPerOrder: bigint,
  quoteExpirySecs: bigint,
  defaultUnlockDelaySecs: bigint
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

async function main() {
  console.log("═".repeat(70));
  console.log("  Solana Mainnet Desk Initialization");
  console.log("═".repeat(70));
  console.log();

  // Parse keypair
  const decoded = bs58.decode(DEPLOYER_KEY);
  const keypair = Keypair.fromSecretKey(decoded);
  console.log(`Owner/Agent/Payer: ${keypair.publicKey.toBase58()}`);
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`USDC Mint: ${USDC_MINT.toBase58()}`);
  console.log();

  // Create connection
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  console.log();

  // Generate a new keypair for the desk account (non-PDA approach)
  const deskKeypair = Keypair.generate();
  console.log(`Desk Address: ${deskKeypair.publicKey.toBase58()}`);
  console.log();

  // Check if we should use this desk or if one exists
  // For mainnet, we'll create a new desk account

  console.log("Creating new Desk account...");
  console.log();

  // Calculate rent
  const DESK_SIZE = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1; // Anchor discriminator + all fields
  const rentExemption = await connection.getMinimumBalanceForRentExemption(DESK_SIZE);
  console.log(`Rent exemption: ${rentExemption / 1e9} SOL for ${DESK_SIZE} bytes`);

  // Build instruction data
  const data = serializeInitDeskArgs(
    BigInt(5_00000000), // $5 (8 decimals)
    BigInt("1000000000000000"), // 1M tokens with 9 decimals
    BigInt(30 * 60), // 30 minutes
    BigInt(0), // No default lockup
  );

  // InitDesk accounts based on lib.rs:
  // payer: Signer (mut)
  // owner: Signer
  // agent: UncheckedAccount
  // usdc_mint: Account<Mint>
  // system_program: Program<System>
  // desk: Account<Desk> (init, payer = payer)
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: keypair.publicKey, isSigner: true, isWritable: false }, // owner
      { pubkey: keypair.publicKey, isSigner: false, isWritable: false }, // agent
      { pubkey: USDC_MINT, isSigner: false, isWritable: false }, // usdc_mint
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: deskKeypair.publicKey, isSigner: true, isWritable: true }, // desk (needs to sign for init)
    ],
    programId: PROGRAM_ID,
    data: data,
  });

  console.log("Sending initDesk transaction...");
  
  const tx = new Transaction();
  
  // Add compute budget for safety
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(instruction);
  
  const signature = await sendAndConfirmTransaction(
    connection, 
    tx, 
    [keypair, deskKeypair], // Both need to sign
    { commitment: "confirmed" }
  );

  console.log(`✅ Desk initialized`);
  console.log(`   Transaction: ${signature}`);
  console.log(`   Desk Address: ${deskKeypair.publicKey.toBase58()}`);
  console.log();

  // Update config
  const configPath = "/Users/shawwalters/otc-agent/src/config/deployments/mainnet-solana.json";
  const config = JSON.parse(await Bun.file(configPath).text());
  config.desk = deskKeypair.publicKey.toBase58();
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  console.log(`Updated config: ${configPath}`);
  
  console.log();
  console.log("═".repeat(70));
  console.log("  Desk Initialization Complete");
  console.log("═".repeat(70));
}

main().catch(console.error);
