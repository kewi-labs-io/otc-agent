/**
 * Test EVM Consignment Flow - Direct CLI test
 * Tests the full flow: approve -> createConsignment
 * Uses the same contract calls as the UI but with better error visibility
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  formatEther,
  keccak256,
  encodePacked,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";

dotenv.config();

// Contract addresses
const OTC_ADDRESS = "0x5a1C9911E104F18267505918894fd7d343739657" as Address;
const ELIZAOS_TOKEN = "0xea17Df5Cf6D172224892B5477A16ACb111182478" as Address;
const TOKEN_DECIMALS = 9;

// ABIs
const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

const otcAbi = parseAbi([
  "function requiredGasDepositPerConsignment() view returns (uint256)",
  "function nextConsignmentId() view returns (uint256)",
  "function createConsignment(bytes32 tokenId, uint256 amount, bool isNegotiable, uint16 fixedDiscountBps, uint32 fixedLockupDays, uint16 minDiscountBps, uint16 maxDiscountBps, uint32 minLockupDays, uint32 maxLockupDays, uint256 minDealAmount, uint256 maxDealAmount, uint16 maxPriceVolatilityBps) payable returns (uint256)",
]);

// Compute tokenId (keccak256 of token address - NOT symbol!)
function computeTokenId(tokenAddress: Address): `0x${string}` {
  return keccak256(encodePacked(["address"], [tokenAddress]));
}

async function main() {
  console.log("=== EVM Consignment Flow Test ===\n");

  // Load private key
  let privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY not set in .env");
  }
  // Add 0x prefix if missing
  if (!privateKey.startsWith("0x")) {
    privateKey = `0x${privateKey}`;
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log("Wallet:", account.address);

  // Create clients
  const publicClient = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  // Check ETH balance
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log("ETH Balance:", formatEther(ethBalance), "ETH");

  // Check ELIZAOS balance
  const tokenBalance = await publicClient.readContract({
    address: ELIZAOS_TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log("ELIZAOS Balance:", Number(tokenBalance) / 10 ** TOKEN_DECIMALS, "tokens");

  // Check required gas deposit
  const gasDeposit = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "requiredGasDepositPerConsignment",
  });
  console.log("Required Gas Deposit:", formatEther(gasDeposit), "ETH");

  // Check if we have enough ETH
  if (ethBalance < gasDeposit) {
    throw new Error(`Insufficient ETH. Need ${formatEther(gasDeposit)} ETH, have ${formatEther(ethBalance)}`);
  }

  // Amount to deposit (100 tokens)
  const depositAmount = BigInt(100 * 10 ** TOKEN_DECIMALS);
  console.log("\nDeposit Amount:", Number(depositAmount) / 10 ** TOKEN_DECIMALS, "tokens");

  if (tokenBalance < depositAmount) {
    throw new Error(`Insufficient tokens. Need 100, have ${Number(tokenBalance) / 10 ** TOKEN_DECIMALS}`);
  }

  // Check current allowance
  const currentAllowance = await publicClient.readContract({
    address: ELIZAOS_TOKEN,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, OTC_ADDRESS],
  });
  console.log("Current Allowance:", Number(currentAllowance) / 10 ** TOKEN_DECIMALS, "tokens");

  // Step 1: Approve if needed
  if (currentAllowance < depositAmount) {
    console.log("\n--- Step 1: Approving tokens ---");
    
    // Reset to 0 first if there's an existing allowance (USDT-style)
    if (currentAllowance > 0n) {
      console.log("Resetting allowance to 0 first...");
      const resetHash = await walletClient.writeContract({
        address: ELIZAOS_TOKEN,
        abi: erc20Abi,
        functionName: "approve",
        args: [OTC_ADDRESS, 0n],
      });
      console.log("Reset tx:", resetHash);
      await publicClient.waitForTransactionReceipt({ hash: resetHash });
      console.log("Reset confirmed");
    }

    const approveHash = await walletClient.writeContract({
      address: ELIZAOS_TOKEN,
      abi: erc20Abi,
      functionName: "approve",
      args: [OTC_ADDRESS, depositAmount],
    });
    console.log("Approve tx:", approveHash);

    console.log("Waiting for confirmation...");
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Approval confirmed in block:", approveReceipt.blockNumber);

    // Wait a moment for state propagation, then verify allowance
    console.log("Waiting for state propagation...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify allowance with retries
    let newAllowance = 0n;
    for (let i = 0; i < 5; i++) {
      newAllowance = await publicClient.readContract({
        address: ELIZAOS_TOKEN,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, OTC_ADDRESS],
      });
      if (newAllowance >= depositAmount) break;
      console.log(`Allowance check ${i + 1}: ${Number(newAllowance) / 10 ** TOKEN_DECIMALS} tokens, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log("New Allowance:", Number(newAllowance) / 10 ** TOKEN_DECIMALS, "tokens");
    
    if (newAllowance < depositAmount) {
      throw new Error(`Allowance verification failed. Expected ${Number(depositAmount) / 10 ** TOKEN_DECIMALS}, got ${Number(newAllowance) / 10 ** TOKEN_DECIMALS}`);
    }
  } else {
    console.log("\n--- Step 1: Approval already sufficient ---");
  }

  // Step 2: Create Consignment
  console.log("\n--- Step 2: Creating Consignment ---");

  const tokenId = computeTokenId(ELIZAOS_TOKEN);
  console.log("Token ID:", tokenId);
  console.log("(computed from address:", ELIZAOS_TOKEN, ")");

  // Consignment parameters (matching what the UI sends)
  const params = {
    tokenId,
    amount: depositAmount,
    isNegotiable: true,
    fixedDiscountBps: 1000,    // 10%
    fixedLockupDays: 180,
    minDiscountBps: 500,       // 5%
    maxDiscountBps: 2000,      // 20%
    minLockupDays: 7,
    maxLockupDays: 365,        // NOTE: This was 93 in the failing tx - should be >= fixedLockupDays
    minDealAmount: BigInt(1 * 10 ** TOKEN_DECIMALS),    // 1 token
    maxDealAmount: depositAmount,                        // 100 tokens
    maxPriceVolatilityBps: 1000, // 10%
  };

  console.log("Parameters:", {
    ...params,
    amount: params.amount.toString(),
    minDealAmount: params.minDealAmount.toString(),
    maxDealAmount: params.maxDealAmount.toString(),
  });

  // Simulate first
  console.log("\nSimulating transaction...");
  const { request } = await publicClient.simulateContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "createConsignment",
    args: [
      params.tokenId,
      params.amount,
      params.isNegotiable,
      params.fixedDiscountBps,
      params.fixedLockupDays,
      params.minDiscountBps,
      params.maxDiscountBps,
      params.minLockupDays,
      params.maxLockupDays,
      params.minDealAmount,
      params.maxDealAmount,
      params.maxPriceVolatilityBps,
    ],
    account: account, // Pass full account for proper signing
    value: gasDeposit,
  });
  console.log("Simulation successful");

  // Execute - explicitly include account in request for local signing
  console.log("Sending transaction (signing locally)...");
  const txHash = await walletClient.writeContract({
    ...request,
    account, // Ensure account is included for local signing
  });
  console.log("Transaction hash:", txHash);

  console.log("Waiting for confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("Transaction confirmed in block:", receipt.blockNumber);
  console.log("Status:", receipt.status);

  // Get the new consignment ID
  const nextId = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "nextConsignmentId",
  });
  console.log("\nConsignment created. ID:", Number(nextId) - 1);

  console.log("\n=== SUCCESS ===");
}

main().catch(console.error);
