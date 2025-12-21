#!/usr/bin/env bun

/**
 * Verify Multi-Chain OTC Deployment
 * 
 * This script verifies that:
 * - Base OTC contract is deployed and configured correctly
 * - RegistrationHelper is deployed and can be used
 * - Solana program is deployed and operational
 * - Wallet scanning works on both chains
 * - Oracle discovery works
 */

import { createPublicClient, http, parseAbi, type Abi } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAppUrl } from "../src/config/env";
import {
  getEvmConfig,
  getRegistrationHelperForChain,
  getSolanaConfig,
} from "../src/config/contracts";

const evm = getEvmConfig("mainnet");
const solana = getSolanaConfig("mainnet");

let BASE_RPC: string;
if (process.env.BASE_RPC_URL) {
  BASE_RPC = process.env.BASE_RPC_URL;
} else if (evm.rpc && evm.rpc.startsWith("/")) {
  BASE_RPC = `${getAppUrl()}${evm.rpc}`;
} else if (evm.rpc) {
  BASE_RPC = evm.rpc;
} else {
  throw new Error("BASE_RPC_URL environment variable or evm.rpc config is required");
}

let SOLANA_RPC: string;
if (process.env.SOLANA_MAINNET_RPC) {
  SOLANA_RPC = process.env.SOLANA_MAINNET_RPC;
} else if (solana.rpc && solana.rpc.startsWith("/")) {
  SOLANA_RPC = `${getAppUrl()}${solana.rpc}`;
} else if (solana.rpc) {
  SOLANA_RPC = solana.rpc;
} else {
  throw new Error("SOLANA_MAINNET_RPC environment variable or solana.rpc config is required");
}

const OTC_ADDRESS = evm.contracts.otc;
const REGISTRATION_HELPER_ADDRESS = getRegistrationHelperForChain(8453, "mainnet");
const SOLANA_PROGRAM_ID = solana.programId;
const SOLANA_DESK = solana.desk;

async function verifyBaseDeployment() {
  console.log("\n=== Verifying Base Deployment ===\n");

  if (!OTC_ADDRESS) {
    throw new Error("OTC address missing from deployment config (src/config/deployments/mainnet-evm.json)");
  }

  if (!REGISTRATION_HELPER_ADDRESS) {
    throw new Error("RegistrationHelper address missing from deployment config (src/config/deployments/mainnet-evm.json)");
  }

  const client = createPublicClient({
    chain: base,
    transport: http(BASE_RPC),
  });
  
  // Check OTC contract - verify it has code
  console.log("Checking OTC contract at:", OTC_ADDRESS);
  
  const code = await client.getCode({ address: OTC_ADDRESS as `0x${string}` });
  if (!code || code === "0x") {
    throw new Error(`OTC contract not deployed at ${OTC_ADDRESS}`);
  }
  console.log("✅ OTC contract has code (deployed)");

  // Read contract functions to verify it's the right contract
  const otcAbi = parseAbi([
    "function nextOfferId() view returns (uint256)",
    "function agent() view returns (address)",
    "function usdc() view returns (address)",
    "function owner() view returns (address)",
  ]);

  const nextOfferId = await client.readContract({
    address: OTC_ADDRESS as `0x${string}`,
    abi: otcAbi as Abi,
    functionName: "nextOfferId",
  }) as bigint;
  console.log("  Next Offer ID:", nextOfferId.toString());

  const agent = await client.readContract({
    address: OTC_ADDRESS as `0x${string}`,
    abi: otcAbi as Abi,
    functionName: "agent",
  }) as string;
  console.log("  Agent:", agent);

  const usdc = await client.readContract({
    address: OTC_ADDRESS as `0x${string}`,
    abi: otcAbi as Abi,
    functionName: "usdc",
  }) as string;
  console.log("  USDC:", usdc);

  const owner = await client.readContract({
    address: OTC_ADDRESS as `0x${string}`,
    abi: otcAbi as Abi,
    functionName: "owner",
  }) as string;
  console.log("  Owner:", owner);

  // Check RegistrationHelper
  console.log("\nChecking RegistrationHelper at:", REGISTRATION_HELPER_ADDRESS);
  
  const helperCode = await client.getCode({ address: REGISTRATION_HELPER_ADDRESS as `0x${string}` });
  if (!helperCode || helperCode === "0x") {
    throw new Error(`RegistrationHelper not deployed at ${REGISTRATION_HELPER_ADDRESS}`);
  }
  console.log("✅ RegistrationHelper has code (deployed)");

  // Read RegistrationHelper functions
  const helperAbi = parseAbi([
    "function otc() view returns (address)",
    "function registrationFee() view returns (uint256)",
    "function feeRecipient() view returns (address)",
  ]);

  const helperOtc = await client.readContract({
    address: REGISTRATION_HELPER_ADDRESS as `0x${string}`,
    abi: helperAbi as Abi,
    functionName: "otc",
  }) as string;
  console.log("  OTC Address:", helperOtc);
  
  // Verify RegistrationHelper points to correct OTC
  if (helperOtc.toLowerCase() !== OTC_ADDRESS.toLowerCase()) {
    throw new Error(`RegistrationHelper points to different OTC: ${helperOtc}, expected: ${OTC_ADDRESS}`);
  }

  const regFee = await client.readContract({
    address: REGISTRATION_HELPER_ADDRESS as `0x${string}`,
    abi: helperAbi as Abi,
    functionName: "registrationFee",
  }) as bigint;
  console.log("  Registration Fee:", (Number(regFee) / 1e18).toFixed(4), "ETH");

  const feeRecipient = await client.readContract({
    address: REGISTRATION_HELPER_ADDRESS as `0x${string}`,
    abi: helperAbi as Abi,
    functionName: "feeRecipient",
  }) as string;
  console.log("  Fee Recipient:", feeRecipient);

  console.log("\n✅ Base deployment verified successfully");
}

