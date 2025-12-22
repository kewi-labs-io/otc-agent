/**
 * Full EVM OTC Flow Test
 * Tests: approve -> deposit (list) -> create offer (buy) -> backend approve -> verify payment
 *
 * This replicates what happens when a user:
 * 1. Lists tokens on /consign
 * 2. Another user buys tokens via accept-quote-modal
 */

import * as dotenv from "dotenv";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodePacked,
  formatEther,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

dotenv.config();

// Contract addresses (Base mainnet)
const OTC_ADDRESS = "0x5a1C9911E104F18267505918894fd7d343739657" as Address;
const ELIZAOS_TOKEN = "0xea17Df5Cf6D172224892B5477A16ACb111182478" as Address;
const TOKEN_DECIMALS = 9;

// ABIs
const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const otcAbi = parseAbi([
  "function requiredGasDepositPerConsignment() view returns (uint256)",
  "function nextConsignmentId() view returns (uint256)",
  "function nextOfferId() view returns (uint256)",
  "function createConsignment(bytes32 tokenId, uint256 amount, bool isNegotiable, uint16 fixedDiscountBps, uint32 fixedLockupDays, uint16 minDiscountBps, uint16 maxDiscountBps, uint32 minLockupDays, uint32 maxLockupDays, uint256 minDealAmount, uint256 maxDealAmount, uint16 maxPriceVolatilityBps) payable returns (uint256)",
  "function createOfferFromConsignment(uint256 consignmentId, uint256 tokenAmount, uint256 discountBps, uint8 currency, uint256 lockupSeconds, uint16 agentCommissionBps) returns (uint256)",
  "function consignments(uint256 consignmentId) view returns (bytes32 tokenId, address consigner, uint256 totalAmount, uint256 remainingAmount, bool isNegotiable, uint16 fixedDiscountBps, uint32 fixedLockupDays, uint16 minDiscountBps, uint16 maxDiscountBps, uint32 minLockupDays, uint32 maxLockupDays, uint256 minDealAmount, uint256 maxDealAmount, uint16 maxPriceVolatilityBps, bool isActive, uint256 createdAt)",
  "function offers(uint256 offerId) view returns (uint256 consignmentId, address beneficiary, uint256 tokenAmount, uint256 discountBps, uint8 currency, uint256 lockupSeconds, uint256 priceUsdPerToken, uint256 ethUsdPrice, bool approved, bool paid, bool fulfilled, bool cancelled, bytes32 tokenId, uint256 createdAt)",
]);

