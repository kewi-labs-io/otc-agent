/**
 * Create a token treasury (ATA) for the desk to hold tokens
 * 
 * Usage:
 *   bun scripts/create-desk-treasury.ts <TOKEN_MINT>
 * 
 * Example:
 *   bun scripts/create-desk-treasury.ts JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import bs58 from "bs58";

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const DESK = new PublicKey("G89QsVcKN1MZe6d8eKyzv93u7TEeXSsXbsDsBPbuTMUU");

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log("Usage: bun scripts/create-desk-treasury.ts <TOKEN_MINT>");
    console.log("");
    console.log("Arguments:");
    console.log("  TOKEN_MINT - Solana token mint address");
    process.exit(1);
  }
  
  const TOKEN_MINT = new PublicKey(args[0]);
  
  console.log("=== CREATING DESK TOKEN TREASURY ===");
  console.log("");
  console.log("Token Mint:", TOKEN_MINT.toBase58());
  console.log("Desk:", DESK.toBase58());
  console.log("");
  
  const connection = new Connection(SOLANA_RPC, "confirmed");
  
  const privateKeyStr = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (!privateKeyStr) throw new Error("SOLANA_MAINNET_PRIVATE_KEY not set");
  
  const secretKey = bs58.decode(privateKeyStr);
  const wallet = Keypair.fromSecretKey(secretKey);
  console.log("Wallet:", wallet.publicKey.toBase58());
  
  // Derive the desk's ATA for the token
  const deskTokenTreasury = getAssociatedTokenAddressSync(TOKEN_MINT, DESK, true);
  console.log("Desk Token Treasury (ATA):", deskTokenTreasury.toBase58());
  
  // Check if it exists
  const ataInfo = await connection.getAccountInfo(deskTokenTreasury);
  if (ataInfo) {
    console.log("✅ Treasury already exists");
    return;
  }
  
  console.log("Creating ATA for desk...");
  
  const createAtaIx = createAssociatedTokenAccountInstruction(
    wallet.publicKey, // payer
    deskTokenTreasury, // ata
    DESK, // owner (the desk)
    TOKEN_MINT // mint
  );
  
  const tx = new Transaction().add(createAtaIx);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log("✅ Treasury created");
  console.log("Transaction:", sig);
  console.log("View on Solscan: https://solscan.io/tx/" + sig);
}

main().catch(console.error);
