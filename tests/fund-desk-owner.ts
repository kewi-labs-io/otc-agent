/**
 * Send SOL to desk owner for transaction fees
 */
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import mainnetSolana from "../src/config/deployments/mainnet-solana.json";

async function main() {
  const connection = new Connection(mainnetSolana.rpc, "confirmed");
  
  // Source wallet with SOL
  const sourceKey = "5j9LAUP56hf5Ny45gDzFU1xe1jUjcuJpKUxBtmHuVvDfZuMPXa7GNUNxCfqn2Pmfra3AtJqykbNdmBdW5dbbhi8R";
  const sourceKeypair = Keypair.fromSecretKey(bs58.decode(sourceKey));
  
  // Destination: desk owner
  const deskOwner = new PublicKey(mainnetSolana.deskOwner);
  
  // Amount to send (0.1 SOL should be enough for many transactions)
  const amount = 0.1 * LAMPORTS_PER_SOL;
  
  console.log("Source:", sourceKeypair.publicKey.toBase58());
  console.log("Destination (desk owner):", deskOwner.toBase58());
  console.log("Amount:", amount / LAMPORTS_PER_SOL, "SOL");
  
  // Check source balance
  const sourceBalance = await connection.getBalance(sourceKeypair.publicKey);
  console.log("Source balance:", sourceBalance / LAMPORTS_PER_SOL, "SOL");
  
  if (sourceBalance < amount + 5000) {
    console.error("Insufficient balance");
    process.exit(1);
  }
  
  // Create transfer
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sourceKeypair.publicKey,
      toPubkey: deskOwner,
      lamports: amount,
    })
  );
  
  // Send
  console.log("\nSending transaction...");
  const signature = await sendAndConfirmTransaction(connection, tx, [sourceKeypair]);
  console.log("Transaction:", signature);
  
  // Verify
  const destBalance = await connection.getBalance(deskOwner);
  console.log("\nDesk owner balance:", destBalance / LAMPORTS_PER_SOL, "SOL");
}

main().catch(console.error);

