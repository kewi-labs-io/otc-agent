/**
 * Register a token on the Solana mainnet desk
 * 
 * Usage:
 *   bun scripts/register-mainnet-token.ts <TOKEN_MINT> [PYTH_FEED_ID] [PRICE_USD]
 * 
 * Examples:
 *   bun scripts/register-mainnet-token.ts JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN
 *   bun scripts/register-mainnet-token.ts <mint> <pyth_feed_hex> 1.50
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey("6qn8ELVXd957oRjLaomCpKpcVZshUjNvSzw1nc7QVyXc");
const DESK = new PublicKey("G89QsVcKN1MZe6d8eKyzv93u7TEeXSsXbsDsBPbuTMUU");

// Pool type: 0 = None, 1 = Raydium, 2 = Orca, 3 = PumpSwap
const POOL_TYPE_NONE = 0;

// Default empty Pyth feed (zeros)
const EMPTY_PYTH_FEED = Buffer.alloc(32, 0);

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log("Usage: bun scripts/register-mainnet-token.ts <TOKEN_MINT> [PYTH_FEED_ID] [PRICE_USD]");
    console.log("");
    console.log("Arguments:");
    console.log("  TOKEN_MINT    - Solana token mint address (required)");
    console.log("  PYTH_FEED_ID  - Pyth price feed ID in hex (optional)");
    console.log("  PRICE_USD     - Manual price in USD if no Pyth feed (optional)");
    process.exit(1);
  }
  
  const tokenMintStr = args[0];
  const pythFeedHex = args[1];
  const manualPriceUsd = args[2] ? parseFloat(args[2]) : undefined;
  
  const TOKEN_MINT = new PublicKey(tokenMintStr);
  const PYTH_FEED_ID = pythFeedHex ? Buffer.from(pythFeedHex, "hex") : EMPTY_PYTH_FEED;
  
  console.log("=== REGISTERING TOKEN ON MAINNET DESK ===");
  console.log("");
  console.log("Token Mint:", TOKEN_MINT.toBase58());
  if (pythFeedHex) {
    console.log("Pyth Feed:", pythFeedHex);
  }
  if (manualPriceUsd) {
    console.log("Manual Price: $" + manualPriceUsd);
  }
  console.log("");
  
  const connection = new Connection(SOLANA_RPC, "confirmed");
  
  const privateKeyStr = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (!privateKeyStr) throw new Error("SOLANA_MAINNET_PRIVATE_KEY not set");
  
  const secretKey = bs58.decode(privateKeyStr);
  const wallet = Keypair.fromSecretKey(secretKey);
  console.log("Wallet:", wallet.publicKey.toBase58());
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");
  
  // Load IDL
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  
  // Create provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  
  // Create program
  const program = new anchor.Program(idl, provider);
  
  // Derive token registry PDA - seeds are ["registry", desk, token_mint]
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), DESK.toBuffer(), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );
  console.log("Token Registry PDA:", tokenRegistryPda.toBase58());
  
  // Check if already exists
  const registryInfo = await connection.getAccountInfo(tokenRegistryPda);
  if (registryInfo) {
    console.log("✅ Token already registered");
    return;
  }
  
  console.log("");
  console.log("Registering token...");
  console.log("  Token mint:", TOKEN_MINT.toBase58());
  console.log("  Desk:", DESK.toBase58());
  
  try {
    const tx = await (program.methods as anchor.Program["methods"]).registerToken(
      Array.from(PYTH_FEED_ID),
      SystemProgram.programId, // pool_address (placeholder when using None)
      POOL_TYPE_NONE // pool_type = None
    )
      .accountsStrict({
        desk: DESK,
        payer: wallet.publicKey,
        tokenMint: TOKEN_MINT,
        tokenRegistry: tokenRegistryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Token registered");
    console.log("Transaction:", tx);
    console.log("View on Solscan: https://solscan.io/tx/" + tx);
    
    // Set manual price if provided
    if (manualPriceUsd) {
      console.log("");
      console.log("Setting manual price: $" + manualPriceUsd);
      // Price is in 8 decimals
      const price8d = new anchor.BN(Math.floor(manualPriceUsd * 100_000_000));
      
      const priceTx = await (program.methods as anchor.Program["methods"]).setManualTokenPrice(price8d)
        .accountsStrict({
          tokenRegistry: tokenRegistryPda,
          desk: DESK,
          owner: wallet.publicKey,
        })
        .rpc();
      
      console.log("✅ Price set");
      console.log("Transaction:", priceTx);
    }
    
  } catch (e: Error | unknown) {
    const error = e as Error & { logs?: string[] };
    console.error("Failed:", error.message);
    if (error.logs) {
      console.log("Logs:", error.logs);
    }
  }
}

main().catch(console.error);
