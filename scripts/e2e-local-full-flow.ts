#!/usr/bin/env bun

/**
 * Complete Local E2E Test - Full OTC Flow
 *
 * This script tests the entire OTC flow on local Anvil:
 * 1. Deploy a new mock token
 * 2. Create a price feed for it
 * 3. Register the token with OTC
 * 4. Wallet 1 creates a consignment (lists tokens)
 * 5. Wallet 2 creates an offer to buy
 * 6. Backend approves and fulfills
 * 7. Wallet 2 claims tokens after lockup
 * 8. Verify all state on-chain
 *
 * Run: bun run scripts/e2e-local-full-flow.ts
 */

import { execSync } from "node:child_process";
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// ============================================================================
// CONFIG
// ============================================================================

const RPC_URL = "http://127.0.0.1:8545";
const _APP_URL = "http://localhost:4444";

// Anvil default accounts (deterministic)
const ANVIL_ACCOUNTS = {
  // Account 0 - Deployer/Owner
  deployer: {
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
  },
  // Account 1 - Agent
  agent: {
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
  },
  // Account 2 - Approver
  approver: {
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
  },
  // Account 3 - Seller (consigns tokens)
  seller: {
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address,
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex,
  },
  // Account 4 - Buyer (purchases tokens)
  buyer: {
    address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address,
    privateKey: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex,
  },
};

