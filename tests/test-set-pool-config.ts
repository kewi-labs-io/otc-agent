/**
 * Test script: Configure pool for ELIZAOS token
 * This fixes the stale price issue by setting up automatic pool-based pricing
 */
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "../src/contracts/solana-otc.idl.json";
import mainnetSolana from "../src/config/deployments/mainnet-solana.json";

// Pool types
enum PoolType {
  None = 0,
  Raydium = 1,
  Orca = 2,
  PumpSwap = 3,
}

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC || mainnetSolana.rpc;
  const connection = new Connection(rpcUrl, "confirmed");

  const programId = new PublicKey(mainnetSolana.programId);
  const deskPubkey = new PublicKey(mainnetSolana.desk);

  // ELIZAOS token mint (from deployment config)
  const elizaosMint = new PublicKey(mainnetSolana.registeredTokens.ELIZAOS.mint);
  console.log("ELIZAOS mint:", elizaosMint.toBase58());

  // For PumpSwap tokens, we need to find the bonding curve
  // This is token-specific - for now, we'll need to find the pool address
  // Looking up via Raydium or Jupiter API would be the production approach
  // For now, let's query if there's a registered pool
  const elizaosBondingCurve = new PublicKey("9MNxazyNT2RZ1XAFBuTJNGE1p5nj9ckB2ksZDJCiE1B5");

  // Get signer - needs to be desk owner or the original registrant
  const signerKey = process.env.SOLANA_PRIVATE_KEY;
  if (!signerKey) {
    console.error("SOLANA_PRIVATE_KEY not set");
    process.exit(1);
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));
  console.log("Signer:", keypair.publicKey.toBase58());

  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idl as never, provider);

  // Find token registry PDA
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), deskPubkey.toBuffer(), elizaosMint.toBuffer()],
    programId
  );

  console.log("Token Registry PDA:", registryPda.toBase58());

  // Check current registry state
  try {
    const registry = await program.account.tokenRegistry.fetch(registryPda);
    console.log("\nCurrent Registry State:");
    console.log("  Desk:", registry.desk.toBase58());
    console.log("  Token Mint:", registry.tokenMint.toBase58());
    console.log("  Pool Address:", registry.poolAddress.toBase58());
    console.log("  Pool Type:", Object.keys(registry.poolType)[0]);
    console.log("  Price (8d):", registry.tokenUsdPrice8d.toString());
    console.log("  Last Update:", new Date(registry.pricesUpdatedAt.toNumber() * 1000).toISOString());
    console.log("  Registered By:", registry.registeredBy.toBase58());

    // Check if signer is authorized
    const desk = await program.account.desk.fetch(deskPubkey);
    const isOwner = desk.owner.equals(keypair.publicKey);
    const isRegistrant = registry.registeredBy.equals(keypair.publicKey);

    console.log("\nAuthorization:");
    console.log("  Is Owner:", isOwner);
    console.log("  Is Registrant:", isRegistrant);

    if (!isOwner && !isRegistrant) {
      console.error("\nERROR: Signer is neither owner nor registrant. Cannot update pool config.");
      console.log("  Desk Owner:", desk.owner.toBase58());
      console.log("  Token Registrant:", registry.registeredBy.toBase58());
      console.log("  Current Signer:", keypair.publicKey.toBase58());
      process.exit(1);
    }

    // Configure pool
    console.log("\nConfiguring PumpSwap pool for ELIZAOS...");
    console.log("  Pool Address:", elizaosBondingCurve.toBase58());
    console.log("  Pool Type: PumpSwap (3)");

    const tx = await program.methods
      .setTokenPoolConfig(elizaosBondingCurve, PoolType.PumpSwap)
      .accounts({
        tokenRegistry: registryPda,
        desk: deskPubkey,
        signer: keypair.publicKey,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ])
      .rpc();

    console.log("\nTransaction:", tx);
    console.log("Pool configured successfully.");

    // Verify
    const updatedRegistry = await program.account.tokenRegistry.fetch(registryPda);
    console.log("\nUpdated Registry State:");
    console.log("  Pool Address:", updatedRegistry.poolAddress.toBase58());
    console.log("  Pool Type:", Object.keys(updatedRegistry.poolType)[0]);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch(console.error);

