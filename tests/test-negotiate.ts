import { createPublicClient, createWalletClient, http, parseEther, keccak256, formatEther } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";

const EVM_RPC = "http://localhost:8545";
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const APPROVER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const BUYER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";

async function main() {
  const deployment = JSON.parse(fs.readFileSync("contracts/deployments/eliza-otc-deployment.json", "utf8"));
  
  const otcAddress = deployment.contracts.deal;
  const tokenAddress = deployment.contracts.elizaToken;
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  NEGOTIABLE LISTING FLOW TEST");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const otcAbi = JSON.parse(fs.readFileSync("contracts/out/OTC.sol/OTC.json", "utf8")).abi;
  const tokenAbi = JSON.parse(fs.readFileSync("contracts/out/ERC20.sol/ERC20.json", "utf8")).abi;
  
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
  
  // Step 1: Create NEGOTIABLE consignment with ranges
  console.log("\n📍 Step 1: Create negotiable consignment");
  const consignAmount = parseEther("10000");
  
  const { request: approveReq } = await publicClient.simulateContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "approve",
    args: [otcAddress, consignAmount],
    account: ownerAccount,
  });
  await ownerWallet.writeContract(approveReq);
  
  const nextConsignmentId = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "nextConsignmentId",
  }) as bigint;
  
  // Create negotiable consignment:
  // - Discount range: 500-2000 bps (5%-20%)
  // - Lockup range: 90-365 days
  const { request: consignReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "createConsignment",
    args: [
      tokenId,              // tokenId
      consignAmount,        // amount
      true,                 // isNegotiable = TRUE
      0,                    // fixedDiscountBps (ignored for negotiable)
      0,                    // fixedLockupDays (ignored for negotiable)
      500,                  // minDiscountBps (5%)
      2000,                 // maxDiscountBps (20%)
      90,                   // minLockupDays (3 months)
      365,                  // maxLockupDays (1 year)
      parseEther("100"),    // minDealAmount
      parseEther("5000"),   // maxDealAmount
      500                   // maxPriceVolatilityBps
    ],
    account: ownerAccount,
    value: parseEther("0.001"),
  });
  await ownerWallet.writeContract(consignReq);
  console.log("  ✅ Negotiable consignment created:", nextConsignmentId.toString());
  
  // Read consignment to verify it's negotiable
  // Struct: tokenId[0], consigner[1], totalAmount[2], remainingAmount[3], isNegotiable[4],
  //         fixedDiscountBps[5], fixedLockupDays[6], minDiscountBps[7], maxDiscountBps[8],
  //         minLockupDays[9], maxLockupDays[10], minDealAmount[11], maxDealAmount[12],
  //         maxPriceVolatilityBps[13], isActive[14], createdAt[15]
  const consignment = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "consignments",
    args: [nextConsignmentId],
  }) as any[];
  console.log("  isNegotiable:", consignment[4]);
  console.log("  Discount range:", consignment[7], "-", consignment[8], "bps");
  console.log("  Lockup range:", consignment[9], "-", consignment[10], "days");
  
  // Step 2: Buyer creates offer with NEGOTIATED terms
  console.log("\n📍 Step 2: Create offer with negotiated terms");
  console.log("  (15% discount, 180 day lockup - within seller's ranges)");
  
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
      nextConsignmentId,              // consignmentId
      parseEther("2000"),             // tokenAmount (within min/max deal)
      1500n,                          // discountBps = 15% (within 5-20%)
      0,                              // currency = ETH
      BigInt(180 * 24 * 60 * 60),    // lockupSeconds = 180 days (within 90-365)
    ],
    account: buyerAccount,
  });
  await buyerWallet.writeContract(offerReq);
  console.log("  ✅ Offer created:", nextOfferId.toString());
  
  // Read offer to verify terms
  const offer = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "offers",
    args: [nextOfferId],
  }) as any[];
  console.log("  Token amount:", formatEther(offer[3]));
  console.log("  Discount BPS:", offer[4].toString());
  console.log("  Unlock time:", new Date(Number(offer[6]) * 1000).toISOString());
  
  // Step 3: Test that offer outside range fails
  console.log("\n📍 Step 3: Verify invalid terms are rejected");
  
  try {
    // Try 25% discount (outside max 20%)
    await publicClient.simulateContract({
      address: otcAddress,
      abi: otcAbi,
      functionName: "createOfferFromConsignment",
      args: [
        nextConsignmentId,
        parseEther("1000"),
        2500n,  // 25% - TOO HIGH
        0,
        BigInt(180 * 24 * 60 * 60),
      ],
      account: buyerAccount,
    });
    console.log("  ❌ Should have rejected 25% discount");
  } catch (err: any) {
    console.log("  ✅ Correctly rejected 25% discount (outside range)");
  }
  
  try {
    // Try 30 day lockup (outside min 90 days)
    await publicClient.simulateContract({
      address: otcAddress,
      abi: otcAbi,
      functionName: "createOfferFromConsignment",
      args: [
        nextConsignmentId,
        parseEther("1000"),
        1000n,
        0,
        BigInt(30 * 24 * 60 * 60),  // 30 days - TOO SHORT
      ],
      account: buyerAccount,
    });
    console.log("  ❌ Should have rejected 30 day lockup");
  } catch (err: any) {
    console.log("  ✅ Correctly rejected 30 day lockup (outside range)");
  }
  
  // Step 4: Complete the valid offer
  console.log("\n📍 Step 4: Complete the negotiated deal");
  
  // Approve offer
  const { request: approveOfferReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "approveOffer",
    args: [nextOfferId],
    account: approverAccount,
  });
  await approverWallet.writeContract(approveOfferReq);
  console.log("  ✅ Offer approved");
  
  // Calculate payment - refetch offer to get current data
  const offerData = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "offers",
    args: [nextOfferId],
  }) as any[];
  
  const totalUsd = await publicClient.readContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "totalUsdForOffer",
    args: [nextOfferId],
  }) as bigint;
  const ethUsdPrice = offerData[9] as bigint;
  console.log("  Total USD:", (Number(totalUsd) / 1e8).toFixed(2));
  console.log("  ETH/USD:", (Number(ethUsdPrice) / 1e8).toFixed(2));
  const paymentAmount = ethUsdPrice > 0n ? (totalUsd * BigInt(1e18)) / ethUsdPrice + BigInt(1e14) : BigInt(0);
  
  // Fulfill
  const { request: fulfillReq } = await publicClient.simulateContract({
    address: otcAddress,
    abi: otcAbi,
    functionName: "fulfillOffer",
    args: [nextOfferId],
    account: approverAccount,
    value: paymentAmount,
  });
  await approverWallet.writeContract(fulfillReq);
  console.log("  ✅ Offer fulfilled");
  console.log("  Payment:", formatEther(paymentAmount), "ETH");
  console.log("  For:", formatEther(offer[3]), "tokens at 15% discount");
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ✅ NEGOTIABLE LISTING FLOW COMPLETE!");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
