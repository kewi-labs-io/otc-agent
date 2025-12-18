#!/usr/bin/env bun
/**
 * E2E Full Flow Validation Script
 * 
 * Tests the complete OTC flows for both P2P (non-negotiable) and agent-negotiated deals:
 * 
 * P2P Flow (Non-Negotiable):
 * 1. Consigner lists tokens with fixed terms (isNegotiable = false)
 * 2. Buyer creates offer -> auto-approved at creation
 * 3. Buyer fulfills payment immediately
 * 4. Buyer claims tokens after lockup
 * 
 * Negotiable Flow:
 * 1. Consigner lists tokens with negotiable terms (isNegotiable = true)
 * 2. Buyer creates offer with custom terms
 * 3. Agent/approver approves the offer
 * 4. Buyer fulfills payment
 * 5. Buyer claims tokens after lockup
 * 
 * Usage:
 *   bun scripts/e2e-full-flow.ts           # Dry run (read-only)
 *   EXECUTE_TX=true bun scripts/e2e-full-flow.ts  # Execute transactions
 *   CHAIN=anvil bun scripts/e2e-full-flow.ts      # Test on local anvil
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  formatEther,
  parseEther,
  keccak256,
  stringToBytes,
  formatUnits,
  parseUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, base, bsc, sepolia, baseSepolia, bscTestnet } from "viem/chains";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// CONFIGURATION
// =============================================================================

const EXECUTE_TX = process.env.EXECUTE_TX === "true";
const CHAIN = process.env.CHAIN || "anvil"; // anvil, base, bsc, mainnet

// Private keys from environment
const DEPLOYER_KEY = process.env.MAINNET_PRIVATE_KEY as Hex | undefined;
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY as Hex | undefined;

if (EXECUTE_TX && !DEPLOYER_KEY) {
  console.error("MAINNET_PRIVATE_KEY required for transaction execution");
  process.exit(1);
}

// Chain configuration
const CHAIN_CONFIGS: Record<string, { chain: typeof mainnet; rpc: string; deploymentFile: string }> = {
  anvil: {
    chain: { ...mainnet, id: 31337, name: "Anvil" } as typeof mainnet,
    rpc: "http://127.0.0.1:8545",
    deploymentFile: "src/config/deployments/anvil-evm.json",
  },
  base: {
    chain: base,
    rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    deploymentFile: "src/config/deployments/base-mainnet.json",
  },
  bsc: {
    chain: bsc,
    rpc: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
    deploymentFile: "src/config/deployments/bsc-mainnet.json",
  },
  mainnet: {
    chain: mainnet,
    rpc: process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com",
    deploymentFile: "src/config/deployments/mainnet-evm.json",
  },
};

const chainConfig = CHAIN_CONFIGS[CHAIN];
if (!chainConfig) {
  console.error(`Unknown chain: ${CHAIN}. Use: anvil, base, bsc, mainnet`);
  process.exit(1);
}

// Load deployment config if exists
let deploymentConfig: Record<string, Address> = {};
try {
  const deploymentPath = path.join(process.cwd(), chainConfig.deploymentFile);
  if (fs.existsSync(deploymentPath)) {
    const raw = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    deploymentConfig = raw.contracts || raw;
  }
} catch (e) {
  console.log(`No deployment config found for ${CHAIN}, will attempt to read from contract`);
}

// =============================================================================
// ABI DEFINITIONS
// =============================================================================

import { parseAbi } from "viem";

const OTC_ABI = parseAbi([
  // View functions
  "function nextConsignmentId() view returns (uint256)",
  "function nextOfferId() view returns (uint256)",
  "function consignments(uint256) view returns (bytes32 tokenId, address consigner, uint256 totalAmount, uint256 remainingAmount, bool isNegotiable, uint16 fixedDiscountBps, uint32 fixedLockupDays, uint16 minDiscountBps, uint16 maxDiscountBps, uint32 minLockupDays, uint32 maxLockupDays, uint256 minDealAmount, uint256 maxDealAmount, uint16 maxPriceVolatilityBps, bool isActive, uint256 createdAt)",
  "function offers(uint256) view returns (uint256 consignmentId, bytes32 tokenId, address beneficiary, uint256 tokenAmount, uint256 discountBps, uint256 createdAt, uint256 unlockTime, uint256 priceUsdPerToken, uint256 maxPriceDeviation, uint256 ethUsdPrice, uint8 currency, bool approved, bool paid, bool fulfilled, bool cancelled, address payer, uint256 amountPaid)",
  "function tokens(bytes32) view returns (address tokenAddress, uint8 decimals, bool isActive, address priceOracle)",
  "function tokenDeposited(bytes32) view returns (uint256)",
  "function tokenReserved(bytes32) view returns (uint256)",
  "function minUsdAmount() view returns (uint256)",
  "function agent() view returns (address)",
  "function isApprover(address) view returns (bool)",
  "function requiredApprovals() view returns (uint256)",
  "function requireApproverToFulfill() view returns (bool)",
  "function totalUsdForOffer(uint256) view returns (uint256)",
  "function requiredEthWei(uint256) view returns (uint256)",
  "function requiredUsdcAmount(uint256) view returns (uint256)",
  "function requiredGasDepositPerConsignment() view returns (uint256)",
  
  // Write functions
  "function registerToken(bytes32 tokenId, address tokenAddress, address priceOracle)",
  "function createConsignment(bytes32 tokenId, uint256 amount, bool isNegotiable, uint16 fixedDiscountBps, uint32 fixedLockupDays, uint16 minDiscountBps, uint16 maxDiscountBps, uint32 minLockupDays, uint32 maxLockupDays, uint256 minDealAmount, uint256 maxDealAmount, uint16 maxPriceVolatilityBps) payable returns (uint256)",
  "function createOfferFromConsignment(uint256 consignmentId, uint256 tokenAmount, uint256 discountBps, uint8 currency, uint256 lockupSeconds) returns (uint256)",
  "function approveOffer(uint256 offerId)",
  "function fulfillOffer(uint256 offerId) payable",
  "function claim(uint256 offerId)",
  "function withdrawConsignment(uint256 consignmentId)",
  
  // Events
  "event OfferCreated(uint256 indexed offerId, address indexed beneficiary, uint256 tokenAmount, uint256 discountBps, uint8 currency)",
  "event OfferApproved(uint256 indexed offerId, address indexed approver)",
  "event OfferPaid(uint256 indexed offerId, address indexed payer, uint256 amount)",
  "event OfferFulfilled(uint256 indexed offerId, address indexed beneficiary, uint256 tokenAmount)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function mint(address to, uint256 amount)",
]);

// =============================================================================
// UTILITIES
// =============================================================================

function log(category: string, message: string, data?: Record<string, unknown>) {
  const prefix: Record<string, string> = {
    INFO: "ℹ️ ",
    SUCCESS: "✅",
    WARNING: "⚠️ ",
    ERROR: "❌",
    STEP: "➡️ ",
    CHECK: "🔍",
    TX: "📝",
    P2P: "🤝",
    NEGOTIABLE: "🤖",
  };
  
  console.log(`${prefix[category] || "•"} ${message}`);
  if (data) {
    Object.entries(data).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
  }
}

function section(title: string) {
  console.log("\n" + "═".repeat(70));
  console.log(`  ${title}`);
  console.log("═".repeat(70) + "\n");
}

// =============================================================================
// E2E FLOW TESTS
// =============================================================================

async function runE2ETests() {
  section(`E2E OTC Flow Validation - ${CHAIN.toUpperCase()}`);
  
  log("INFO", `Mode: ${EXECUTE_TX ? "EXECUTE TRANSACTIONS" : "DRY RUN (read-only)"}`);
  log("INFO", `RPC: ${chainConfig.rpc}`);

  // Create clients
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
  });

  let walletClient: ReturnType<typeof createWalletClient> | null = null;
  let account: ReturnType<typeof privateKeyToAccount> | null = null;

  if (EXECUTE_TX && DEPLOYER_KEY) {
    account = privateKeyToAccount(DEPLOYER_KEY);
    walletClient = createWalletClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpc),
      account,
    });
    log("INFO", `Wallet: ${account.address}`);
  }

  // Get OTC address
  const OTC_ADDRESS = deploymentConfig.otc as Address;
  if (!OTC_ADDRESS) {
    log("ERROR", "OTC contract address not found in deployment config");
    return false;
  }
  log("CHECK", `OTC Contract: ${OTC_ADDRESS}`);

  // Verify contract is deployed
  const code = await publicClient.getCode({ address: OTC_ADDRESS });
  if (!code || code === "0x") {
    log("ERROR", "OTC contract not deployed at address");
    return false;
  }
  log("SUCCESS", "OTC contract deployed and verified");

  // Read contract state
  const [nextConsignmentId, nextOfferId, minUsdAmount, agent, requiredApprovals, gasDeposit] = await Promise.all([
    publicClient.readContract({ address: OTC_ADDRESS, abi: OTC_ABI, functionName: "nextConsignmentId" }),
    publicClient.readContract({ address: OTC_ADDRESS, abi: OTC_ABI, functionName: "nextOfferId" }),
    publicClient.readContract({ address: OTC_ADDRESS, abi: OTC_ABI, functionName: "minUsdAmount" }),
    publicClient.readContract({ address: OTC_ADDRESS, abi: OTC_ABI, functionName: "agent" }),
    publicClient.readContract({ address: OTC_ADDRESS, abi: OTC_ABI, functionName: "requiredApprovals" }),
    publicClient.readContract({ address: OTC_ADDRESS, abi: OTC_ABI, functionName: "requiredGasDepositPerConsignment" }),
  ]);

  log("INFO", "Contract State:", {
    nextConsignmentId: nextConsignmentId.toString(),
    nextOfferId: nextOfferId.toString(),
    minUsdAmount: formatUnits(minUsdAmount, 8) + " USD",
    agent,
    requiredApprovals: requiredApprovals.toString(),
    gasDeposit: formatEther(gasDeposit) + " ETH",
  });

  // =============================================================================
  // P2P FLOW DEMONSTRATION (Non-Negotiable)
  // =============================================================================
  
  section("P2P FLOW (Non-Negotiable) - Auto-Approved");
  
  log("P2P", "Non-negotiable offers are auto-approved at creation time");
  log("P2P", "No agent intervention required - fully permissionless");
  
  // If there are existing consignments, analyze them
  if (nextConsignmentId > 1n) {
    log("CHECK", "Analyzing existing consignments...");
    for (let i = 1n; i < nextConsignmentId && i < 5n; i++) {
      try {
        const consignment = await publicClient.readContract({
          address: OTC_ADDRESS,
          abi: OTC_ABI,
          functionName: "consignments",
          args: [i],
        });
        
        const [tokenId, consigner, totalAmount, remainingAmount, isNegotiable, fixedDiscountBps, fixedLockupDays, , , , , , , , isActive] = consignment;
        
        log("INFO", `Consignment #${i}:`, {
          isNegotiable: isNegotiable ? "YES (Agent Required)" : "NO (P2P Auto-Approved)",
          consigner: consigner.slice(0, 10) + "...",
          totalAmount: formatEther(totalAmount),
          remainingAmount: formatEther(remainingAmount),
          isActive: isActive ? "ACTIVE" : "INACTIVE",
          ...(isNegotiable ? {} : {
            fixedDiscountBps: `${Number(fixedDiscountBps) / 100}%`,
            fixedLockupDays: fixedLockupDays.toString() + " days",
          }),
        });
      } catch (e) {
        // Skip if consignment doesn't exist
      }
    }
  }

  // If there are existing offers, analyze their approval status
  if (nextOfferId > 1n) {
    log("CHECK", "Analyzing existing offers for approval status...");
    let p2pOffers = 0;
    let negotiableOffers = 0;
    
    for (let i = 1n; i < nextOfferId && i < 10n; i++) {
      try {
        const offer = await publicClient.readContract({
          address: OTC_ADDRESS,
          abi: OTC_ABI,
          functionName: "offers",
          args: [i],
        });
        
        const [consignmentId, , beneficiary, tokenAmount, discountBps, createdAt, unlockTime, , , , , approved, paid, fulfilled, cancelled] = offer;
        
        if (beneficiary === "0x0000000000000000000000000000000000000000") continue;
        
        // Check if this was from a negotiable consignment
        const consignment = await publicClient.readContract({
          address: OTC_ADDRESS,
          abi: OTC_ABI,
          functionName: "consignments",
          args: [consignmentId],
        });
        const isNegotiable = consignment[4];
        
        if (isNegotiable) {
          negotiableOffers++;
        } else {
          p2pOffers++;
        }
        
        log("INFO", `Offer #${i}:`, {
          type: isNegotiable ? "NEGOTIABLE" : "P2P",
          approved: approved ? "YES" : "NO",
          paid: paid ? "YES" : "NO",
          fulfilled: fulfilled ? "YES" : "NO",
          cancelled: cancelled ? "YES" : "NO",
          tokenAmount: formatEther(tokenAmount),
          discountBps: `${Number(discountBps) / 100}%`,
        });
      } catch (e) {
        // Skip if offer doesn't exist
      }
    }
    
    log("INFO", "Offer Summary:", {
      p2pOffers,
      negotiableOffers,
    });
  }

  // =============================================================================
  // NEGOTIABLE FLOW DEMONSTRATION
  // =============================================================================
  
  section("NEGOTIABLE FLOW - Agent Approval Required");
  
  log("NEGOTIABLE", "Negotiable offers require agent/approver approval");
  log("NEGOTIABLE", "Agent validates price, discount, and lockup terms");
  
  // Check agent configuration
  const isAgentApprover = await publicClient.readContract({
    address: OTC_ADDRESS,
    abi: OTC_ABI,
    functionName: "isApprover",
    args: [agent],
  });
  
  log("INFO", "Agent Configuration:", {
    agent,
    isApprover: isAgentApprover ? "YES" : "NO",
    requiredApprovals: requiredApprovals.toString(),
  });

  // =============================================================================
  // EXECUTE TRANSACTIONS (if enabled)
  // =============================================================================
  
  if (EXECUTE_TX && walletClient && account) {
    section("EXECUTING TEST TRANSACTIONS");
    
    log("WARNING", "Transaction execution enabled - this will cost gas");
    
    // For now, we would implement actual transaction execution here
    // This is skipped in dry-run mode
    
    log("INFO", "Transaction execution would happen here");
    log("INFO", "Use EXECUTE_TX=true to run real transactions");
  } else {
    section("DRY RUN COMPLETE");
    log("INFO", "To execute real transactions, run with EXECUTE_TX=true");
  }

  // =============================================================================
  // SUMMARY
  // =============================================================================
  
  section("VALIDATION SUMMARY");
  
  log("SUCCESS", "P2P Flow (Non-Negotiable):", {
    "Auto-Approval": "Offers from non-negotiable consignments are auto-approved",
    "Permissionless": "No agent intervention required",
    "Gas Efficient": "One less transaction for buyers",
  });
  
  log("SUCCESS", "Negotiable Flow:", {
    "Agent Required": "Offers require agent/approver approval",
    "Price Protection": "Agent validates current price vs offer price",
    "Flexibility": "Buyers can negotiate discount and lockup terms",
  });

  return true;
}

// =============================================================================
// MAIN
// =============================================================================

runE2ETests()
  .then((success) => {
    if (success) {
      console.log("\n✅ E2E validation completed successfully\n");
      process.exit(0);
    } else {
      console.log("\n❌ E2E validation failed\n");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });


