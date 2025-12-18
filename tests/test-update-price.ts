/**
 * Test script: Update stale ELIZAOS price via manual setting
 */
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "../src/contracts/solana-otc.idl.json";
import mainnetSolana from "../src/config/deployments/mainnet-solana.json";

async function fetchTokenPrice(mint: string): Promise<number | null> {
  // Try CoinGecko first (free, no auth required)
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`
    );
    const data = await resp.json();
    if (data[mint] && data[mint].usd) {
      return data[mint].usd;
    }
  } catch (error) {
    console.error(`CoinGecko error for ${mint}:`, error);
  }
  return null;
}

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC || mainnetSolana.rpc;
  const connection = new Connection(rpcUrl, "confirmed");

  const programId = new PublicKey(mainnetSolana.programId);
  const deskPubkey = new PublicKey(mainnetSolana.desk);

  // ELIZAOS token
  const elizaosMint = mainnetSolana.registeredTokens.ELIZAOS.mint;
  const registryPda = new PublicKey(mainnetSolana.registeredTokens.ELIZAOS.registry);

  // Get signer - needs to be desk owner
  const signerKey = process.env.SOLANA_PRIVATE_KEY;
  if (!signerKey) {
    console.error("SOLANA_PRIVATE_KEY not set");
    process.exit(1);
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));
  console.log("Signer:", keypair.publicKey.toBase58());
  console.log("Desk Owner:", mainnetSolana.deskOwner);

  if (keypair.publicKey.toBase58() !== mainnetSolana.deskOwner) {
    console.error("Signer is not the desk owner - cannot update price");
    process.exit(1);
  }

  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idl as never, provider);

  // Fetch current price from CoinGecko
  console.log("\nFetching current price from CoinGecko...");
  const price = await fetchTokenPrice(elizaosMint);
  
  if (!price) {
    console.error("Failed to fetch price from CoinGecko");
    process.exit(1);
  }

  console.log(`CoinGecko price: $${price.toFixed(8)}`);

  // Convert to 8 decimal fixed point
  const price8d = Math.floor(price * 1e8);
  console.log(`Price in 8 decimals: ${price8d}`);

  // Check current on-chain price
  const accountInfo = await connection.getAccountInfo(registryPda);
  if (!accountInfo) {
    console.error("Registry account not found");
    process.exit(1);
  }

  const data = accountInfo.data;
  const currentPrice8d = data.readBigUInt64LE(8 + 32 + 32 + 1 + 32 + 32 + 1 + 1);
  const pricesUpdatedAt = data.readBigInt64LE(8 + 32 + 32 + 1 + 32 + 32 + 1 + 1 + 8);
  const updatedDate = new Date(Number(pricesUpdatedAt) * 1000);
  const hoursAgo = (Date.now() - updatedDate.getTime()) / (1000 * 60 * 60);

  console.log(`\nCurrent on-chain price: $${(Number(currentPrice8d) / 1e8).toFixed(8)}`);
  console.log(`Last updated: ${updatedDate.toISOString()} (${hoursAgo.toFixed(1)} hours ago)`);

  // Update the price
  console.log("\nUpdating price on-chain...");
  
  try {
    const tx = await program.methods
      .setManualTokenPrice(new BN(price8d))
      .accounts({
        tokenRegistry: registryPda,
        desk: deskPubkey,
        owner: keypair.publicKey,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ])
      .rpc();

    console.log(`\nTransaction: ${tx}`);
    console.log("Price updated successfully");

    // Verify
    const newAccountInfo = await connection.getAccountInfo(registryPda);
    if (newAccountInfo) {
      const newData = newAccountInfo.data;
      const newPrice8d = newData.readBigUInt64LE(8 + 32 + 32 + 1 + 32 + 32 + 1 + 1);
      const newUpdatedAt = newData.readBigInt64LE(8 + 32 + 32 + 1 + 32 + 32 + 1 + 1 + 8);
      console.log(`\nNew on-chain price: $${(Number(newPrice8d) / 1e8).toFixed(8)}`);
      console.log(`Updated at: ${new Date(Number(newUpdatedAt) * 1000).toISOString()}`);
    }
  } catch (error) {
    console.error("Error updating price:", error);
    process.exit(1);
  }
}

main().catch(console.error);

