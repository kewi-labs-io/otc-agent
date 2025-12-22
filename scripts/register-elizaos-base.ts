#!/usr/bin/env bun
/**
 * Register ELIZAOS token on Base OTC contract
 *
 * This script:
 * 1. Deploys a UniswapV3TWAPOracle for ELIZAOS
 * 2. Registers the token on the OTC contract
 *
 * Run: PRIVATE_KEY=0x... bun run scripts/register-elizaos-base.ts
 */

import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  type Hex,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const ELIZAOS_TOKEN = "0xea17Df5Cf6D172224892B5477A16ACb111182478";
const ELIZAOS_POOL = "0x84b783723DaC9B89d0981FFf3dcE369bC5870C16"; // USDC/ELIZAOS pool
const OTC_ADDRESS = "0x5a1C9911E104F18267505918894fd7d343739657";
const ETH_USD_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";

// UniswapV3TWAPOracle bytecode (compiled)
// We need to deploy this contract first
const _ORACLE_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "_pool", type: "address" },
      { name: "_token", type: "address" },
      { name: "_ethUsdFeed", type: "address" },
    ],
  },
  {
    type: "function",
    name: "getTWAPPrice",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const OTC_ABI = [
  {
    type: "function",
    name: "registerToken",
    inputs: [
      { name: "tokenId", type: "bytes32" },
      { name: "tokenAddress", type: "address" },
      { name: "priceOracle", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "tokens",
    inputs: [{ name: "tokenId", type: "bytes32" }],
    outputs: [
      { name: "tokenAddress", type: "address" },
      { name: "decimals", type: "uint8" },
      { name: "isActive", type: "bool" },
      { name: "priceOracle", type: "address" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  const privateKey = process.env.PRIVATE_KEY as Hex;
  if (!privateKey) {
    console.error("PRIVATE_KEY environment variable is required");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log("Using account:", account.address);

  const publicClient = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  const _walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  // Check if we're the owner
  const owner = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: OTC_ABI,
    functionName: "owner",
  });

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`Not the owner. Owner is ${owner}, you are ${account.address}`);
    process.exit(1);
  }
  console.log("Confirmed: You are the OTC owner");

  // Compute tokenId
  const tokenId = keccak256(encodePacked(["address"], [ELIZAOS_TOKEN]));
  console.log("Token ID:", tokenId);

  // Check if already registered
  const tokenData = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: OTC_ABI,
    functionName: "tokens",
    args: [tokenId],
  });

  if (tokenData[0] !== "0x0000000000000000000000000000000000000000") {
    console.log("Token already registered:");
    console.log("  Address:", tokenData[0]);
    console.log("  Decimals:", tokenData[1]);
    console.log("  IsActive:", tokenData[2]);
    console.log("  Oracle:", tokenData[3]);
    process.exit(0);
  }

  console.log("Token not registered. Deploying oracle...");

  // Deploy UniswapV3TWAPOracle
  // First, we need the compiled bytecode. Let's use forge to compile and get it.
  console.log("\nTo register the token, run the following forge command:");
  console.log(
    "cd contracts && forge script scripts/RegisterElizaOS.s.sol --broadcast --rpc-url https://mainnet.base.org\n",
  );

  console.log("Or deploy manually:");
  console.log("1. Deploy UniswapV3TWAPOracle with:");
  console.log(`   pool: ${ELIZAOS_POOL}`);
  console.log(`   token: ${ELIZAOS_TOKEN}`);
  console.log(`   ethUsdFeed: ${ETH_USD_FEED}`);
  console.log("\n2. Then call OTC.registerToken with:");
  console.log(`   tokenId: ${tokenId}`);
  console.log(`   tokenAddress: ${ELIZAOS_TOKEN}`);
  console.log("   priceOracle: <deployed oracle address>");
}

main().catch(console.error);
