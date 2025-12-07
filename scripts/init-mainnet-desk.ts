import { config } from "dotenv";
config({ path: ".env.local" });

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey("6qn8ELVXd957oRjLaomCpKpcVZshUjNvSzw1nc7QVyXc");

// USDC on Solana mainnet
const USDC_MAINNET = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function main() {
  console.log("=== INITIALIZING SOLANA MAINNET DESK ===");
  console.log("");
  
  const connection = new Connection(SOLANA_RPC, "confirmed");
  
  const privateKeyStr = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (!privateKeyStr) throw new Error("SOLANA_MAINNET_PRIVATE_KEY not set");
  
  const secretKey = bs58.decode(privateKeyStr);
  const wallet = Keypair.fromSecretKey(secretKey);
  console.log("Wallet:", wallet.publicKey.toBase58());
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");
  
  if (balance < 0.1 * 1e9) {
    console.log("⚠️ Low balance, need at least 0.1 SOL");
  }
  
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
  
  // Generate a new desk keypair (desk is a signer in this program)
  const deskKeypair = Keypair.generate();
  console.log("Generated Desk Keypair:", deskKeypair.publicKey.toBase58());
  
  // Check if we have an existing desk stored
  const existingDesk = process.env.NEXT_PUBLIC_SOLANA_DESK_MAINNET;
  if (existingDesk) {
    console.log("Checking existing desk:", existingDesk);
    const deskInfo = await connection.getAccountInfo(new PublicKey(existingDesk));
    if (deskInfo) {
      console.log("✅ Desk already exists on mainnet at:", existingDesk);
      return;
    }
  }
  
  console.log("");
  console.log("Initializing NEW desk on mainnet...");
  console.log("This will create a new OTC desk with:");
  console.log("  - Owner:", wallet.publicKey.toBase58());
  console.log("  - Desk:", deskKeypair.publicKey.toBase58());
  
  // Initialize desk using init_desk instruction
  // Args: min_usd_amount_8d (minimum USD amount in 8 decimals), quote_expiry_secs
  const minUsdAmount = new anchor.BN(100_00000000); // $100 minimum, 8 decimals
  const quoteExpirySecs = new anchor.BN(86400); // 24 hours
  
  try {
    const tx = await (program.methods as any).initDesk(minUsdAmount, quoteExpirySecs)
      .accountsStrict({
        payer: wallet.publicKey,
        owner: wallet.publicKey,
        agent: wallet.publicKey, // owner is also the agent for now
        usdcMint: USDC_MAINNET,
        systemProgram: SystemProgram.programId,
        desk: deskKeypair.publicKey,
      })
      .signers([deskKeypair])
      .rpc();
    
    console.log("✅ Desk initialized on Solana mainnet");
    console.log("Transaction:", tx);
    console.log("Desk address:", deskKeypair.publicKey.toBase58());
    console.log("");
    console.log("=== IMPORTANT: Save these values ==");
    console.log("Add to .env.local:");
    console.log(`NEXT_PUBLIC_SOLANA_DESK_MAINNET=${deskKeypair.publicKey.toBase58()}`);
    console.log(`NEXT_PUBLIC_SOLANA_DESK_OWNER=${wallet.publicKey.toBase58()}`);
    console.log("");
    console.log("View on Solscan: https://solscan.io/tx/" + tx);
  } catch (e: any) {
    console.error("Failed to initialize desk:", e.message);
    if (e.logs) {
      console.log("Logs:", e.logs);
    }
  }
}

main().catch(console.error);