function computeTokenId(tokenAddress: Address): `0x${string}` {
  return keccak256(encodePacked(["address"], [tokenAddress]));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== Full EVM OTC Flow Test ===\n");

  // Load private key
  let privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY not set in .env");
  }
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

  // Check balances
  const ethBalance = await publicClient.getBalance({ address: account.address });
  const tokenBalance = await publicClient.readContract({
    address: ELIZAOS_TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  const gasDeposit = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "requiredGasDepositPerConsignment",
  });

  console.log("ETH Balance:", formatEther(ethBalance), "ETH");
  console.log("ELIZAOS Balance:", Number(tokenBalance) / 10 ** TOKEN_DECIMALS, "tokens");
  console.log("Required Gas Deposit:", formatEther(gasDeposit), "ETH");

  // Calculate required funds
  const depositAmount = BigInt(50 * 10 ** TOKEN_DECIMALS); // 50 tokens for listing
  const buyAmount = BigInt(25 * 10 ** TOKEN_DECIMALS); // 25 tokens for buying
  const requiredEth = gasDeposit + BigInt(5e14); // gas deposit + buffer for gas fees

  if (ethBalance < requiredEth) {
    throw new Error(
      `Insufficient ETH. Need ${formatEther(requiredEth)} ETH, have ${formatEther(ethBalance)}`,
    );
  }
  if (tokenBalance < depositAmount) {
    throw new Error(
      `Insufficient tokens. Need ${Number(depositAmount) / 10 ** TOKEN_DECIMALS}, have ${Number(tokenBalance) / 10 ** TOKEN_DECIMALS}`,
    );
  }

  // ========== STEP 1: APPROVE TOKENS ==========
  console.log("\n--- Step 1: Approve Tokens ---");

  const currentAllowance = await publicClient.readContract({
    address: ELIZAOS_TOKEN,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, OTC_ADDRESS],
  });
  console.log("Current Allowance:", Number(currentAllowance) / 10 ** TOKEN_DECIMALS, "tokens");

  if (currentAllowance < depositAmount) {
    console.log("Approving", Number(depositAmount) / 10 ** TOKEN_DECIMALS, "tokens...");
    const approveHash = await walletClient.writeContract({
      address: ELIZAOS_TOKEN,
      abi: erc20Abi,
      functionName: "approve",
      args: [OTC_ADDRESS, depositAmount],
    });
    console.log("Approve tx:", approveHash);

    // Wait for confirmation with retries
    console.log("Waiting for confirmation...");
    await sleep(3000);

    for (let i = 0; i < 10; i++) {
      const newAllowance = await publicClient.readContract({
        address: ELIZAOS_TOKEN,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, OTC_ADDRESS],
      });
      if (newAllowance >= depositAmount) {
        console.log("Approval confirmed. Allowance:", Number(newAllowance) / 10 ** TOKEN_DECIMALS);
        break;
      }
      console.log(`Waiting for allowance update... (${i + 1}/10)`);
      await sleep(2000);
    }
  } else {
    console.log("Approval already sufficient");
  }

  // ========== STEP 2: CREATE CONSIGNMENT (LIST) ==========
  console.log("\n--- Step 2: Create Consignment (List) ---");

  const tokenId = computeTokenId(ELIZAOS_TOKEN);
  console.log("Token ID:", tokenId);

  const params = {
    tokenId,
    amount: depositAmount,
    isNegotiable: true,
    fixedDiscountBps: 1000, // 10%
    fixedLockupDays: 180,
    minDiscountBps: 500, // 5%
    maxDiscountBps: 2000, // 20%
    minLockupDays: 7,
    maxLockupDays: 365,
    minDealAmount: BigInt(1 * 10 ** TOKEN_DECIMALS),
    maxDealAmount: depositAmount,
    maxPriceVolatilityBps: 1000,
  };

  console.log(
    "Creating consignment with",
    Number(params.amount) / 10 ** TOKEN_DECIMALS,
    "tokens...",
  );

  const { request: createRequest } = await publicClient.simulateContract({
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
    account,
    value: gasDeposit,
  });

  const createTxHash = await walletClient.writeContract({
    ...createRequest,
    account,
  });
  console.log("Create consignment tx:", createTxHash);

  console.log("Waiting for confirmation...");
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
  console.log("Confirmed in block:", createReceipt.blockNumber);

  // Get consignment ID
  const nextConsignmentId = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "nextConsignmentId",
  });
  const consignmentId = Number(nextConsignmentId) - 1;
  console.log("Consignment created. ID:", consignmentId);

  // Verify consignment
  const consignment = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "consignments",
    args: [BigInt(consignmentId)],
  });
  console.log("Consignment remaining:", Number(consignment[3]) / 10 ** TOKEN_DECIMALS, "tokens");
  console.log("Consignment active:", consignment[14]);

  // ========== STEP 3: CREATE OFFER (BUY) ==========
  console.log("\n--- Step 3: Create Offer (Buy) ---");

  const nextOfferId = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "nextOfferId",
  });
  console.log("Next offer ID:", Number(nextOfferId));

  const offerParams = {
    consignmentId: BigInt(consignmentId),
    tokenAmount: buyAmount,
    discountBps: 1000n, // 10%
    currency: 0, // ETH
    lockupSeconds: BigInt(180 * 24 * 60 * 60), // 180 days
    agentCommissionBps: 25, // 0.25%
  };

  console.log(
    "Creating offer for",
    Number(offerParams.tokenAmount) / 10 ** TOKEN_DECIMALS,
    "tokens...",
  );

  const { request: offerRequest } = await publicClient.simulateContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "createOfferFromConsignment",
    args: [
      offerParams.consignmentId,
      offerParams.tokenAmount,
      offerParams.discountBps,
      offerParams.currency,
      offerParams.lockupSeconds,
      offerParams.agentCommissionBps,
    ],
    account,
  });

  const offerTxHash = await walletClient.writeContract({
    ...offerRequest,
    account,
  });
  console.log("Create offer tx:", offerTxHash);

  console.log("Waiting for confirmation...");
  const offerReceipt = await publicClient.waitForTransactionReceipt({ hash: offerTxHash });
  console.log("Confirmed in block:", offerReceipt.blockNumber);

  const offerId = Number(nextOfferId);
  console.log("Offer created. ID:", offerId);

  // Verify offer
  const offer = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "offers",
    args: [BigInt(offerId)],
  });
  console.log("Offer state:", {
    consignmentId: Number(offer[0]),
    beneficiary: offer[1],
    tokenAmount: Number(offer[2]) / 10 ** TOKEN_DECIMALS,
    discountBps: Number(offer[3]) / 100 + "%",
    approved: offer[8],
    paid: offer[9],
    fulfilled: offer[10],
    cancelled: offer[11],
  });

  // ========== STEP 4: BACKEND APPROVAL (via API) ==========
  console.log("\n--- Step 4: Backend Approval ---");

  // Call the backend approval API
  const approveRes = await fetch("http://localhost:4444/api/otc/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offerId: offerId.toString(),
      txHash: offerTxHash,
      chain: "base",
    }),
  });

  if (!approveRes.ok) {
    const errorText = await approveRes.text();
    throw new Error(
      `Approval API failed: ${errorText}. Make sure the dev server is running (bun run dev). Offer ID: ${offerId}`,
    );
  }

  const approveData = (await approveRes.json()) as {
    success: boolean;
    approvalTx?: string;
    txHash?: string;
    autoFulfilled?: boolean;
    fulfillTx?: string;
  };

  // FAIL-FAST: At least one transaction hash must exist
  const approvalTxHash = approveData.approvalTx ?? approveData.txHash;
  if (!approvalTxHash) {
    throw new Error("Approval response missing both approvalTx and txHash");
  }
  console.log("Approval response:", {
    success: approveData.success,
    approvalTx: approvalTxHash,
    autoFulfilled: approveData.autoFulfilled,
    fulfillTx: approveData.fulfillTx,
  });

  // ========== STEP 5: VERIFY FINAL STATE ==========
  console.log("\n--- Step 5: Verify Final State ---");

  await sleep(3000); // Wait for state to propagate

  const finalOffer = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "offers",
    args: [BigInt(offerId)],
  });

  const finalConsignment = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: otcAbi,
    functionName: "consignments",
    args: [BigInt(consignmentId)],
  });

  console.log("Final Offer State:", {
    approved: finalOffer[8],
    paid: finalOffer[9],
    fulfilled: finalOffer[10],
    cancelled: finalOffer[11],
  });

  console.log("Final Consignment State:", {
    remaining: Number(finalConsignment[3]) / 10 ** TOKEN_DECIMALS,
    isActive: finalConsignment[14],
  });

  if (finalOffer[8] && finalOffer[9]) {
    console.log("\n=== SUCCESS: Full OTC flow completed ===");
    console.log("- Consignment ID:", consignmentId);
    console.log("- Offer ID:", offerId);
    console.log("- Tokens locked:", Number(buyAmount) / 10 ** TOKEN_DECIMALS);
    console.log("- Remaining in consignment:", Number(finalConsignment[3]) / 10 ** TOKEN_DECIMALS);
  } else {
    console.log("\n=== PARTIAL SUCCESS ===");
    console.log("Consignment and offer created, but approval/payment may have failed.");
    console.log("Check the backend logs for details.");
  }
}

main().catch(console.error);
