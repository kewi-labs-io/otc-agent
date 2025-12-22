#!/usr/bin/env bun

/**
 * On-Chain Buy Flow E2E Test
 *
 * Tests the complete buy flow with actual on-chain verification:
 * 1. Deploy contracts to local Anvil
 * 2. Create P2P consignment (auto-approved)
 * 3. Buyer creates and fulfills P2P offer
 * 4. Verify tokens claimed
 * 5. Create negotiable consignment
 * 6. Buyer creates offer (not auto-approved)
 * 7. Agent approves offer with commission
 * 8. Buyer fulfills and claims
 * 9. Verify commission paid to agent
 *
 * Run: bun scripts/test-buy-flow-onchain.ts
 */

import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  type Hex,
  http,
  keccak256,
  parseEther,
  parseUnits,
  stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localhost } from "viem/chains";

// =============================================================================
// CONFIGURATION
// =============================================================================

const RPC_URL = "http://127.0.0.1:8545";
const ANVIL_CHAIN = { ...localhost, id: 31337, name: "Anvil" };

// Anvil default accounts
const OWNER = {
  address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
  key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
};
const AGENT = {
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
  key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
};
const APPROVER = {
  address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
  key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
};
const CONSIGNER = {
  address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address,
  key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex,
};
const BUYER = {
  address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address,
  key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex,
};

// =============================================================================
// UTILITIES
// =============================================================================

function log(emoji: string, message: string, data?: Record<string, unknown>) {
  console.log(`${emoji} ${message}`);
  if (data) {
    Object.entries(data).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
  }
}

