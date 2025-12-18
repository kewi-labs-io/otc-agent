/**
 * Test: Execute lazy price update for Solana
 * This actually updates the on-chain price
 */
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import mainnetSolana from "../src/config/deployments/mainnet-solana.json";
import idl from "../src/contracts/solana-otc.idl.json";

async function fetchCoinGeckoPrice(mint: string): Promise<number | null> {
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`
    );
    const data = await resp.json();
    if (data[mint] && data[mint].usd) {
      return data[mint].usd;
    }
  } catch (error) {
    console.error(`CoinGecko error:`, error);
  }
  return null;
}

async function main() {
  console.log("=== Solana Lazy Update Execution Test ===\n");
  
  const connection = new Connection(mainnetSolana.rpc, "confirmed");
  const programId = new PublicKey(mainnetSolana.programId);
  const deskPubkey = new PublicKey(mainnetSolana.desk);
  const registryPda = new PublicKey(mainnetSolana.registeredTokens.ELIZAOS.registry);
  const tokenMint = mainnetSolana.registeredTokens.ELIZAOS.mint;
  
  // Get signer
  const signerKey = process.env.SOLANA_PRIVATE_KEY;
  if (!signerKey) {
    console.error("SOLANA_PRIVATE_KEY not set - cannot execute update");
    process.exit(1);
  }
  
  const keypair = Keypair.fromSecretKey(bs58.decode(signerKey));
  console.log("Signer:", keypair.publicKey.toBase58());
  
  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  
  if (balance < 10000) {
    console.error("Insufficient SOL balance for transaction");
    process.exit(1);
  }
  
  // Get current on-chain price
  const accountInfo = await connection.getAccountInfo(registryPda);
  if (!accountInfo) {
    console.error("Registry not found");
    process.exit(1);
  }
  
  const data = accountInfo.data;
  const offset = 8 + 32 + 32 + 1 + 32 + 32 + 1;
  const oldPrice8d = data.readBigUInt64LE(offset + 1);
  const oldPriceUsd = Number(oldPrice8d) / 1e8;
  console.log(`\nOld on-chain price: $${oldPriceUsd.toFixed(8)}`);
  
  // Fetch new price
  const newPriceUsd = await fetchCoinGeckoPrice(tokenMint);
  if (!newPriceUsd) {
    console.error("Failed to fetch price");
    process.exit(1);
  }
  console.log(`New market price: $${newPriceUsd.toFixed(8)}`);
  
  // Update on-chain
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idl as never, provider);
  
  const price8d = Math.floor(newPriceUsd * 1e8);
  
  console.log("\nExecuting on-chain update...");
  
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
  
  console.log(`Transaction: ${tx}`);
  
  // Verify update
  const newAccountInfo = await connection.getAccountInfo(registryPda);
  if (newAccountInfo) {
    const newData = newAccountInfo.data;
    const updatedPrice8d = newData.readBigUInt64LE(offset + 1);
    const updatedAt = newData.readBigInt64LE(offset + 1 + 8);
    const updatedPriceUsd = Number(updatedPrice8d) / 1e8;
    
    console.log(`\n=== Update Verified ===`);
    console.log(`Old price: $${oldPriceUsd.toFixed(8)}`);
    console.log(`New price: $${updatedPriceUsd.toFixed(8)}`);
    console.log(`Updated at: ${new Date(Number(updatedAt) * 1000).toISOString()}`);
    
    if (Math.abs(updatedPriceUsd - newPriceUsd) < 0.00001) {
      console.log("\n✅ PRICE UPDATE SUCCESSFUL");
    } else {
      console.log("\n❌ Price mismatch after update");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

