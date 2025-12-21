import pkg from "@coral-xyz/anchor";
const anchor = pkg;
const { BN } = anchor;
import { PublicKey, SystemProgram, Keypair, Connection } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

async function main() {
  console.log("🚀 Re-initializing Solana OTC Desk on Mainnet\n");

  // Generate a NEW keypair for the desk
  const desk = Keypair.generate();
  console.log("🏦 Generated NEW Desk keypair:", desk.publicKey.toString());
  console.log("   Private key (base58):", bs58.encode(desk.secretKey));

  // Load owner/deployer keypair
  const deployerPath = path.join(__dirname, "../mainnet-deployer.json");
  if (!fs.existsSync(deployerPath)) {
    throw new Error(`Deployer keypair not found at ${deployerPath}`);
  }
  const deployerData = JSON.parse(fs.readFileSync(deployerPath, "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(deployerData));
  console.log("👤 Owner/Deployer:", owner.publicKey.toString());

  // Use Helius RPC for mainnet
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    throw new Error("HELIUS_API_KEY environment variable required");
  }
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  console.log("🌐 Using Helius RPC");

  const connection = new Connection(rpcUrl, "confirmed");

  // Check balances
  const ownerBalance = await connection.getBalance(owner.publicKey);
  console.log(`💰 Owner balance: ${ownerBalance / 1e9} SOL`);

  if (ownerBalance < 0.01e9) {
    throw new Error("Insufficient SOL. Need at least 0.01 SOL for initialization.");
  }

  // FAIL-FAST: Desk account must not exist for fresh keypair
  const deskInfo = await connection.getAccountInfo(desk.publicKey);
  if (deskInfo) {
    throw new Error(`Desk account already exists at ${desk.publicKey.toString()}. Size: ${deskInfo.data.length} bytes, Owner: ${deskInfo.owner.toString()}`);
  }
  console.log("✅ Desk address is available (no existing account)")

  // Load IDL
  const idlPath = path.join(__dirname, "../target/idl/otc.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run 'anchor build' first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  // Create wallet adapter for Anchor
  const wallet = {
    publicKey: owner.publicKey,
    signTransaction: async (tx: Parameters<typeof owner.signTransaction>[0]) => {
      tx.partialSign(owner);
      return tx;
    },
    signAllTransactions: async (txs: Parameters<typeof owner.signTransaction>[0][]) => {
      txs.forEach(tx => tx.partialSign(owner));
      return txs;
    },
  };

  const provider = new anchor.AnchorProvider(connection, wallet as anchor.Wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // FAIL-FAST: IDL must have program address in one of the expected locations
  const programAddress = idl.address ?? idl.metadata?.address;
  if (!programAddress) {
    throw new Error("IDL missing program address (both 'address' and 'metadata.address' are undefined)");
  }
  const programId = new PublicKey(programAddress);
  console.log("📋 Program ID:", programId.toString());

  const program = new anchor.Program(idl, provider);

  // Use mainnet USDC
  const usdcMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  console.log("💵 USDC Mint:", usdcMint.toString());

  // Agent is same as owner for simplicity
  const agent = owner;
  console.log("🤖 Agent:", agent.publicKey.toString());

  // Create USDC account for desk
  console.log("\n📦 Creating desk USDC account...");
  const deskUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    desk.publicKey,
    true // allowOwnerOffCurve
  );

  await getOrCreateAssociatedTokenAccount(
    connection,
    owner,
    usdcMint,
    desk.publicKey,
    true // allowOwnerOffCurve
  );
  console.log("✅ Desk USDC ATA:", deskUsdcAta.toString());

  // Initialize desk
  console.log("\n⚙️  Initializing desk...");
  
  const tx = await program.methods
    .initDesk(
      new BN(500_000_000), // $5 minimum (8 decimals)
      new BN(1800) // 30 minutes expiry
    )
    .accounts({
      payer: owner.publicKey,
      owner: owner.publicKey,
      agent: agent.publicKey,
      usdcMint: usdcMint,
      desk: desk.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner, desk])
    .rpc({ skipPreflight: false });

  console.log("✅ Desk initialized. Tx:", tx);
  console.log(`   View on Solscan: https://solscan.io/tx/${tx}`);

  // Save desk keypair (JSON array format)
  const deskKeypairPath = path.join(__dirname, "../desk-mainnet-keypair.json");
  fs.writeFileSync(deskKeypairPath, JSON.stringify(Array.from(desk.secretKey)));
  console.log(`\n✅ Desk keypair saved to ${deskKeypairPath}`);

  // Update deployment config
  const configData = {
    network: "solana-mainnet",
    rpc: "/api/rpc/solana",
    deployer: owner.publicKey.toString(),
    programId: programId.toString(),
    desk: desk.publicKey.toString(),
    deskOwner: owner.publicKey.toString(),
    usdcMint: usdcMint.toString(),
    features: {
      p2pAutoApproval: true,
      version: "2.0.0"
    },
    registeredTokens: {}
  };

  const deploymentPath = path.join(__dirname, "../../../src/config/deployments/mainnet-solana.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(configData, null, 2));
  console.log(`✅ Deployment config updated at ${deploymentPath}`);

  // Output summary
  console.log("\n" + "=".repeat(80));
  console.log("🎉 SUCCESS - New Desk Initialized");
  console.log("=".repeat(80));
  console.log(`Desk Address: ${desk.publicKey.toString()}`);
  console.log(`Desk Owner: ${owner.publicKey.toString()}`);
  console.log(`Program ID: ${programId.toString()}`);
  console.log("=".repeat(80));
  console.log("\nThe desk private key is now saved and the deployment config is updated.");
  console.log("Restart your dev server for changes to take effect.");
}

main()
  .then(() => {
    console.log("\n✨ All done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
