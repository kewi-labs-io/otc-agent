import type { Program, Wallet } from "@coral-xyz/anchor";
import pkg from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Otc } from "../target/types/otc";

// ESM/CJS compatibility: import as default then destructure
const { AnchorProvider, setProvider, workspace, BN } = pkg as typeof import("@coral-xyz/anchor");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Deploying Solana OTC Desk to Devnet\n");
  console.log("Note: All tokens are equal - no primary token required.\n");

  // Configure provider from env (ANCHOR_PROVIDER_URL, ANCHOR_WALLET)
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = workspace.Otc as Program<Otc>;

  console.log("📋 Program ID:", program.programId.toString());
  console.log("👤 Payer:", provider.wallet.publicKey.toString());

  // 1. Load or Create Desk Keypair
  const deskKeypairPath = path.join(__dirname, "../desk-devnet-keypair.json");
  let desk: Keypair;
  
  if (fs.existsSync(deskKeypairPath)) {
    const secret = JSON.parse(fs.readFileSync(deskKeypairPath, "utf8"));
    desk = Keypair.fromSecretKey(Uint8Array.from(secret));
    console.log("🏦 Using existing Desk:", desk.publicKey.toString());
  } else {
    desk = Keypair.generate();
    fs.writeFileSync(deskKeypairPath, JSON.stringify(Array.from(desk.secretKey)));
    console.log("🏦 Created new Desk:", desk.publicKey.toString());
  }

  // 2. Create USDC Mock Mint for Devnet testing
  console.log("\n🪙 Creating Devnet USDC Mock...");
  const payer = (provider.wallet as Wallet).payer || Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET || "./id.json", "utf8"))));

  const usdcMint = await createMint(
    provider.connection,
    payer,
    provider.wallet.publicKey,
    null,
    6
  );
  console.log("✅ USDC Mock Mint:", usdcMint.toString());

  // 3. Initialize Desk (no token_mint required - all tokens are equal)
  console.log("\n⚙️  Initializing desk...");
  
  const tx = await program.methods
    .initDesk(new BN(500_000_000), new BN(1800))
    .accountsPartial({
      payer: provider.wallet.publicKey,
      owner: provider.wallet.publicKey,
      agent: provider.wallet.publicKey, 
      usdcMint: usdcMint,
      desk: desk.publicKey,
    })
    .signers([desk])
    .rpc();
    
  console.log("✅ Desk initialized. Tx:", tx);

  // 4. Write deployment config for the app
  const deploymentData = {
    network: "solana-devnet",
    rpc: "https://api.devnet.solana.com",
    deployer: provider.wallet.publicKey.toString(),
    programId: program.programId.toString(),
    desk: desk.publicKey.toString(),
    deskOwner: provider.wallet.publicKey.toString(),
    usdcMint: usdcMint.toString(),
  };

  // Ensure dir exists
  const deploymentPath = path.join(__dirname, "../../../src/config/deployments/testnet-solana.json");
  const deploymentDir = path.dirname(deploymentPath);
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\n✅ Config saved to ${deploymentPath}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
