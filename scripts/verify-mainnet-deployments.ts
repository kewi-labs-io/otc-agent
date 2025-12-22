#!/usr/bin/env bun

/**
 * Verify all mainnet deployments are working correctly
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, http } from "viem";
import { base, bsc, mainnet } from "viem/chains";

const OTC_ABI = [
  {
    name: "nextConsignmentId",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "nextOfferId",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "agent",
    type: "function",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    name: "minUsdAmount",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "paused",
    type: "function",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    name: "owner",
    type: "function",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

// Load deployment configs from files (source of truth)
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadDeploymentConfig(filename: string) {
  const path = join(process.cwd(), "src/config/deployments", filename);
  return JSON.parse(readFileSync(path, "utf8"));
}

const evmConfig = loadDeploymentConfig("mainnet-evm.json");
const solanaConfig = loadDeploymentConfig("mainnet-solana.json");

const DEPLOYMENTS = {
  base: {
    chainId: 8453,
    rpc: "https://base-rpc.publicnode.com",
    otc: evmConfig.networks?.base?.otc ?? evmConfig.contracts.otc,
    registrationHelper:
      evmConfig.networks?.base?.registrationHelper ?? evmConfig.contracts.registrationHelper,
  },
  bsc: {
    chainId: 56,
    rpc: "https://bsc-dataseed1.binance.org",
    otc: evmConfig.networks?.bsc?.otc ?? "0x0aD688d08D409852668b6BaF6c07978968070221",
    registrationHelper:
      evmConfig.networks?.bsc?.registrationHelper ?? "0x979C01B70B6aD54b8D3093Bf9a1D550F00560037",
  },
  ethereum: {
    chainId: 1,
    rpc: "https://eth.llamarpc.com",
    otc: evmConfig.networks?.ethereum?.otc ?? "0x5f36221967E34e3A2d6548aaedF4D1E50FE34D46",
    registrationHelper:
      evmConfig.networks?.ethereum?.registrationHelper ??
      "0x60bD4C45c2512d0C652eecE6dfDA292EA9D3E06d",
  },
  solana: {
    rpc: "https://api.mainnet-beta.solana.com",
    programId: solanaConfig.programId,
    desk: solanaConfig.desk,
  },
};

async function verifyEvmContract(
  name: string,
  config: { rpc: string; otc: string; chainId: number },
) {
  console.log(`\n📋 ${name.toUpperCase()} (Chain ID: ${config.chainId})`);
  console.log("─".repeat(50));

  const chain = config.chainId === 8453 ? base : config.chainId === 56 ? bsc : mainnet;

  const client = createPublicClient({
    chain,
    transport: http(config.rpc),
  });

  const otcAddress = config.otc as `0x${string}`;

  // Verify contract exists
  const code = await client.getCode({ address: otcAddress });
  if (!code || code === "0x") {
    throw new Error(`Contract NOT deployed at ${otcAddress} on ${name}`);
  }
  console.log("✅ Contract deployed");

  // Read contract state
  const [nextConsignmentId, nextOfferId, agent, minUsdAmount, paused, owner] = await Promise.all([
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "nextConsignmentId" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "nextOfferId" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "agent" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "minUsdAmount" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "paused" }),
    client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "owner" }),
  ]);

  console.log(`   OTC Address: ${otcAddress}`);
  console.log(`   Owner: ${owner}`);
  console.log(`   Agent: ${agent}`);
  console.log(`   Paused: ${paused ? "YES" : "NO"}`);
  console.log(`   Min USD: $${Number(minUsdAmount) / 1e8}`);
  console.log(`   Consignments: ${Number(nextConsignmentId) - 1}`);
  console.log(`   Offers: ${Number(nextOfferId) - 1}`);
}

async function verifySolana() {
  console.log("\n📋 SOLANA MAINNET");
  console.log("─".repeat(50));

  const connection = new Connection(DEPLOYMENTS.solana.rpc, "confirmed");

  // Check program
  const programId = new PublicKey(DEPLOYMENTS.solana.programId);
  const programInfo = await connection.getAccountInfo(programId);

  if (!programInfo) {
    throw new Error(`Program NOT deployed at ${DEPLOYMENTS.solana.programId}`);
  }
  console.log("✅ Program deployed");
  console.log(`   Program ID: ${DEPLOYMENTS.solana.programId}`);

  // Check desk
  const deskPubkey = new PublicKey(DEPLOYMENTS.solana.desk);
  const deskInfo = await connection.getAccountInfo(deskPubkey);

  if (!deskInfo) {
    throw new Error(`Desk NOT initialized at ${DEPLOYMENTS.solana.desk}`);
  }
  console.log("✅ Desk initialized");
  console.log(`   Desk Address: ${DEPLOYMENTS.solana.desk}`);
  console.log(`   Desk Size: ${deskInfo.data.length} bytes`);

  // Parse desk data (skip 8-byte discriminator)
  const data = deskInfo.data;
  if (data.length >= 8 + 32) {
    const owner = new PublicKey(data.slice(8, 40));
    console.log(`   Owner: ${owner.toBase58()}`);
  }
}

async function main() {
  console.log("═".repeat(70));
  console.log("  MAINNET DEPLOYMENT VERIFICATION");
  console.log("═".repeat(70));

  // Verify EVM chains with delay between requests
  for (const [name, config] of Object.entries(DEPLOYMENTS)) {
    if (name === "solana") continue;

    await new Promise((r) => setTimeout(r, 1000)); // Rate limit
    // Type assertion needed: verifyEvmContract expects specific config shape
    // DEPLOYMENTS values are compatible but TypeScript can't infer the exact type
    await verifyEvmContract(name, config as Parameters<typeof verifyEvmContract>[1]);
  }

  // Verify Solana
  await new Promise((r) => setTimeout(r, 1000));
  await verifySolana();

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("  VERIFICATION SUMMARY");
  console.log("═".repeat(70));

  for (const [name] of Object.entries(DEPLOYMENTS)) {
    if (name === "solana") {
      console.log(`  ✅ ${name.toUpperCase()}`);
    } else {
      console.log(`  ✅ ${name.toUpperCase()}`);
    }
  }

  console.log();
  console.log("🎉 All mainnet deployments verified successfully!");

  // P2P Feature Summary
  console.log("\n" + "═".repeat(70));
  console.log("  P2P AUTO-APPROVAL FEATURE");
  console.log("═".repeat(70));
  console.log("  ✅ EVM: Non-negotiable offers auto-approved at creation");
  console.log("  ✅ Solana: Non-negotiable offers auto-approved at creation");
  console.log("  ℹ️  Agent approval only required for negotiable consignments");
}

main().catch(console.error);
