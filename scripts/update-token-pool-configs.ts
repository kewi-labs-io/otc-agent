#!/usr/bin/env bun

/**
 * Update all registered tokens with their pool configs
 *
 * This script finds PumpSwap/Raydium pools for all registered tokens
 * and updates their pool_address and pool_type on the Solana OTC desk.
 *
 * Usage:
 *   SOLANA_PRIVATE_KEY=<desk_owner_base58_key> bun run scripts/update-token-pool-configs.ts
 *
 * Requirements:
 *   - SOLANA_PRIVATE_KEY must be the desk owner's private key
 *   - Helius API key for RPC access
 */

import { AnchorProvider, type Wallet as AnchorWallet, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getSolanaConfig } from "@/config/contracts";
import { getHeliusRpcUrl } from "@/config/env";
// Load IDL
import idl from "@/contracts/solana-otc.idl.json";
import { findBestSolanaPool } from "@/utils/pool-finder-solana";

// Helper to create Anchor wallet from keypair
class KeypairWallet implements AnchorWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("version" in tx) {
      tx.sign([this.payer]);
    } else {
      (tx as Transaction).partialSign(this.payer);
    }
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

async function main() {
  console.log("=== Token Pool Config Updater ===\n");

  // Load config
  const config = getSolanaConfig();
  if (!config.programId) {
    throw new Error("config.programId is missing - check deployment files");
  }
  if (!config.desk) {
    throw new Error("config.desk is missing - check deployment files");
  }

  // Load signer (must be desk owner)
  const signerKey = process.env.SOLANA_PRIVATE_KEY;
  if (!signerKey) {
    throw new Error("SOLANA_PRIVATE_KEY not set. Must be the desk owner's key.");
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));

  console.log(`Signer: ${keypair.publicKey.toBase58()}`);
  console.log(`Desk: ${config.desk}`);
  console.log(`Program: ${config.programId}\n`);

  // Connect to Solana
  const rpcUrl = getHeliusRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");

  const wallet = new KeypairWallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idl as never, provider);

  // Verify signer is desk owner
  const deskPubkey = new PublicKey(config.desk);
  const deskAccount = await connection.getAccountInfo(deskPubkey);
  if (!deskAccount) {
    throw new Error(`Desk account not found at ${config.desk}`);
  }

  // Desk layout: discriminator(8) + owner(32) + ...
  const deskOwner = new PublicKey(deskAccount.data.subarray(8, 40));
  if (!deskOwner.equals(keypair.publicKey)) {
    throw new Error(
      `Signer is NOT the desk owner! Expected: ${deskOwner.toBase58()}, Got: ${keypair.publicKey.toBase58()}`,
    );
  }
  console.log("✅ Verified: Signer is desk owner\n");

  // Get all tokens from database
  const { TokenDB } = await import("@/services/database");
  const tokens = await TokenDB.getAllTokens();
  const solanaTokens = tokens.filter((t) => t.chain === "solana" && t.contractAddress);

  console.log(`Found ${solanaTokens.length} Solana tokens in database\n`);

  let updated = 0;
  let skipped = 0;
  const failed = 0;

  for (const token of solanaTokens) {
    // FAIL-FAST: contractAddress was already validated in filter above
    if (!token.contractAddress) {
      console.log(`\n--- ${token.symbol} - SKIPPING (no contract address) ---`);
      skipped++;
      continue;
    }
    const mint = new PublicKey(token.contractAddress);
    console.log(`\n--- ${token.symbol} (${mint.toBase58().slice(0, 8)}...) ---`);

    // Find token registry PDA
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), deskPubkey.toBuffer(), mint.toBuffer()],
      new PublicKey(config.programId),
    );

    // Check if registered
    const registryInfo = await connection.getAccountInfo(registryPda);
    if (!registryInfo) {
      console.log("  Not registered on desk - skipping");
      skipped++;
      continue;
    }

    // Check current pool config
    // TokenRegistry layout: discriminator(8) + desk(32) + token_mint(32) + decimals(1) + price_feed_id(32) + pool_address(32) + pool_type(1)
    const POOL_ADDRESS_OFFSET = 8 + 32 + 32 + 1 + 32;
    const POOL_TYPE_OFFSET = POOL_ADDRESS_OFFSET + 32;

    const currentPoolAddress = new PublicKey(
      registryInfo.data.subarray(POOL_ADDRESS_OFFSET, POOL_ADDRESS_OFFSET + 32),
    );
    const currentPoolType = registryInfo.data[POOL_TYPE_OFFSET];

    console.log(
      `  Current: pool_type=${currentPoolType}, pool_address=${currentPoolAddress.toBase58().slice(0, 8)}...`,
    );

    // Find pool for this token
    const pool = await findBestSolanaPool(mint.toBase58(), "mainnet");

    if (!pool) {
      console.log("  No pool found - skipping");
      skipped++;
      continue;
    }

    const poolType =
      pool.protocol === "PumpSwap"
        ? 3
        : pool.protocol === "Raydium"
          ? 1
          : pool.protocol === "Orca"
            ? 2
            : 0;
    const poolAddress = new PublicKey(pool.address);

    const priceDisplay =
      pool.priceUsd !== undefined ? `$${pool.priceUsd.toFixed(8)}` : "price unavailable";
    console.log(
      `  Found: ${pool.protocol} pool at ${pool.address.slice(0, 8)}..., price: ${priceDisplay}`,
    );

    // Check if update needed
    if (currentPoolAddress.equals(poolAddress) && currentPoolType === poolType) {
      console.log("  Already configured - skipping");
      skipped++;
      continue;
    }

    // Update pool config
    console.log(`  Updating pool config...`);
    const tx = await program.methods
      .setTokenPoolConfig(poolAddress, poolType)
      .accounts({
        tokenRegistry: registryPda,
        desk: deskPubkey,
        signer: keypair.publicKey,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ])
      .rpc();

    console.log(`  ✅ Updated: ${tx}`);
    updated++;

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
