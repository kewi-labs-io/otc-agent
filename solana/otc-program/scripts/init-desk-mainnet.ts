import pkg from "@coral-xyz/anchor";
const anchor: any = pkg as any;
const { BN } = anchor;
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Load .env from parent directory
const envPath = path.join(__dirname, "../../../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

async function main() {
  console.log("🚀 Initializing Solana OTC Desk on Mainnet\n");

  // Set environment for Anchor
  process.env.ANCHOR_PROVIDER_URL = "https://api.mainnet-beta.solana.com";
  process.env.ANCHOR_WALLET = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || "", ".config/solana/mainnet-deployer.json");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Use workspace program
  const program = anchor.workspace.Otc as any;

  // Load owner from wallet
  const walletPath = process.env.ANCHOR_WALLET;
  if (!fs.existsSync(walletPath!)) {
    throw new Error(`Wallet not found at ${walletPath}`);
  }
  const walletData = JSON.parse(fs.readFileSync(walletPath!, "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(walletData));

  console.log("📋 Program ID:", program.programId.toString());
  console.log("👤 Owner:", owner.publicKey.toString());

  // Check balance
  const balance = await provider.connection.getBalance(owner.publicKey);
  console.log(`💰 Owner balance: ${balance / 1e9} SOL`);

  if (balance < 0.005e9) {
    throw new Error("Insufficient SOL. Need at least 0.005 SOL for initialization.");
  }

  // Use mainnet USDC
  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  console.log("💵 USDC Mint:", usdcMint.toString());

  // Use ElizaOS token mint from .env
  const tokenMintStr = process.env.NEXT_PUBLIC_SOLANA_TOKEN_MINT;
  
  if (!tokenMintStr) {
    throw new Error("NEXT_PUBLIC_SOLANA_TOKEN_MINT not set in .env");
  }

  const tokenMint = new PublicKey(tokenMintStr);
  
  // Verify token mint exists
  const tokenAccountInfo = await provider.connection.getAccountInfo(tokenMint);
  if (!tokenAccountInfo) {
    throw new Error(`Token mint ${tokenMintStr} not found on mainnet`);
  }
  
  console.log("🪙 Using ElizaOS Token Mint:", tokenMint.toString());

  // Generate agent keypair (can be same as owner for now)
  const agent = owner; // Using owner as agent for simplicity
  console.log("🤖 Agent:", agent.publicKey.toString());

  // Generate desk keypair
  const desk = Keypair.generate();
  console.log("🏦 Desk:", desk.publicKey.toString());

  // Create token accounts for desk
  console.log("\n📦 Creating desk token accounts...");
  const deskTokenAta = getAssociatedTokenAddressSync(
    tokenMint,
    desk.publicKey,
    true
  );
  const deskUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    desk.publicKey,
    true
  );

  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    tokenMint,
    desk.publicKey,
    true
  );
  console.log("✅ Desk token ATA:", deskTokenAta.toString());

  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    usdcMint,
    desk.publicKey,
    true
  );
  console.log("✅ Desk USDC ATA:", deskUsdcAta.toString());

  // Initialize desk
  console.log("\n⚙️  Initializing desk...");
  
  // Build transaction manually to ensure both signers are included
  const tx = await program.methods
    .initDesk(
      new BN(500_000_000), // $5 minimum
      new BN(1800) // 30 minutes expiry
    )
    .accounts({
      payer: owner.publicKey,
      owner: owner.publicKey,
      agent: agent.publicKey,
      tokenMint: tokenMint,
      usdcMint: usdcMint,
      desk: desk.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner, desk])
    .rpc({ skipPreflight: false });

  console.log("✅ Desk initialized! Tx:", tx);
  console.log(`   View on Solscan: https://solscan.io/tx/${tx}`);

  // Output for .env
  console.log("\n" + "=".repeat(80));
  console.log("🎉 SUCCESS! Update your .env with:");
  console.log("=".repeat(80));
  console.log(`NEXT_PUBLIC_SOLANA_DESK=${desk.publicKey.toString()}`);
  console.log("=".repeat(80));
}

main()
  .then(() => {
    console.log("\n✨ All done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });

