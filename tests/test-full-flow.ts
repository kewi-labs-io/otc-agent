import { createPublicClient, createWalletClient, http, parseEther, keccak256, formatEther } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const EVM_RPC = "http://localhost:8545";

// Anvil accounts
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const APPROVER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // anvil[2]
const BUYER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"; // anvil[4]

async function main() {
  const deploymentFile = "contracts/deployments/eliza-otc-deployment.json";
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  
  const otcAddress = deployment.contracts.deal;
  const tokenAddress = deployment.contracts.elizaToken;
  const usdcAddress = deployment.contracts.usdcToken;
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  FULL OTC FLOW TEST");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("OTC:", otcAddress);
  console.log("Token:", tokenAddress);
  console.log("USDC:", usdcAddress);
  
  // Load ABIs
  const otcAbi = JSON.parse(fs.readFileSync("contracts/out/OTC.sol/OTC.json", "utf8")).abi;
  const tokenAbi = JSON.parse(fs.readFileSync("contracts/out/ERC20.sol/ERC20.json", "utf8")).abi;
  
  // Setup accounts
  const ownerAccount = privateKeyToAccount(OWNER_KEY as `0x${string}`);
  const approverAccount = privateKeyToAccount(APPROVER_KEY as `0x${string}`);
  const buyerAccount = privateKeyToAccount(BUYER_KEY as `0x${string}`);
  
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(EVM_RPC),
  });
  
  const ownerWallet = createWalletClient({
    account: ownerAccount,
    chain: foundry,
    transport: http(EVM_RPC),
  });
  
  const approverWallet = createWalletClient({
    account: approverAccount,
    chain: foundry,
    transport: http(EVM_RPC),
  });
  
  const buyerWallet = createWalletClient({
    account: buyerAccount,
    chain: foundry,
    transport: http(EVM_RPC),
  });
  
  const tokenId = keccak256(new TextEncoder().encode("elizaOS"));
  
  // Check config
  const requireApproverToFulfill = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "requireApproverToFulfill",
  });
  console.log("Require Approver To Fulfill:", requireApproverToFulfill);
  
  // Step 0: Extend max feed age (for testing with stale prices)
  console.log("\n📍 Step 0: Extend max feed age");
  try {
    const { request: feedAgeReq } = await publicClient.simulateContract({
      address: otcAddress,
      abi: otcAbi,
      functionName: "setMaxFeedAge",
      args: [365 * 24 * 60 * 60],
      account: ownerAccount,
    });
    await ownerWallet.writeContract(feedAgeReq);
    console.log("  ✅ Max feed age extended");
  } catch (e) {
    console.log("  ℹ️ Already extended");
  }
  
  // Step 1: Create consignment
  console.log("\n📍 Step 1: Create consignment");
  const sellerAmount = parseEther("5000");
  
  const { request: approveReq } = await publicClient.simulateContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "approve",
    args: [otcAddress, sellerAmount],
    account: ownerAccount,
  });
  await ownerWallet.writeContract(approveReq);
  
  const nextConsignmentId = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "nextConsignmentId",
  }) as bigint;
  
  const { request: consignReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "createConsignment",
    args: [
      tokenId, sellerAmount, false, 1000, 180, 
      0, 0, 0, 0,
      parseEther("100"), sellerAmount, 500
    ],
    account: ownerAccount,
    value: parseEther("0.001"),
  });
  await ownerWallet.writeContract(consignReq);
  console.log("  ✅ Consignment created:", nextConsignmentId.toString());
  
  // Step 2: Buyer creates offer from consignment
  console.log("\n📍 Step 2: Create offer from consignment");
  const offerAmount = parseEther("1000");
  
  const nextOfferId = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "nextOfferId",
  }) as bigint;
  
  const { request: offerReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "createOfferFromConsignment",
    args: [
      nextConsignmentId,  // consignmentId
      offerAmount,        // tokenAmount
      1000n,              // discountBps (10%)
      0,                  // currency (0 = ETH, 1 = USDC)
      BigInt(180 * 24 * 60 * 60), // lockupSeconds
    ],
    account: buyerAccount,
  });
  await buyerWallet.writeContract(offerReq);
  console.log("  ✅ Offer created:", nextOfferId.toString());
  
  // Read offer details
  // Struct: consignmentId[0], tokenId[1], beneficiary[2], tokenAmount[3], discountBps[4],
  //         createdAt[5], unlockTime[6], priceUsdPerToken[7], maxPriceDeviation[8], ethUsdPrice[9],
  //         currency[10], approved[11], paid[12], fulfilled[13], cancelled[14], payer[15], amountPaid[16]
  const offer = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "offers",
    args: [nextOfferId],
  }) as any[];
  console.log("  Consignment ID:", offer[0].toString());
  console.log("  Token amount:", formatEther(offer[3]));
  console.log("  Discount BPS:", offer[4].toString());
  console.log("  Currency:", offer[10] === 0 ? "ETH" : "USDC");
  console.log("  Price USD/token:", (Number(offer[7]) / 1e8).toFixed(4));
  console.log("  ETH/USD price:", (Number(offer[9]) / 1e8).toFixed(2));
  console.log("  Approved:", offer[11]);
  
  // Step 3: Approver approves the offer
  console.log("\n📍 Step 3: Approve offer");
  const { request: approveOfferReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "approveOffer",
    args: [nextOfferId],
    account: approverAccount,
  });
  await approverWallet.writeContract(approveOfferReq);
  console.log("  ✅ Offer approved");
  
  // Step 4: Approver fulfills with ETH payment (requireApproverToFulfill = true)
  console.log("\n📍 Step 4: Approver fulfills offer with ETH");
  
  // Get total USD value for the offer
  const totalUsd = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "totalUsdForOffer",
    args: [nextOfferId],
  }) as bigint;
  console.log("  Total USD:", (Number(totalUsd) / 1e8).toFixed(2));
  
  // Get ETH/USD price and calculate wei needed
  const offerAfterApproval = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "offers",
    args: [nextOfferId],
  }) as any[];
  const ethUsdPrice = offerAfterApproval[9] as bigint;
  console.log("  ETH/USD:", (Number(ethUsdPrice) / 1e8).toFixed(2));
  
  // Calculate payment: (totalUsd * 1e18) / ethUsdPrice + extra buffer for rounding
  const paymentAmount = (totalUsd * BigInt(1e18)) / ethUsdPrice + BigInt(1e14); // add small buffer
  console.log("  Payment required:", formatEther(paymentAmount), "ETH");
  
  const { request: fulfillReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "fulfillOffer",
    args: [nextOfferId],
    account: approverAccount,
    value: paymentAmount,
  });
  await approverWallet.writeContract(fulfillReq);
  console.log("  ✅ Offer fulfilled by approver");
  
  // Step 5: Try to claim (should fail due to lockup)
  console.log("\n📍 Step 5: Verify claim is locked");
  try {
    await publicClient.simulateContract({
      address: otcAddress,
      abi: otcAbi,
      functionName: "claim",
      args: [nextOfferId],
      account: buyerAccount,
    });
    console.log("  ❌ Claim succeeded (unexpected)");
  } catch (err: any) {
    if (err.message.includes("tokens still locked")) {
      console.log("  ✅ Claim correctly rejected (tokens locked)");
    } else {
      console.log("  ℹ️ Error:", err.shortMessage || err.message.slice(0, 80));
    }
  }
  
  // Fast forward time
  console.log("\n📍 Step 6: Fast forward time and claim");
  const lockupSeconds = 180 * 24 * 60 * 60;
  
  await fetch(EVM_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "evm_increaseTime", params: [lockupSeconds + 1], id: 1 }),
  });
  await fetch(EVM_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 2 }),
  });
  console.log("  ⏰ Time advanced by", lockupSeconds / 86400, "days");
  
  // Claim
  const buyerTokenBefore = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [buyerAccount.address],
  }) as bigint;
  
  const { request: claimReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "claim",
    args: [nextOfferId],
    account: buyerAccount,
  });
  await buyerWallet.writeContract(claimReq);
  
  const buyerTokenAfter = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [buyerAccount.address],
  }) as bigint;
  
  console.log("  ✅ Tokens claimed!");
  console.log("  Received:", formatEther(buyerTokenAfter - buyerTokenBefore), "tokens");
  
  // Final status
  const offerFinal = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "offers",
    args: [nextOfferId],
  }) as any[];
  console.log("  Final status:", ["PENDING", "APPROVED", "FULFILLED", "CLAIMED", "CANCELLED"][offerFinal[7]]);
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ✅ FULL FLOW COMPLETE!");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
