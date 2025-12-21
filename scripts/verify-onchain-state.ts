#!/usr/bin/env bun
/**
 * On-Chain State Verification Script
 * Verifies the deployed state of OTC contracts on all chains
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createPublicClient, http, type Address } from "viem";
import { base, bsc, mainnet } from "viem/chains";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

// Load configs
const mainnetEvmConfigRaw = JSON.parse(fs.readFileSync("src/config/deployments/mainnet-evm.json", "utf8"));
const mainnetSolanaConfig = JSON.parse(fs.readFileSync("src/config/deployments/mainnet-solana.json", "utf8"));
const baseConfigRaw = JSON.parse(fs.readFileSync("src/config/deployments/base-mainnet.json", "utf8"));

// Validate config structure
if (!mainnetEvmConfigRaw.networks) {
  throw new Error("mainnet-evm.json missing 'networks' field");
}
const mainnetEvmConfig = mainnetEvmConfigRaw as { networks: { bsc?: { otc: string }; ethereum?: { otc: string } } };

if (!baseConfigRaw.contracts) {
  throw new Error("base-mainnet.json missing 'contracts' field");
}
const baseConfig = baseConfigRaw as { contracts: { otc: string } };

const HELIUS_KEY = process.env.HELIUS_API_KEY;

// ABIs
const OTC_ABI = [
  { name: "nextConsignmentId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "nextOfferId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "agent", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "approver", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "consignments", type: "function", inputs: [{ type: "uint256" }], outputs: [
    { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }
  ], stateMutability: "view" },
  { name: "offers", type: "function", inputs: [{ type: "uint256" }], outputs: [
    { type: "uint256" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint8" }, { type: "bool" }, { type: "bool" },
    { type: "bool" }, { type: "bool" }, { type: "bool" }, { type: "address" }, { type: "uint256" }, { type: "uint16" }
  ], stateMutability: "view" },
] as const;

async function verifyEvm(chainName: string, chain: typeof base, otcAddress: Address, rpcUrl: string) {
  console.log("\n📊 Verifying " + chainName + "...");
  console.log("   Contract: " + otcAddress);

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Check contract exists
  const code = await client.getBytecode({ address: otcAddress });
  if (!code || code === "0x") {
    throw new Error(`Contract not deployed at ${otcAddress} on ${chainName}`);
  }

  // Read state
  const [nextConsignmentId, nextOfferId, owner, agent] = await Promise.all([
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "nextConsignmentId" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "nextOfferId" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "owner" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "agent" }),
  ]);

  console.log("   ✅ Contract deployed");
  console.log("   Owner: " + owner);
  console.log("   Agent: " + agent);
  console.log("   Next Consignment ID: " + nextConsignmentId);
  console.log("   Next Offer ID: " + nextOfferId);

  // Count active consignments and offers
  let activeOffers = 0;
  let p2pOffers = 0;
  let negotiableOffers = 0;
  let paidOffers = 0;
  let claimedOffers = 0;

  // Check offers
  for (let i = 1n; i < (nextOfferId as bigint); i++) {
    const offer = await client.readContract({
      address: otcAddress,
      abi: OTC_ABI,
      functionName: "offers",
      args: [i],
    });
    
    const approved = offer[11] as boolean;
    const paid = offer[12] as boolean;
    const executed = offer[13] as boolean;
    const cancelled = offer[14] as boolean;
    const commissionBps = offer[17] as number;
    
    if (!cancelled) {
      activeOffers++;
      if (commissionBps === 0 || commissionBps === 0n) {
        p2pOffers++;
      } else {
        negotiableOffers++;
      }
      if (paid) paidOffers++;
      if (executed) claimedOffers++;
    }
  }

  console.log("   Active Offers: " + activeOffers);
  console.log("   P2P Offers (commission=0): " + p2pOffers);
  console.log("   Negotiable Offers: " + negotiableOffers);
  console.log("   Paid Offers: " + paidOffers);
  console.log("   Claimed/Executed: " + claimedOffers);
}

async function verifySolana() {
  console.log("\n📊 Verifying Solana...");

  if (!HELIUS_KEY) {
    throw new Error("HELIUS_API_KEY is required for Solana verification");
  }
  
  const rpcUrl = "https://mainnet.helius-rpc.com/?api-key=" + HELIUS_KEY;
  
  console.log("   Program: " + mainnetSolanaConfig.programId);
  console.log("   Desk: " + mainnetSolanaConfig.desk);
  
  const connection = new Connection(rpcUrl, "confirmed");
  
  // Check program exists
  const programInfo = await connection.getAccountInfo(new PublicKey(mainnetSolanaConfig.programId));
  if (!programInfo) {
    throw new Error(`Program not deployed at ${mainnetSolanaConfig.programId}`);
  }
  
  console.log("   ✅ Program deployed (" + programInfo.data.length + " bytes)");

  // Check desk exists
  const deskPubkey = new PublicKey(mainnetSolanaConfig.desk);
  const deskInfo = await connection.getAccountInfo(deskPubkey);
  if (!deskInfo) {
    throw new Error(`Desk account not found at ${mainnetSolanaConfig.desk}`);
  }
  console.log("   ✅ Desk account exists (" + deskInfo.data.length + " bytes)");
  console.log("   Desk Owner: " + deskInfo.owner.toBase58());
  
  // Parse desk data (first 8 bytes are discriminator)
  // Next 32 bytes is owner pubkey
  const ownerBytes = deskInfo.data.slice(8, 40);
  const owner = new PublicKey(ownerBytes);
  console.log("   Desk Owner Key: " + owner.toBase58());

  // Get desk balance
  const deskBalance = await connection.getBalance(deskPubkey);
  console.log("   Desk SOL Balance: " + (deskBalance / LAMPORTS_PER_SOL));
}

async function main() {
  console.log("═".repeat(70));
  console.log("  ON-CHAIN STATE VERIFICATION");
  console.log("═".repeat(70));

  // Verify Base
  if (!baseConfig.contracts.otc) {
    throw new Error("Base config missing OTC contract address");
  }
  await verifyEvm(
    "Base", 
    base, 
    baseConfig.contracts.otc as Address,
    "https://mainnet.base.org"
  );

  // Verify BSC
  if (mainnetEvmConfig.networks?.bsc) {
    if (!mainnetEvmConfig.networks.bsc.otc) {
      throw new Error("BSC network config exists but missing OTC address");
    }
    await verifyEvm(
      "BSC",
      bsc,
      mainnetEvmConfig.networks.bsc.otc as Address,
      "https://bsc-dataseed1.binance.org"
    );
  }

  // Verify Ethereum
  if (mainnetEvmConfig.networks?.ethereum) {
    if (!mainnetEvmConfig.networks.ethereum.otc) {
      throw new Error("Ethereum network config exists but missing OTC address");
    }
    await verifyEvm(
      "Ethereum",
      mainnet,
      mainnetEvmConfig.networks.ethereum.otc as Address,
      "https://eth.llamarpc.com"
    );
  }

  // Verify Solana
  await verifySolana();

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("  VERIFICATION SUMMARY");
  console.log("═".repeat(70));
  console.log("\n✅ All contracts verified on-chain");
}

main().catch(console.error);