// ABIs
const ERC20_ABI = [
  {
    name: "name",
    type: "function",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    name: "symbol",
    type: "function",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    name: "decimals",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    name: "totalSupply",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "allowance",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const _MOCK_ERC20_BYTECODE =
  "0x60806040523480156200001157600080fd5b50604051620012f0380380620012f0833981810160405281019062000037919062000283565b8383816003908162000049919062000532565b5080600490816200005a919062000532565b5050508160ff1660001b600560006101000a81548160ff021916908360ff16021790555062000090338262000099640100000000026401000000009004565b50505050620006e8565b600073ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff160362000105576000604051632e0a0d8360e01b8152600401620000fc91906200066a565b60405180910390fd5b806002600082825462000119919062000687565b92505081905550806000808473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825401925050819055508173ffffffffffffffffffffffffffffffffffffffff16600073ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef83604051620001cd9190620006c2565b60405180910390a35050565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006200020b82620001de565b9050919050565b6200021d81620001fe565b81146200022957600080fd5b50565b6000815190506200023d8162000212565b92915050565b6000819050919050565b620002588162000243565b81146200026457600080fd5b50565b60008151905062000278816200024d565b92915050565b600080600080608085870312156200029b576200029a620001d9565b5b6000620002ab878288016200022c565b9450506020620002be8782880162000267565b935050604085015160ff81168114620002d657600080fd5b60608601519092506200024d811681146200030157600080fd5b809150509295919450925056fe";

const OTC_ABI = [
  {
    name: "registerToken",
    type: "function",
    inputs: [
      { name: "tokenId", type: "bytes32" },
      { name: "tokenAddress", type: "address" },
      { name: "priceOracle", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "tokens",
    type: "function",
    inputs: [{ name: "tokenId", type: "bytes32" }],
    outputs: [
      { name: "tokenAddress", type: "address" },
      { name: "decimals", type: "uint8" },
      { name: "isRegistered", type: "bool" },
      { name: "priceOracle", type: "address" },
    ],
    stateMutability: "view",
  },
  {
    name: "createConsignment",
    type: "function",
    inputs: [
      { name: "tokenId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "isNegotiable", type: "bool" },
      { name: "fixedDiscountBps", type: "uint16" },
      { name: "fixedLockupDays", type: "uint32" },
      { name: "minDiscountBps", type: "uint16" },
      { name: "maxDiscountBps", type: "uint16" },
      { name: "minLockupDays", type: "uint32" },
      { name: "maxLockupDays", type: "uint32" },
      { name: "minDealAmount", type: "uint256" },
      { name: "maxDealAmount", type: "uint256" },
      { name: "maxPriceVolatilityBps", type: "uint16" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "payable",
  },
  {
    name: "consignments",
    type: "function",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "tokenId", type: "bytes32" },
      { name: "consigner", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "remainingAmount", type: "uint256" },
      { name: "isNegotiable", type: "bool" },
      { name: "fixedDiscountBps", type: "uint16" },
      { name: "fixedLockupDays", type: "uint32" },
      { name: "minDiscountBps", type: "uint16" },
      { name: "maxDiscountBps", type: "uint16" },
      { name: "minLockupDays", type: "uint32" },
      { name: "maxLockupDays", type: "uint32" },
      { name: "minDealAmount", type: "uint256" },
      { name: "maxDealAmount", type: "uint256" },
      { name: "maxPriceVolatilityBps", type: "uint16" },
      { name: "isActive", type: "bool" },
      { name: "createdAt", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    name: "nextConsignmentId",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "createOfferFromConsignment",
    type: "function",
    inputs: [
      { name: "consignmentId", type: "uint256" },
      { name: "tokenAmount", type: "uint256" },
      { name: "discountBps", type: "uint256" },
      { name: "currency", type: "uint8" },
      { name: "lockupSeconds", type: "uint256" },
      { name: "agentCommissionBps", type: "uint16" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    name: "offers",
    type: "function",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "consignmentId", type: "uint256" },
      { name: "tokenId", type: "bytes32" },
      { name: "beneficiary", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "discountBps", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "unlockTime", type: "uint256" },
      { name: "priceUsdPerToken", type: "uint256" },
      { name: "maxPriceDeviation", type: "uint256" },
      { name: "ethUsdPrice", type: "uint256" },
      { name: "currency", type: "uint8" },
      { name: "approved", type: "bool" },
      { name: "paid", type: "bool" },
      { name: "fulfilled", type: "bool" },
      { name: "cancelled", type: "bool" },
      { name: "payer", type: "address" },
      { name: "amountPaid", type: "uint256" },
      { name: "agentCommissionBps", type: "uint16" },
    ],
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
    name: "approveOffer",
    type: "function",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "fulfillOffer",
    type: "function",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    name: "claim",
    type: "function",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "setApprover",
    type: "function",
    inputs: [
      { name: "approver", type: "address" },
      { name: "isApprover", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const _AGGREGATOR_ABI = [
  {
    name: "latestRoundData",
    type: "function",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
  {
    name: "decimals",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
] as const;

// ============================================================================
// HELPERS
// ============================================================================

function log(msg: string) {
  console.log(`[E2E] ${msg}`);
}

function success(msg: string) {
  console.log(`[E2E] ✅ ${msg}`);
}

function error(msg: string) {
  console.error(`[E2E] ❌ ${msg}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("═".repeat(70));
  console.log("  LOCAL E2E FULL FLOW TEST");
  console.log("  Creates token → Lists → Buys → Verifies on-chain");
  console.log("═".repeat(70));
  console.log();

  // Setup clients
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  });

  const deployerWallet = createWalletClient({
    account: privateKeyToAccount(ANVIL_ACCOUNTS.deployer.privateKey),
    chain: foundry,
    transport: http(RPC_URL),
  });

  const sellerWallet = createWalletClient({
    account: privateKeyToAccount(ANVIL_ACCOUNTS.seller.privateKey),
    chain: foundry,
    transport: http(RPC_URL),
  });

  const buyerWallet = createWalletClient({
    account: privateKeyToAccount(ANVIL_ACCOUNTS.buyer.privateKey),
    chain: foundry,
    transport: http(RPC_URL),
  });

  const approverWallet = createWalletClient({
    account: privateKeyToAccount(ANVIL_ACCOUNTS.approver.privateKey),
    chain: foundry,
    transport: http(RPC_URL),
  });

  // Load deployment config
  const config = JSON.parse(await Bun.file("src/config/deployments/local-evm.json").text());
  const otcAddress = config.contracts.otc as Address;
  const usdcAddress = config.contracts.usdc as Address;

  log(`OTC Contract: ${otcAddress}`);
  log(`USDC: ${usdcAddress}`);
  log(`Seller: ${ANVIL_ACCOUNTS.seller.address}`);
  log(`Buyer: ${ANVIL_ACCOUNTS.buyer.address}`);
  console.log();

  // ========================================================================
  // STEP 1: Deploy a new test token
  // ========================================================================
  log("1️⃣ Deploying new test token (TESTCOIN)...");

  // Use forge to deploy MockERC20
  const deployOutput = execSync(
    `cd contracts && forge create ./contracts/MockERC20.sol:MockERC20 \
      --rpc-url ${RPC_URL} \
      --private-key ${ANVIL_ACCOUNTS.deployer.privateKey} \
      --broadcast \
      --constructor-args "TestCoin" "TEST" 18 1000000000000000000000000 \
      2>&1`,
    { encoding: "utf-8" },
  );

  const tokenMatch = deployOutput.match(/Deployed to: (0x[a-fA-F0-9]+)/);
  if (!tokenMatch) {
    console.error("Deploy output:", deployOutput);
    throw new Error("Failed to deploy token");
  }
  const testTokenAddress = tokenMatch[1] as Address;
  success(`Token deployed: ${testTokenAddress}`);

  // Deploy price feed for the token
  const feedOutput = execSync(
    `cd contracts && forge create ./contracts/mocks/MockAggregator.sol:MockAggregatorV3 \
      --rpc-url ${RPC_URL} \
      --private-key ${ANVIL_ACCOUNTS.deployer.privateKey} \
      --broadcast \
      --constructor-args 8 100000000 \
      2>&1`,
    { encoding: "utf-8" },
  );

  const feedMatch = feedOutput.match(/Deployed to: (0x[a-fA-F0-9]+)/);
  if (!feedMatch) {
    console.error("Feed deploy output:", feedOutput);
    throw new Error("Failed to deploy price feed");
  }
  const testFeedAddress = feedMatch[1] as Address;
  success(`Price feed deployed: ${testFeedAddress} ($1.00)`);
  console.log();

  // ========================================================================
  // STEP 2: Register token with OTC
  // ========================================================================
  log("2️⃣ Registering token with OTC contract...");

  // TokenId = keccak256(abi.encodePacked(tokenAddress))
  const tokenAddressBytes = Buffer.from(testTokenAddress.slice(2), "hex");
  const tokenId = keccak256(new Uint8Array(tokenAddressBytes));
  log(`TokenId: ${tokenId}`);

  await deployerWallet.writeContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "registerToken",
    args: [tokenId, testTokenAddress, testFeedAddress],
  });

  // Verify registration
  const registeredToken = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "tokens",
    args: [tokenId],
  });

  if (!registeredToken[2]) throw new Error("Token not registered");
  success(`Token registered with OTC`);
  console.log();

  // ========================================================================
  // STEP 3: Transfer tokens to seller
  // ========================================================================
  log("3️⃣ Transferring tokens to seller...");

  const sellerAmount = parseEther("100000"); // 100k tokens

  await deployerWallet.writeContract({
    address: testTokenAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [ANVIL_ACCOUNTS.seller.address, sellerAmount],
  });

  const sellerBalance = await publicClient.readContract({
    address: testTokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ANVIL_ACCOUNTS.seller.address],
  });

  success(`Seller has ${formatEther(sellerBalance)} TEST tokens`);
  console.log();

  // ========================================================================
  // STEP 4: Seller creates consignment (lists tokens)
  // ========================================================================
  log("4️⃣ Seller creating consignment (listing tokens)...");

  const listAmount = parseEther("50000"); // List 50k tokens
  const gasDeposit = parseEther("0.001");

  // Approve OTC to spend tokens
  await sellerWallet.writeContract({
    address: testTokenAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [otcAddress, listAmount],
  });

  const nextConsignmentId = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "nextConsignmentId",
  });

  // Create consignment
  await sellerWallet.writeContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "createConsignment",
    args: [
      tokenId,
      listAmount,
      true, // negotiable
      0,
      0, // fixed discount/lockup (not used when negotiable)
      100,
      2000, // min/max discount bps (1% - 20%)
      7,
      90, // min/max lockup days
      parseEther("100"), // min deal amount
      parseEther("50000"), // max deal amount
      2000, // max price volatility bps (20%)
    ],
    value: gasDeposit,
  });

  const consignmentId = nextConsignmentId;
  const consignment = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "consignments",
    args: [consignmentId],
  });

  // consignment tuple: [tokenId, consigner, totalAmount, remainingAmount, isNegotiable, ...]
  success(
    `Consignment #${consignmentId} created: ${formatEther(consignment[2] as bigint)} TEST tokens`,
  );
  log(`  Seller: ${consignment[1]}`);
  log(`  Active: ${consignment[14]}`);
  console.log();

  // ========================================================================
  // STEP 5: Fund buyer with USDC
  // ========================================================================
  log("5️⃣ Funding buyer with USDC...");

  const buyerUsdcAmount = parseUnits("10000", 6); // 10k USDC

  await deployerWallet.writeContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [ANVIL_ACCOUNTS.buyer.address, buyerUsdcAmount],
  });

  const buyerUsdcBalance = await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ANVIL_ACCOUNTS.buyer.address],
  });

  success(`Buyer has ${formatUnits(buyerUsdcBalance, 6)} USDC`);
  console.log();

  // ========================================================================
  // STEP 6: Buyer creates offer to purchase
  // ========================================================================
  log("6️⃣ Buyer creating offer to purchase 10,000 TEST tokens...");

  const purchaseAmount = parseEther("10000"); // Buy 10k tokens
  const discountBps = 500n; // 5% discount (within min 1% - max 20%)
  const lockupDays = 14; // 14 days (within min 7 - max 90)
  const lockupSeconds = BigInt(lockupDays * 86400); // Convert to seconds
  const currency = 1; // 0 = ETH, 1 = USDC - using USDC for easier testing
  const agentCommissionBps = 25; // 0.25% - minimum for negotiable consignments (25-150 bps required)

  // Debug: verify consignment is readable
  log(`  Consignment ID: ${consignmentId}`);
  log(`  Purchase Amount: ${formatEther(purchaseAmount)} tokens`);
  log(`  Discount: ${Number(discountBps) / 100}%`);
  log(`  Lockup: ${lockupDays} days`);
  log(`  Agent Commission: ${agentCommissionBps / 100}%`);

  const nextOfferId = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "nextOfferId",
  });

  await buyerWallet.writeContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "createOfferFromConsignment",
    args: [consignmentId, purchaseAmount, discountBps, currency, lockupSeconds, agentCommissionBps],
  });

  const offerId = nextOfferId;
  const offer = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "offers",
    args: [offerId],
  });

  success(`Offer #${offerId} created`);
  log(`  Token Amount: ${formatEther(offer[3] as bigint)} TEST`);
  log(`  Discount: ${Number(offer[4]) / 100}%`);
  const lockupDaysCalc = (Number(offer[6]) - Number(offer[5])) / 86400;
  log(`  Lockup: ${lockupDaysCalc} days`);
  log(`  Approved: ${offer[11]}`);
  console.log();

  // ========================================================================
  // STEP 7: Approver approves the offer
  // ========================================================================
  log("7️⃣ Approver approving offer...");

  await approverWallet.writeContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "approveOffer",
    args: [offerId],
  });

  const approvedOffer = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "offers",
    args: [offerId],
  });

  // Struct indices: [consignmentId, tokenId, beneficiary, tokenAmount, discountBps, createdAt, unlockTime, priceUsdPerToken, ...]
  // approved is index 11
  success(`Offer approved`);
  log(`  Price per token (8 decimals): ${approvedOffer[7]}`);
  log(`  Approved: ${approvedOffer[11]}`);
  console.log();

  // ========================================================================
  // STEP 8: Approver pays on behalf of buyer (simulating backend)
  // ========================================================================
  log("8️⃣ Paying for offer with USDC...");

  // Calculate USDC amount needed: tokenAmount * priceUsdPerToken / 10^18 (token decimals) * (1 - discount) / 10^8 (price decimals) * 10^6 (USDC decimals)
  // Simpler: just transfer/approve enough USDC (10000 USDC should cover 10000 tokens at $1 each with 5% discount = 9500 USDC)
  const usdcAmount = parseUnits("10000", 6); // 10000 USDC

  // Approver needs USDC to pay
  await deployerWallet.writeContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [ANVIL_ACCOUNTS.approver.address, usdcAmount],
  });

  // Approve OTC to spend USDC
  await approverWallet.writeContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [otcAddress, usdcAmount],
  });

  await approverWallet.writeContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "fulfillOffer",
    args: [offerId],
  });

  const paidOffer = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "offers",
    args: [offerId],
  });

  // Struct indices: paid is index 12, fulfilled is index 13
  success(`Offer paid/fulfilled`);
  log(`  Unlock Time: ${new Date(Number(paidOffer[6]) * 1000).toISOString()}`);
  log(`  Paid: ${paidOffer[12]}, Fulfilled: ${paidOffer[13]}`);
  console.log();

  // ========================================================================
  // STEP 9: Fast-forward time and claim tokens
  // ========================================================================
  log("9️⃣ Fast-forwarding time and claiming tokens...");

  // Advance time past lockup
  const lockupSecondsToSkip = lockupDays * 24 * 60 * 60 + 60; // Add 1 minute buffer
  execSync(`cast rpc anvil_increaseTime ${lockupSecondsToSkip} --rpc-url ${RPC_URL}`, {
    encoding: "utf-8",
  });
  execSync(`cast rpc anvil_mine 1 --rpc-url ${RPC_URL}`, { encoding: "utf-8" });

  const buyerTokensBefore = await publicClient.readContract({
    address: testTokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ANVIL_ACCOUNTS.buyer.address],
  });

  await buyerWallet.writeContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "claim",
    args: [offerId],
  });

  const buyerTokensAfter = await publicClient.readContract({
    address: testTokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ANVIL_ACCOUNTS.buyer.address],
  });

  const tokensReceived = buyerTokensAfter - buyerTokensBefore;
  success(`Tokens claimed: ${formatEther(tokensReceived)} TEST`);
  console.log();

  // ========================================================================
  // STEP 10: Verify final state on-chain
  // ========================================================================
  log("🔟 Verifying final on-chain state...");

  const finalOffer = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "offers",
    args: [offerId],
  });

  const finalConsignment = await publicClient.readContract({
    address: otcAddress,
    abi: OTC_ABI,
    functionName: "consignments",
    args: [consignmentId],
  });

  const buyerFinalTokens = await publicClient.readContract({
    address: testTokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ANVIL_ACCOUNTS.buyer.address],
  });

  const sellerFinalUSDC = await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ANVIL_ACCOUNTS.seller.address],
  });

  console.log();
  console.log("═".repeat(70));
  console.log("  FINAL STATE VERIFICATION");
  console.log("═".repeat(70));
  console.log();
  // Struct indices: [consignmentId, tokenId, beneficiary, tokenAmount, discountBps, createdAt, unlockTime, priceUsdPerToken, maxPriceDeviation, ethUsdPrice, currency, approved, paid, fulfilled, cancelled, payer, amountPaid, agentCommissionBps]
  const offerPaid = finalOffer[12] as boolean;
  const offerFulfilled = finalOffer[13] as boolean;
  console.log(`  Offer #${offerId}:`);
  console.log(`    Paid: ${offerPaid ? "✓" : "✗"}, Fulfilled: ${offerFulfilled ? "✓" : "✗"}`);
  console.log(`    Token Amount: ${formatEther(finalOffer[3] as bigint)} TEST`);
  console.log();
  // Consignment struct indices: [tokenId, consigner, totalAmount, remainingAmount, isNegotiable, fixedDiscountBps, fixedLockupDays, minDiscountBps, maxDiscountBps, minLockupDays, maxLockupDays, minDealAmount, maxDealAmount, maxPriceVolatilityBps, isActive, createdAt]
  const consignmentActive = finalConsignment[14] as boolean;
  console.log(`  Consignment #${consignmentId}:`);
  console.log(`    Remaining: ${formatEther(finalConsignment[3] as bigint)} TEST`);
  console.log(`    Active: ${consignmentActive ? "✓" : "✗"}`);
  console.log();
  console.log(`  Buyer:`);
  console.log(`    TEST Tokens: ${formatEther(buyerFinalTokens)} TEST ✓`);
  console.log();
  console.log(`  Seller:`);
  console.log(`    USDC Received: ${formatUnits(sellerFinalUSDC, 6)} USDC`);
  console.log();

  // Assertions
  if (!offerPaid) throw new Error("Offer not paid");
  if (!offerFulfilled) throw new Error("Offer not fulfilled (claimed)");
  if (buyerFinalTokens !== purchaseAmount) throw new Error("Buyer didn't receive correct tokens");

  console.log("═".repeat(70));
  console.log("  ✅ ALL VERIFICATIONS PASSED - E2E TEST SUCCESSFUL");
  console.log("═".repeat(70));
  console.log();
}

main().catch((err) => {
  error(`Test failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
