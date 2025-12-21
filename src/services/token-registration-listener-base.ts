import { createPublicClient, http, parseAbi, type Abi } from "viem";
import { base } from "viem/chains";
import { TokenRegistryService } from "./tokenRegistry";
import { getRegistrationHelperForChain } from "@/config/contracts";
import type { MinimalPublicClient, ReadContractParams } from "@/lib/viem-utils";

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
    throw new Error(
      "[Base Listener] ALCHEMY_API_KEY not configured - cannot start listener",
    );
  }
  const rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  console.log(
    "[Base Listener] Starting listener for",
    registrationHelperAddress,
  );
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
        await handleTokenRegistered(
          client as MinimalPublicClient,
          log as TokenRegisteredLog,
        );
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
async function handleTokenRegistered(
  client: MinimalPublicClient,
  log: TokenRegisteredLog,
) {
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

  console.log(
    `[Base Backfill] Fetching events from block ${startBlock} to ${latestBlock}`,
  );

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
    await handleTokenRegistered(
      client as MinimalPublicClient,
      log as TokenRegisteredLog,
    );
  }

  console.log("[Base Backfill] ✅ Backfill complete");
}