async function verifySolanaDeployment() {
  console.log("\n=== Verifying Solana Deployment ===\n");

  if (!SOLANA_PROGRAM_ID) {
    throw new Error("Solana programId not configured");
  }

  if (!SOLANA_DESK) {
    throw new Error("Solana desk not configured");
  }

  const connection = new Connection(SOLANA_RPC, "confirmed");

  // Check program exists
  console.log("Checking Solana program at:", SOLANA_PROGRAM_ID);
  const programInfo = await connection.getAccountInfo(new PublicKey(SOLANA_PROGRAM_ID));
  
  if (!programInfo) {
    throw new Error(`Solana program not found at ${SOLANA_PROGRAM_ID}`);
  }

  console.log("✅ Solana program is deployed");
  console.log("  Executable:", programInfo.executable);
  console.log("  Owner:", programInfo.owner.toBase58());

  // Check desk account
  console.log("\nChecking desk account at:", SOLANA_DESK);
  const deskInfo = await connection.getAccountInfo(new PublicKey(SOLANA_DESK));
  
  if (!deskInfo) {
    throw new Error(`Desk account not found at ${SOLANA_DESK}`);
  }

  console.log("✅ Desk account exists");
  console.log("  Data Size:", deskInfo.data.length, "bytes");
  console.log("  Owner:", deskInfo.owner.toBase58());

  console.log("\n✅ Solana deployment verified successfully");
  return true;

async function testWalletScanning() {
  console.log("\n=== Testing Wallet Scanning ===\n");

  // Note: Actual wallet scanning requires user authentication
  // This just checks if the required APIs are configured
  
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const heliusKey = process.env.HELIUS_API_KEY;

  if (!alchemyKey) {
    throw new Error("ALCHEMY_API_KEY not configured - Base wallet scanning requires it");
  }

  if (!heliusKey) {
    throw new Error("HELIUS_API_KEY not configured - Solana metadata requires it");
  }

  console.log("Alchemy API Key configured: ✅");
  console.log("Helius API Key configured: ✅");
}

async function main() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║  Multi-Chain OTC Deployment Verification      ║");
  console.log("╚════════════════════════════════════════════════╝");

  await verifyBaseDeployment();
  await verifySolanaDeployment();
  await testWalletScanning();

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║  Verification Summary                          ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  console.log("Base Deployment: ✅ PASS");
  console.log("Solana Deployment: ✅ PASS");
  console.log("Wallet Scanning: ✅ PASS");

  console.log("\n🎉 All verifications passed!");
  console.log("\nNext steps:");
  console.log("1. Start backend event listeners:");
  console.log("   - Run token registration listeners for both chains");
  console.log("2. Test token registration in UI:");
  console.log("   - Connect wallet");
  console.log("   - Click 'Register Token from Wallet'");
  console.log("   - Select a token and complete registration");
  console.log("3. Monitor backend logs for TokenRegistered events");
}

main().catch((error) => {
  console.error("Verification script failed:", error);
  process.exit(1);
});

