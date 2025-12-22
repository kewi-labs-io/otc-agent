import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { getRegistrationHelperForChain } from "@/config/contracts";
import type { MinimalPublicClient } from "@/lib/viem-utils";
import { TokenRegistryService } from "./tokenRegistry";

// Protected symbols that can only be registered from verified contract addresses
const PROTECTED_SYMBOLS = ["USDC", "USDT", "DAI", "WETH", "WBTC", "ETH", "BTC"];

const VERIFIED_TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  base: {
    USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  ethereum: {
    USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    DAI: "0x6b175474e89094c44da98b954eedeac495271d0f",
    WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  },
  bsc: {
    USDC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    USDT: "0x55d398326f99059ff775485246999027b3197955",
  },
};

/**
 * Check if a symbol is protected and the token address doesn't match the verified address
 * Returns true if the registration should be BLOCKED
 */
function isProtectedSymbol(symbol: string, tokenAddress: string, chain: string): boolean {
  const upperSymbol = symbol.toUpperCase();
  if (!PROTECTED_SYMBOLS.includes(upperSymbol)) {
    return false; // Not a protected symbol, allow registration
  }

  const verifiedAddresses = VERIFIED_TOKEN_ADDRESSES[chain];
  if (!verifiedAddresses) return true; // Block if no verified list for chain

  const verifiedAddress = verifiedAddresses[upperSymbol];
  if (!verifiedAddress) return true; // Block if symbol not in verified list

  return tokenAddress.toLowerCase() !== verifiedAddress.toLowerCase();
}

/**
 * Decoded TokenRegistered event args
 */
interface TokenRegisteredArgs {
  tokenId: string;
  tokenAddress: string;
  pool: string;
  oracle: string;
  registeredBy: string;
}

/**
 * TokenRegistered event log with decoded args
 */
interface TokenRegisteredLog {
  args: TokenRegisteredArgs;
  // Other log fields are not used
}

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

let isListening = false;

/**
 * Start listening for TokenRegistered events from RegistrationHelper
 */
export async function startBaseListener() {
  if (isListening) {
    console.warn("[Base Listener] Already listening");
    return;
  }

  const registrationHelperAddress = getRegistrationHelperForChain(8453);
  if (!registrationHelperAddress) {
    throw new Error(
      "[Base Listener] RegistrationHelper not configured for Base mainnet - cannot start listener",
    );
  }

  // Server-side: use Alchemy directly
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) {
    throw new Error("[Base Listener] ALCHEMY_API_KEY not configured - cannot start listener");
  }
  const rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  console.log("[Base Listener] Starting listener for", registrationHelperAddress);
  isListening = true;

  // Watch for TokenRegistered events
  const unwatch = client.watchEvent({
    address: registrationHelperAddress as `0x${string}`,
    event: {
      type: "event",
      name: "TokenRegistered",
      inputs: [
        { type: "bytes32", name: "tokenId", indexed: true },
        { type: "address", name: "tokenAddress", indexed: true },
        { type: "address", name: "pool", indexed: true },
        { type: "address", name: "oracle" },
        { type: "address", name: "registeredBy" },
      ],
    },
    onLogs: async (logs) => {
      for (const log of logs) {
        await handleTokenRegistered(client as MinimalPublicClient, log as TokenRegisteredLog);
      }
    },
    onError: (error) => {
      console.error("[Base Listener] Error:", error);
    },
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("[Base Listener] Stopping...");
    unwatch();
    isListening = false;
  });

  process.on("SIGTERM", () => {
    console.log("[Base Listener] Stopping...");
    unwatch();
    isListening = false;
  });

  console.log("[Base Listener] Now listening for token registrations");
}

/**
 * Handle a TokenRegistered event
 */
async function handleTokenRegistered(client: MinimalPublicClient, log: TokenRegisteredLog) {
  // When using watchEvent with event definition, viem automatically decodes the log
  const { tokenAddress, pool, registeredBy } = log.args;

  console.log(
    "[Base Listener] Token registered:",
    tokenAddress,
    "pool:",
    pool,
    "by:",
    registeredBy,
  );

  // Fetch token metadata from blockchain
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
    client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "name",
    }),
    client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
  ]);

  // Security check: block impersonation of protected symbols
  if (isProtectedSymbol(symbol as string, tokenAddress, "base")) {
    console.warn(
      `[Base Listener] Blocked unverified ${symbol} token at ${tokenAddress} - possible impersonation attempt`,
    );
    return;
  }

  // Add to database with pool address for future price updates
  const tokenService = new TokenRegistryService();
  await tokenService.registerToken({
    symbol: symbol as string,
    name: name as string,
    contractAddress: tokenAddress.toLowerCase(),
    chain: "base",
    decimals: Number(decimals),
    logoUrl: undefined, // Could fetch from a token list
    description: `Registered via RegistrationHelper by ${registeredBy}`,
    poolAddress: pool, // Store pool address for price feed lookups
  });

  console.log(
    `[Base Listener] ✅ Successfully registered ${symbol} (${tokenAddress}) with pool ${pool} to database`,
  );
}

/**
 * Backfill historical events (run once after deployment)
 */
export async function backfillBaseEvents(fromBlock?: bigint) {
  const registrationHelperAddress = getRegistrationHelperForChain(8453);
  if (!registrationHelperAddress) {
    throw new Error("RegistrationHelper not configured for Base mainnet");
  }

  // Server-side: use Alchemy directly
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) {
    throw new Error("ALCHEMY_API_KEY not configured");
  }
  const rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const latestBlock = await client.getBlockNumber();
  const startBlock = fromBlock || latestBlock - BigInt(10000); // Last ~10k blocks

  console.log(`[Base Backfill] Fetching events from block ${startBlock} to ${latestBlock}`);

  const logs = await client.getLogs({
    address: registrationHelperAddress as `0x${string}`,
    event: {
      type: "event",
      name: "TokenRegistered",
      inputs: [
        { type: "bytes32", name: "tokenId", indexed: true },
        { type: "address", name: "tokenAddress", indexed: true },
        { type: "address", name: "pool", indexed: true },
        { type: "address", name: "oracle" },
        { type: "address", name: "registeredBy" },
      ],
    },
    fromBlock: startBlock,
    toBlock: latestBlock,
  });

  console.log(`[Base Backfill] Found ${logs.length} TokenRegistered events`);

  for (const log of logs) {
    await handleTokenRegistered(client as MinimalPublicClient, log as TokenRegisteredLog);
  }

  console.log("[Base Backfill] ✅ Backfill complete");
}
