#!/usr/bin/env bun
/**
 * Test script to debug Solana approval flow
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";

if (!process.env.HELIUS_RPC_URL) {
  throw new Error("HELIUS_RPC_URL environment variable is required");
}
const SOLANA_RPC = process.env.HELIUS_RPC_URL;
const PROGRAM_ID = new PublicKey("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");
const DESK = new PublicKey("EDzQZXDT3iZcXxkp56vb7LLJ1tgaTn1gbf1CgWQuKXtY");
const ELIZAOS_MINT = new PublicKey("DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA");

async function main() {
  console.log("=== SOLANA APPROVAL TEST ===\n");

  // Load user/approver keypair
  const privateKey = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SOLANA_MAINNET_PRIVATE_KEY not set");
  }
  const secretKey = bs58.decode(privateKey);
  const wallet = Keypair.fromSecretKey(secretKey);
  console.log("Wallet:", wallet.publicKey.toBase58());

  // Load desk keypair (needed for fulfillment)
  const deskKeypairPath = path.join(process.cwd(), "solana/otc-program/desk-mainnet-keypair.json");
  const deskKeypairData = JSON.parse(fs.readFileSync(deskKeypairPath, "utf8"));
  const deskKeypair = Keypair.fromSecretKey(Uint8Array.from(deskKeypairData));
  console.log("Desk Keypair:", deskKeypair.publicKey.toBase58());

  // Connect
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("SOL Balance:", balance / 1e9);

  // Load IDL
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  // Create provider
  const anchorWallet = new anchor.Wallet(wallet);
  const provider = new anchor.AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider);

  interface DeskAccountProgram {
    desk: {
      fetch: (pubkey: PublicKey) => Promise<{
        owner: PublicKey;
        agent: PublicKey;
        nextConsignmentId: { toString(): string; toNumber(): number };
        nextOfferId: { toString(): string };
        minUsdAmount8D: { toString(): string; toNumber(): number };
        solUsdPrice8D: { toString(): string; toNumber(): number };
        paused: boolean;
      }>;
    };
    tokenRegistry: {
      fetch: (pubkey: PublicKey) => Promise<{
        tokenUsdPrice8D: { toString(): string };
        decimals: number;
        isActive: boolean;
      }>;
    };
    consignment: {
      fetch: (pubkey: PublicKey) => Promise<{
        remainingAmount: { toString(): string; toNumber(): number };
      }>;
    };
  }

  // Check desk state
  console.log("\n--- Desk State ---");
  const programAccounts = program.account as DeskAccountProgram;
  let deskAccount = await programAccounts.desk.fetch(DESK);
  console.log("Owner:", deskAccount.owner.toBase58());
  console.log("Agent:", deskAccount.agent.toBase58());
  console.log("Next Consignment ID:", deskAccount.nextConsignmentId.toString());
  console.log("Next Offer ID:", deskAccount.nextOfferId.toString());
  console.log("Min USD (8d):", deskAccount.minUsdAmount8D.toString());
  console.log("SOL USD Price (8d):", deskAccount.solUsdPrice8D.toString());
  console.log("Paused:", deskAccount.paused);

  // Set SOL price if not set (needed for fulfillment)
  if (deskAccount.solUsdPrice8D.toNumber() === 0) {
    console.log("\n--- Setting SOL Price ---");
    const tokenPrice8d = new anchor.BN(356709); // Current ELIZAOS price
    const solPrice8d = new anchor.BN(20000000000); // $200 in 8 decimals
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 3600; // 1 hour

    await program.methods
      .setPrices(tokenPrice8d, solPrice8d, new anchor.BN(now), new anchor.BN(maxAge))
      .accounts({
        owner: wallet.publicKey,
        desk: DESK,
      })
      .rpc();
    console.log("SOL price set to $200, token price set");

    // Refresh desk account
    deskAccount = await programAccounts.desk.fetch(DESK);
    console.log("New SOL USD Price (8d):", deskAccount.solUsdPrice8D.toString());
  }

  // Check token registry
  console.log("\n--- Token Registry ---");
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), DESK.toBuffer(), ELIZAOS_MINT.toBuffer()],
    PROGRAM_ID,
  );
  console.log("Registry PDA:", tokenRegistryPda.toBase58());

  const registryInfo = await connection.getAccountInfo(tokenRegistryPda);
  if (!registryInfo) {
    console.log("Token registry not found - need to register token first");
    return;
  }

  const registry = await programAccounts.tokenRegistry.fetch(tokenRegistryPda);
  console.log("Price (8d):", registry.tokenUsdPrice8D.toString());
  console.log("Decimals:", registry.decimals);
  console.log("Active:", registry.isActive);

  // Check user's token balance
  console.log("\n--- User Token Balance ---");
  const userAta = await getAssociatedTokenAddress(ELIZAOS_MINT, wallet.publicKey);
  const ataInfo = await connection.getTokenAccountBalance(userAta);
  console.log("User ATA:", userAta.toBase58());
  console.log("Balance:", ataInfo.value.uiAmount, "ELIZAOS");

  // Check desk treasury
  const deskTreasury = await getAssociatedTokenAddress(ELIZAOS_MINT, DESK, true);
  console.log("\nDesk Treasury:", deskTreasury.toBase58());
  const treasuryInfo = await connection.getAccountInfo(deskTreasury);
  if (treasuryInfo) {
    const treasuryBalance = await connection.getTokenAccountBalance(deskTreasury);
    console.log("Treasury Balance:", treasuryBalance.value.uiAmount, "ELIZAOS");
  } else {
    console.log("Treasury not created yet");
  }

  // Step 1: Create a consignment
  console.log("\n--- Creating Consignment ---");
  const consignmentKeypair = Keypair.generate();
  const depositAmount = new anchor.BN(10 * 1e9); // 10 tokens in lamports (9 decimals)
  const minDeal = new anchor.BN(1 * 1e9); // 1 token minimum

  const createConsignmentTx = await program.methods
    .createConsignment(
      depositAmount,
      true, // negotiable
      1000, // 10% discount
      180, // 180 days lockup
      500, // min discount
      2000, // max discount
      7, // min lockup
      365, // max lockup
      minDeal,
      depositAmount, // max deal
      true, // fractionalized
      false, // not private
      1000, // volatility
      new anchor.BN(1800), // max time
    )
    .accounts({
      desk: DESK,
      consigner: wallet.publicKey,
      tokenMint: ELIZAOS_MINT,
      consignerTokenAta: userAta,
      deskTokenTreasury: deskTreasury,
      consignment: consignmentKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([consignmentKeypair])
    .rpc();

  console.log("Consignment created:", createConsignmentTx);
  console.log("Consignment address:", consignmentKeypair.publicKey.toBase58());

  // Get consignment ID from desk
  const deskAfter = await programAccounts.desk.fetch(DESK);
  const consignmentId = deskAfter.nextConsignmentId.toNumber() - 1;
  console.log("Consignment ID:", consignmentId);

  // Step 2: Create an offer FROM the consignment
  console.log("\n--- Creating Offer From Consignment ---");
  const offerKeypair = Keypair.generate();
  const offerAmount = new anchor.BN(5 * 1e9); // 5 tokens
  const nextOfferId = deskAfter.nextOfferId;

  const createOfferTx = await program.methods
    .createOfferFromConsignment(
      new anchor.BN(consignmentId), // consignment_id
      offerAmount, // token_amount
      1000, // discount_bps (10%)
      0, // currency (0 = SOL)
      new anchor.BN(180 * 86400), // lockup_secs
      25, // agent_commission_bps (0.25%)
    )
    .accounts({
      desk: DESK,
      consignment: consignmentKeypair.publicKey,
      tokenRegistry: tokenRegistryPda,
      deskTokenTreasury: deskTreasury,
      beneficiary: wallet.publicKey,
      offer: offerKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([offerKeypair])
    .rpc();

  console.log("Offer created:", createOfferTx);
  console.log("Offer address:", offerKeypair.publicKey.toBase58());
  console.log("Offer ID:", nextOfferId.toString());

  // Step 3: Approve the offer
  console.log("\n--- Approving Offer ---");

  const approveTx = await program.methods
    .approveOffer(nextOfferId)
    .accounts({
      desk: DESK,
      offer: offerKeypair.publicKey,
      consignment: consignmentKeypair.publicKey,
      approver: wallet.publicKey,
    })
    .rpc();

  console.log("Offer approved:", approveTx);

  // Step 4: Fulfill with SOL
  console.log("\n--- Fulfilling Offer with SOL ---");

  const fulfillTx = await program.methods
    .fulfillOfferSol(nextOfferId)
    .accounts({
      desk: DESK,
      offer: offerKeypair.publicKey,
      deskTokenTreasury: deskTreasury,
      agent: deskAccount.agent, // Agent receives commission
      deskSigner: deskKeypair.publicKey, // Desk keypair signs
      payer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([deskKeypair]) // Desk keypair must sign
    .rpc();

  console.log("Offer fulfilled:", fulfillTx);

  // Step 5: Withdraw remaining tokens from consignment
  console.log("\n--- Withdrawing Remaining Tokens ---");

  // Check remaining balance
  const consignmentAfter = await programAccounts.consignment.fetch(consignmentKeypair.publicKey);
  const remainingAmount = consignmentAfter.remainingAmount.toNumber();
  console.log("Remaining in consignment:", remainingAmount / 1e9, "tokens");

  if (remainingAmount > 0) {
    const withdrawTx = await program.methods
      .withdrawConsignment(new anchor.BN(consignmentId))
      .accounts({
        consignment: consignmentKeypair.publicKey,
        desk: DESK,
        tokenMint: ELIZAOS_MINT,
        deskSigner: deskKeypair.publicKey,
        consigner: wallet.publicKey,
        deskTokenTreasury: deskTreasury,
        consignerTokenAta: userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([deskKeypair]) // Desk signer must sign
      .rpc();

    console.log("Withdrawal complete:", withdrawTx);
  } else {
    console.log("Nothing to withdraw - consignment is empty");
  }

  console.log("\n=== SUCCESS ===");
}

main().catch(console.error);
