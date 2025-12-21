import type { Program } from "@coral-xyz/anchor";
import pkg from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Otc } from "../target/types/otc";

// ESM/CJS compatibility: import as default then destructure
const { AnchorProvider, setProvider, workspace, BN } = pkg as typeof import("@coral-xyz/anchor");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Deploying Solana OTC Desk to MAINNET\n");

  // Configure provider from env (ANCHOR_PROVIDER_URL, ANCHOR_WALLET)
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = workspace.Otc as Program<Otc>;

  console.log("📋 Program ID:", program.programId.toString());
  console.log("👤 Payer:", provider.wallet.publicKey.toString());

  // 1. Load or Create Desk Keypair (Production should use existing)
  const deskKeypairPath = path.join(__dirname, "../desk-mainnet-keypair.json");
  let desk: Keypair;
  
  if (fs.existsSync(deskKeypairPath)) {
    const secret = JSON.parse(fs.readFileSync(deskKeypairPath, "utf8"));
    desk = Keypair.fromSecretKey(Uint8Array.from(secret));
    console.log("🏦 Using existing Desk:", desk.publicKey.toString());
  } else {
    desk = Keypair.generate();
    fs.writeFileSync(deskKeypairPath, JSON.stringify(Array.from(desk.secretKey)));
    console.log("⚠️  Created NEW Desk keypair:", desk.publicKey.toString());
    console.log("⚠️  BACKUP THIS KEYPAIR IMMEDIATELY.");
  }

  // 2. Define Mints - USDC only, no primary token (all tokens are equal)
  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  console.log("✅ USDC Mint:", usdcMint.toString());

  // 3. Initialize Desk (no token_mint required - all tokens registered via TokenRegistry)
  console.log("\n⚙️  Initializing desk...");
  await program.methods
    .initDesk(new BN(500_000_000), new BN(1800)) // $5 min, 30 min expiry
    .accountsPartial({
      payer: provider.wallet.publicKey,
      owner: provider.wallet.publicKey,
      agent: provider.wallet.publicKey, 
      usdcMint: usdcMint,
      desk: desk.publicKey,
    })
    .signers([desk])
    .rpc();
  console.log("✅ Desk initialized");

  // 4. Write deployment config for the app
  const deploymentData = {
    network: "solana-mainnet",
    rpc: "/api/rpc/solana",
    deployer: provider.wallet.publicKey.toString(),
    programId: program.programId.toString(),
    desk: desk.publicKey.toString(),
    deskOwner: provider.wallet.publicKey.toString(),
    usdcMint: usdcMint.toString(),
    features: {
      p2pAutoApproval: true,
      version: "2.0.0",
    },
    registeredTokens: {},
  };

  // Ensure dir exists
  const deploymentPath = path.join(__dirname, "../../../src/config/deployments/mainnet-solana.json");
  const deploymentDir = path.dirname(deploymentPath);
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\n✅ Config saved to ${deploymentPath}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