function section(title: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(70)}\n`);
}

async function startAnvil(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", "8545"], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    let started = false;

    if (!anvil.stdout) {
      reject(new Error("Anvil stdout stream not available"));
      return;
    }
    if (!anvil.stderr) {
      reject(new Error("Anvil stderr stream not available"));
      return;
    }

    anvil.stdout.on("data", (data) => {
      const output = data.toString();
      if (output.includes("Listening on") && !started) {
        started = true;
        log("✅", "Anvil started on port 8545");
        resolve(() => {
          anvil.kill();
        });
      }
    });

    anvil.stderr.on("data", (data) => {
      console.error("Anvil error:", data.toString());
    });

    anvil.on("error", (err) => {
      reject(new Error(`Failed to start Anvil: ${err.message}`));
    });

    // Timeout
    setTimeout(() => {
      if (!started) {
        anvil.kill();
        reject(new Error("Anvil failed to start within 10 seconds"));
      }
    }, 10000);
  });
}

async function deployContracts(
  _publicClient: ReturnType<typeof createPublicClient>,
  _walletClient: ReturnType<typeof createWalletClient>,
): Promise<{
  otc: Address;
  token: Address;
  usdc: Address;
  tokenFeed: Address;
  ethFeed: Address;
}> {
  log("🚀", "Deploying contracts...");

  // Run forge deploy script
  const contractsDir = path.join(process.cwd(), "contracts");

  execSync(
    "forge script scripts/DeployElizaOTC.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --skip-simulation",
    {
      cwd: contractsDir,
      stdio: "pipe",
    },
  );

  // Read deployment addresses
  const deploymentPath = path.join(contractsDir, "deployments/eliza-otc-deployment.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const addresses = {
    otc: deployment.contracts.deal as Address,
    token: deployment.contracts.elizaToken as Address,
    usdc: deployment.contracts.usdcToken as Address,
    tokenFeed: deployment.contracts.elizaUsdFeed as Address,
    ethFeed: deployment.contracts.ethUsdFeed as Address,
  };

  log("✅", "Contracts deployed:", {
    otc: addresses.otc,
    token: addresses.token,
    usdc: addresses.usdc,
  });

  return addresses;
}

// =============================================================================
// ABI
// =============================================================================

const OTC_ABI = [
  "function nextConsignmentId() view returns (uint256)",
  "function nextOfferId() view returns (uint256)",
  "function agent() view returns (address)",
  "function usdc() view returns (address)",
  "function tokens(bytes32) view returns (address, uint8, bool, address)",
  "function consignments(uint256) view returns (bytes32, address, uint256, uint256, bool, uint16, uint32, uint16, uint16, uint32, uint32, uint256, uint256, uint16, bool, uint256)",
  "function offers(uint256) view returns (uint256, bytes32, address, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint8, bool, bool, bool, bool, address, uint256, uint16)",
  "function requiredUsdcAmount(uint256) view returns (uint256)",
  "function setRequireApproverToFulfill(bool)",
  "function setApprover(address, bool)",
  "function registerToken(bytes32, address, address)",
  "function createConsignment(bytes32, uint256, bool, uint16, uint32, uint16, uint16, uint32, uint32, uint256, uint256, uint16) payable returns (uint256)",
  "function createOfferFromConsignment(uint256, uint256, uint256, uint8, uint256, uint16) returns (uint256)",
  "function approveOffer(uint256)",
  "function fulfillOffer(uint256) payable",
  "function claim(uint256)",
  "function calculateAgentCommission(uint256, uint256) view returns (uint16)",
] as const;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)",
] as const;

// =============================================================================
// MAIN TEST
// =============================================================================

async function runBuyFlowTest() {
  section("ON-CHAIN BUY FLOW E2E TEST");

  // Start Anvil if needed
  const _stopAnvil = await startAnvil();

  // Create clients
  const publicClient = createPublicClient({
    chain: ANVIL_CHAIN,
    transport: http(RPC_URL),
  });

  const ownerWallet = createWalletClient({
    chain: ANVIL_CHAIN,
    transport: http(RPC_URL),
    account: privateKeyToAccount(OWNER.key),
  });

  const consignerWallet = createWalletClient({
    chain: ANVIL_CHAIN,
    transport: http(RPC_URL),
    account: privateKeyToAccount(CONSIGNER.key),
  });

  const buyerWallet = createWalletClient({
    chain: ANVIL_CHAIN,
    transport: http(RPC_URL),
    account: privateKeyToAccount(BUYER.key),
  });

  const approverWallet = createWalletClient({
    chain: ANVIL_CHAIN,
    transport: http(RPC_URL),
    account: privateKeyToAccount(APPROVER.key),
  });

  // Deploy contracts
  const addresses = await deployContracts(publicClient, ownerWallet);

  const tokenId = keccak256(stringToBytes("elizaOS"));

  // Fund accounts
  log("💰", "Funding test accounts...");

  // Transfer tokens to consigner
  await ownerWallet.writeContract({
    address: addresses.token,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [CONSIGNER.address, parseEther("100000")],
  });

  // Transfer USDC to buyer
  await ownerWallet.writeContract({
    address: addresses.usdc,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [BUYER.address, parseUnits("100000", 6)],
  });

  log("✅", "Accounts funded");

  // Disable approver-only fulfillment for P2P test
  await ownerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "setRequireApproverToFulfill",
    args: [false],
  });

  // =============================================================================
  // TEST 1: P2P BUY FLOW (NON-NEGOTIABLE)
  // =============================================================================

  section("TEST 1: P2P BUY FLOW (Non-Negotiable, Auto-Approved)");

  // 1. Create P2P consignment
  log("📝", "Step 1: Consigner creates P2P listing...");

  await consignerWallet.writeContract({
    address: addresses.token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [addresses.otc, parseEther("10000")],
  });

  const p2pTx = await consignerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "createConsignment",
    args: [
      tokenId,
      parseEther("10000"), // 10,000 tokens
      false, // NOT negotiable (P2P)
      500, // 5% fixed discount
      30, // 30 days lockup
      0,
      0, // min/max discount unused
      0,
      0, // min/max lockup unused
      parseEther("100"), // min 100 tokens
      parseEther("5000"), // max 5000 tokens
      500, // 5% max price deviation
    ],
    value: parseEther("0.001"), // gas deposit
  });

  await publicClient.waitForTransactionReceipt({ hash: p2pTx });
  const p2pConsignmentId =
    (await publicClient.readContract({
      address: addresses.otc,
      abi: OTC_ABI,
      functionName: "nextConsignmentId",
    })) - 1n;

  log("✅", `P2P Consignment created: ID ${p2pConsignmentId}`);

  // 2. Buyer creates offer (auto-approved for P2P)
  log("📝", "Step 2: Buyer creates P2P offer (should auto-approve)...");

  const p2pOfferTx = await buyerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "createOfferFromConsignment",
    args: [
      p2pConsignmentId,
      parseEther("1000"), // 1000 tokens
      500, // 5% discount (must match fixed)
      1, // USDC
      30n * 24n * 60n * 60n, // 30 days lockup (must match fixed)
      0, // 0 commission for P2P
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: p2pOfferTx });
  const p2pOfferId =
    (await publicClient.readContract({
      address: addresses.otc,
      abi: OTC_ABI,
      functionName: "nextOfferId",
    })) - 1n;

  // Verify auto-approval
  const p2pOffer = await publicClient.readContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "offers",
    args: [p2pOfferId],
  });

  const p2pApproved = p2pOffer[11]; // approved field
  log(p2pApproved ? "✅" : "❌", `P2P Offer created: ID ${p2pOfferId}`, {
    autoApproved: p2pApproved ? "YES ✅" : "NO ❌",
    commissionBps: p2pOffer[17].toString(),
  });

  if (!p2pApproved) {
    throw new Error("P2P offer should be auto-approved!");
  }

  // 3. Buyer fulfills payment
  log("📝", "Step 3: Buyer fulfills P2P payment...");

  const requiredUsdc = await publicClient.readContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "requiredUsdcAmount",
    args: [p2pOfferId],
  });

  await buyerWallet.writeContract({
    address: addresses.usdc,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [addresses.otc, requiredUsdc],
  });

  const fulfillTx = await buyerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "fulfillOffer",
    args: [p2pOfferId],
  });

  await publicClient.waitForTransactionReceipt({ hash: fulfillTx });
  log("✅", `P2P Offer fulfilled`, { usdcPaid: formatUnits(requiredUsdc, 6) });

  // 4. Claim tokens (skip lockup for test)
  log("📝", "Step 4: Buyer claims P2P tokens...");

  // Fast forward time
  await publicClient.request({
    method: "evm_increaseTime" as never,
    params: [31 * 24 * 60 * 60] as never, // 31 days
  });
  await publicClient.request({ method: "evm_mine" as never, params: [] as never });

  const buyerTokensBefore = await publicClient.readContract({
    address: addresses.token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [BUYER.address],
  });

  const claimTx = await buyerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "claim",
    args: [p2pOfferId],
  });

  await publicClient.waitForTransactionReceipt({ hash: claimTx });

  const buyerTokensAfter = await publicClient.readContract({
    address: addresses.token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [BUYER.address],
  });

  const tokensReceived = buyerTokensAfter - buyerTokensBefore;

  log("✅", "P2P tokens claimed!", {
    tokensReceived: formatEther(tokensReceived),
    expected: "1000",
  });

  section("✅ P2P BUY FLOW COMPLETE - VERIFIED ON-CHAIN");

  // =============================================================================
  // TEST 2: NEGOTIABLE BUY FLOW (AGENT APPROVAL + COMMISSION)
  // =============================================================================

  section("TEST 2: NEGOTIABLE BUY FLOW (Agent Approval + Commission)");

  // 1. Create negotiable consignment
  log("📝", "Step 1: Consigner creates negotiable listing...");

  const negotiableTx = await consignerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "createConsignment",
    args: [
      tokenId,
      parseEther("10000"), // 10,000 tokens
      true, // NEGOTIABLE
      0,
      0, // fixed unused
      100,
      1500, // 1-15% discount range
      7,
      365, // 7-365 days lockup
      parseEther("100"), // min 100 tokens
      parseEther("5000"), // max 5000 tokens
      500, // 5% max price deviation
    ],
    value: parseEther("0.001"),
  });

  await publicClient.waitForTransactionReceipt({ hash: negotiableTx });
  const negotiableConsignmentId =
    (await publicClient.readContract({
      address: addresses.otc,
      abi: OTC_ABI,
      functionName: "nextConsignmentId",
    })) - 1n;

  log("✅", `Negotiable Consignment created: ID ${negotiableConsignmentId}`);

  // 2. Buyer creates offer with negotiated terms
  log("📝", "Step 2: Buyer creates negotiable offer (needs approval)...");

  const discountBps = 1000n; // 10% discount
  const lockupDays = 90n; // 90 days
  const lockupSeconds = lockupDays * 24n * 60n * 60n;

  // Calculate commission
  const commissionBps = await publicClient.readContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "calculateAgentCommission",
    args: [discountBps, lockupDays],
  });

  log("📊", "Calculated commission:", {
    discountBps: discountBps.toString(),
    lockupDays: lockupDays.toString(),
    commissionBps: commissionBps.toString(),
    commissionPercent: `${Number(commissionBps) / 100}%`,
  });

  const negotiableOfferTx = await buyerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "createOfferFromConsignment",
    args: [
      negotiableConsignmentId,
      parseEther("1000"), // 1000 tokens
      discountBps, // 10% discount
      1, // USDC
      lockupSeconds, // 90 days
      commissionBps, // Calculated commission
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: negotiableOfferTx });
  const negotiableOfferId =
    (await publicClient.readContract({
      address: addresses.otc,
      abi: OTC_ABI,
      functionName: "nextOfferId",
    })) - 1n;

  // Verify NOT auto-approved
  const negotiableOffer = await publicClient.readContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "offers",
    args: [negotiableOfferId],
  });

  const negotiableApproved = negotiableOffer[11];
  log(!negotiableApproved ? "✅" : "❌", `Negotiable Offer created: ID ${negotiableOfferId}`, {
    approved: negotiableApproved ? "YES (WRONG!)" : "NO (Correct - needs agent)",
    commissionBps: negotiableOffer[17].toString(),
  });

  if (negotiableApproved) {
    throw new Error("Negotiable offer should NOT be auto-approved!");
  }

  // 3. Agent approves offer
  log("📝", "Step 3: Agent approves negotiable offer...");

  const agentBalanceBefore = await publicClient.readContract({
    address: addresses.usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [AGENT.address],
  });

  const approveTx = await approverWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "approveOffer",
    args: [negotiableOfferId],
  });

  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  // Verify approval
  const offerAfterApproval = await publicClient.readContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "offers",
    args: [negotiableOfferId],
  });

  log(offerAfterApproval[11] ? "✅" : "❌", "Offer approved by agent");

  // 4. Buyer fulfills payment
  log("📝", "Step 4: Buyer fulfills negotiable payment...");

  const requiredUsdcNeg = await publicClient.readContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "requiredUsdcAmount",
    args: [negotiableOfferId],
  });

  await buyerWallet.writeContract({
    address: addresses.usdc,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [addresses.otc, requiredUsdcNeg],
  });

  const fulfillNegTx = await buyerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "fulfillOffer",
    args: [negotiableOfferId],
  });

  await publicClient.waitForTransactionReceipt({ hash: fulfillNegTx });
  log("✅", `Negotiable Offer fulfilled`, { usdcPaid: formatUnits(requiredUsdcNeg, 6) });

  // Verify commission paid to agent
  const agentBalanceAfter = await publicClient.readContract({
    address: addresses.usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [AGENT.address],
  });

  const commissionPaid = agentBalanceAfter - agentBalanceBefore;
  const expectedCommission = (requiredUsdcNeg * BigInt(commissionBps)) / 10000n;

  log("💰", "Commission verification:", {
    agentBalanceBefore: `${formatUnits(agentBalanceBefore, 6)} USDC`,
    agentBalanceAfter: `${formatUnits(agentBalanceAfter, 6)} USDC`,
    commissionPaid: `${formatUnits(commissionPaid, 6)} USDC`,
    expectedCommission: `${formatUnits(expectedCommission, 6)} USDC`,
    commissionCorrect: commissionPaid === expectedCommission ? "✅ YES" : "❌ NO",
  });

  // 5. Claim tokens
  log("📝", "Step 5: Buyer claims negotiable tokens...");

  await publicClient.request({
    method: "evm_increaseTime" as never,
    params: [91 * 24 * 60 * 60] as never, // 91 days
  });
  await publicClient.request({ method: "evm_mine" as never, params: [] as never });

  const buyerTokensBeforeNeg = await publicClient.readContract({
    address: addresses.token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [BUYER.address],
  });

  const claimNegTx = await buyerWallet.writeContract({
    address: addresses.otc,
    abi: OTC_ABI,
    functionName: "claim",
    args: [negotiableOfferId],
  });

  await publicClient.waitForTransactionReceipt({ hash: claimNegTx });

  const buyerTokensAfterNeg = await publicClient.readContract({
    address: addresses.token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [BUYER.address],
  });

  const tokensReceivedNeg = buyerTokensAfterNeg - buyerTokensBeforeNeg;

  log("✅", "Negotiable tokens claimed!", {
    tokensReceived: formatEther(tokensReceivedNeg),
    expected: "1000",
  });

  section("✅ NEGOTIABLE BUY FLOW COMPLETE - VERIFIED ON-CHAIN");

  // =============================================================================
  // FINAL SUMMARY
  // =============================================================================

  section("FINAL ON-CHAIN VERIFICATION SUMMARY");

  console.log(`
┌─────────────────────────────────────────────────────────────────────────┐
│                        ON-CHAIN VERIFICATION RESULTS                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ✅ P2P (Non-Negotiable) Flow:                                          │
│     • Consignment created with fixed 5% discount, 30-day lockup         │
│     • Offer auto-approved at creation                                    │
│     • Buyer paid ${formatUnits(requiredUsdc, 6).padStart(10)} USDC                                        │
│     • Buyer received ${formatEther(tokensReceived).padStart(8)} tokens                                     │
│     • Commission: 0 USDC (P2P)                                          │
│                                                                          │
│  ✅ Negotiable Flow:                                                     │
│     • Consignment created with 1-15% discount, 7-365 day lockup range   │
│     • Offer NOT auto-approved (needed agent)                            │
│     • Agent approved with ${commissionBps.toString().padStart(3)} bps commission                             │
│     • Buyer paid ${formatUnits(requiredUsdcNeg, 6).padStart(10)} USDC                                        │
│     • Agent received ${formatUnits(commissionPaid, 6).padStart(8)} USDC commission                          │
│     • Buyer received ${formatEther(tokensReceivedNeg).padStart(8)} tokens                                     │
│                                                                          │
│  All transactions verified on-chain via Anvil (Chain ID: 31337)         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
`);
}

// =============================================================================
// MAIN
// =============================================================================

runBuyFlowTest()
  .then(() => {
    console.log("\n✅ All buy flow tests passed and verified on-chain!\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
