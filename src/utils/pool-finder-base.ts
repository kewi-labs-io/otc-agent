/**
 * EVM Pool Finder
 *
 * Finds liquidity pools for EVM tokens across DEXs (Uniswap V3, etc.)
 * Used for price discovery and token registration.
 *
 * CACHING STRATEGY:
 * - Uses retry-cache module with 30s TTL for pool data
 * - Intended for server-side API routes (e.g., /api/token-pool-check)
 * - For client-side React components, use usePoolCheck hook which wraps the API
 * - Direct client-side calls will use the same cache but bypass React Query
 */
import {
  type Abi,
  type Address,
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
} from "viem";
import { base, baseSepolia, bsc, bscTestnet, mainnet, sepolia } from "viem/chains";
import { getCached, setCache, withRetryAndCache } from "./retry-cache";

/**
 * Type-safe wrapper for readContract calls in this module.
 * viem 2.40+ has strict generics that require compile-time ABI inference.
 * This wrapper allows us to use dynamic ABIs while maintaining type safety on return values.
 */
async function poolReadContract<T>(
  client: PublicClient,
  params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  },
): Promise<T> {
  // Cast is necessary for dynamic ABIs - viem's generics require compile-time inference
  type ReadContractParams = Parameters<typeof client.readContract>[0];
  return client.readContract(params as ReadContractParams) as Promise<T>;
}

// Cache TTL for pool info (30 seconds)
const POOL_CACHE_TTL_MS = 30_000;

// Configuration by Chain ID
const CONFIG: Record<
  number,
  {
    uniV3Factory: string;
    uniV4PoolManager?: string;
    uniV4StateView?: string;
    clankerHook?: string; // Clanker v4 uses specific hook
    aerodromeFactory?: string;
    aerodromeCLFactory?: string;
    aerodromeCLFactory2?: string; // Aerodrome Slipstream 2 - community/newer pools
    pancakeswapFactory?: string;
    usdc: string;
    usdt?: string; // USDT stablecoin (for Ethereum mainly)
    weth: string;
    rpcUrl: string; // Proxy route path (e.g. "/api/rpc/base") - uses Alchemy server-side
    nativeToken: string;
    nativeTokenPriceEstimate: number; // For TVL estimation
  }
> = {
  // Ethereum Mainnet
  1: {
    uniV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Official Uniswap V3 Factory
    // Uniswap V4 addresses - deployed Jan 2025
    uniV4PoolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    uniV4StateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Tether USD
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    // Always use Alchemy via proxy route
    rpcUrl: "/api/rpc/ethereum",
    nativeToken: "ETH",
    nativeTokenPriceEstimate: 3200,
  },
  // Ethereum Sepolia
  11155111: {
    uniV3Factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c", // Uniswap V3 Factory on Sepolia
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    rpcUrl: "https://rpc.sepolia.org",
    nativeToken: "ETH",
    nativeTokenPriceEstimate: 3200,
  },
  // Base Mainnet
  8453: {
    uniV3Factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    // Uniswap V4 addresses - for Clanker v4 support
    uniV4PoolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    uniV4StateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
    // ClankerHookStaticFee - the main hook used by Clanker v4 tokens
    clankerHook: "0x6C24D0bCC264EF6A740754A11cA579b9d225e8Cc",
    aerodromeFactory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    // Aerodrome Slipstream (Velodrome CL) PoolFactory - verified from official deployment
    // https://github.com/velodrome-finance/slipstream
    aerodromeCLFactory: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
    // Aerodrome Slipstream 2 - Community/newer pools factory
    aerodromeCLFactory2: "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth: "0x4200000000000000000000000000000000000006",
    // Always use Alchemy via proxy route
    rpcUrl: "/api/rpc/base",
    nativeToken: "ETH",
    nativeTokenPriceEstimate: 3200,
  },
  // Base Sepolia
  84532: {
    uniV3Factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", // Official Uniswap V3 Factory on Base Sepolia
    // Aerodrome not officially on Sepolia, using same address will fail, so undefined
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
    weth: "0x4200000000000000000000000000000000000006", // Base Sepolia WETH
    rpcUrl: "https://sepolia.base.org",
    nativeToken: "ETH",
    nativeTokenPriceEstimate: 3200,
  },
  // BSC Mainnet
  56: {
    uniV3Factory: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7", // Uniswap V3 Factory
    pancakeswapFactory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", // PancakeSwap V3 Factory
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // Binance-Peg USDC
    weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
    rpcUrl: process.env.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
    nativeToken: "BNB",
    nativeTokenPriceEstimate: 650,
  },
  // BSC Testnet
  97: {
    uniV3Factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", // PancakeSwap V3 Factory (Uniswap forks often share addresses on testnets or use same factory logic)
    pancakeswapFactory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
    usdc: "0x64544969ed7EBf5f083679233325356EbE738930", // USDC on BSC Testnet
    weth: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", // WBNB on BSC Testnet
    rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
    nativeToken: "BNB",
    nativeTokenPriceEstimate: 650,
  },
};

// Uniswap: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%)
// PancakeSwap: 100 (0.01%), 500 (0.05%), 2500 (0.25%), 10000 (1%)
// Aerodrome CL: Uses tickSpacing instead of fee. Common: 1, 50, 100, 200, 2000
// Fee mapping: tickSpacing 1 = 0.01%, 50 = 0.05%, 100 = 0.2%, 200 = 0.3%, 2000 = 1%
const FEE_TIERS = [100, 500, 2500, 3000, 10000];
const TICK_SPACINGS = [1, 50, 100, 200, 2000];

export interface PoolInfo {
  protocol:
    | "Uniswap V3"
    | "Aerodrome"
    | "Aerodrome Slipstream"
    | "Velodrome CL"
    | "SushiSwap V3"
    | "Pancakeswap V3";
  address: string;
  token0: string;
  token1: string;
  fee?: number; // Only for Uniswap V3 / Pancake V3
  tickSpacing?: number; // Only for Aerodrome Slipstream
  stable?: boolean; // Only for Aerodrome V2
  liquidity: bigint;
  tvlUsd: number;
  priceUsd?: number; // Estimated price in USD
  baseToken: "USDC" | "WETH";
}

const uniFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
]);

const aeroFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)",
]);

const aeroCLFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool)",
]);

const erc20Abi = parseAbi(["function decimals() external view returns (uint8)"]);

const uniPoolAbi = parseAbi([
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function liquidity() external view returns (uint128)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

// Aerodrome Slipstream pools have a different slot0 signature (no feeProtocol)
const aeroSlipstreamPoolAbi = parseAbi([
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function liquidity() external view returns (uint128)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
]);

const aeroPoolAbi = parseAbi([
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function reserve0() external view returns (uint256)",
  "function reserve1() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function symbol() external view returns (string)",
]);

// Uniswap V4 StateView ABI - for reading pool state
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity)",
]);

// V4 fee tiers and tick spacings used by Clanker
// Clanker typically uses 10000 (1%) fee with tickSpacing 200
const V4_FEE_TIERS = [100, 500, 3000, 10000];
const V4_TICK_SPACINGS: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

/**
 * Find ALL pools for a given token (sorted by TVL descending)
 * @param tokenAddress The token to find pools for
 * @param chainId The chain ID to search on (default: Base Mainnet 8453)
 * @returns Array of all valid pool information sorted by TVL
 */
export async function findAllPools(
  tokenAddress: string,
  chainId: number = 8453,
): Promise<PoolInfo[]> {
  const cacheKey = `all-pools:${chainId}:${tokenAddress.toLowerCase()}`;

  // Check cache first
  const cached = getCached<PoolInfo[]>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const allPools = await fetchAllPoolsInternal(tokenAddress, chainId);

  // Filter out pools with invalid addresses
  const validPools = allPools.filter((pool) => {
    const addr = pool.address;
    return typeof addr === "string" && addr.startsWith("0x") && addr.length === 42;
  });

  // Deduplicate by address (case-insensitive) - keep highest TVL for each address
  const seenAddresses = new Map<string, PoolInfo>();
  for (const pool of validPools) {
    const normalizedAddr = pool.address.toLowerCase();
    const existing = seenAddresses.get(normalizedAddr);
    if (!existing || pool.tvlUsd > existing.tvlUsd) {
      seenAddresses.set(normalizedAddr, pool);
    }
  }

  // Sort by TVL descending
  const dedupedPools = Array.from(seenAddresses.values()).sort((a, b) => b.tvlUsd - a.tvlUsd);

  setCache(cacheKey, dedupedPools, POOL_CACHE_TTL_MS);
  return dedupedPools;
}

/**
 * Internal function to fetch all pools from all sources
 */
async function fetchAllPoolsInternal(tokenAddress: string, chainId: number): Promise<PoolInfo[]> {
  const config = CONFIG[chainId];
  if (!config) throw new Error(`Unsupported chain ID: ${chainId}`);

  // Determine chain based on chainId
  const chain =
    chainId === 1
      ? mainnet
      : chainId === 11155111
        ? sepolia
        : chainId === 84532
          ? baseSepolia
          : chainId === 56
            ? bsc
            : chainId === 97
              ? bscTestnet
              : base;

  // Determine which RPC URL to use:
  // - In browser: use relative proxy route (e.g., "/api/rpc/base")
  // - Server-side: prepend localhost to make it a full URL
  const isBrowser = typeof window !== "undefined";
  // FAIL-FAST: PORT must be configured for server-side requests
  if (!isBrowser && !process.env.PORT) {
    throw new Error("PORT environment variable is required for server-side RPC requests");
  }
  // PORT is guaranteed to exist here (checked above for server-side)
  const port = process.env.PORT ?? "4444";
  const baseUrl = isBrowser ? "" : `http://localhost:${port}`;
  const effectiveRpcUrl = config.rpcUrl.startsWith("/")
    ? `${baseUrl}${config.rpcUrl}`
    : config.rpcUrl;

  if (process.env.NODE_ENV === "development") {
    console.log(`[PoolFinder] Using RPC: ${effectiveRpcUrl} (browser: ${isBrowser})`);
  }

  // Create client with explicit type to avoid deep type instantiation
  // viem's PublicClient has extremely deep generic types that cause TypeScript performance issues
  // This cast bypasses type checking while preserving runtime behavior
  const client = createPublicClient({
    chain,
    transport: http(effectiveRpcUrl),
  }) as PublicClient;

  const promises = [findUniswapV3Pools(client, tokenAddress, config)];

  // Uniswap V4 pools (for Clanker v4 support)
  if (config.uniV4PoolManager && config.uniV4StateView) {
    promises.push(findUniswapV4Pools(client, tokenAddress, config));
  }

  // Aerodrome Slipstream (CL) pools - compatible with UniswapV3TWAPOracle (Uniswap V3 interface)
  if (config.aerodromeCLFactory) {
    promises.push(findAerodromeCLPools(client, tokenAddress, config, config.aerodromeCLFactory));
  }

  // Aerodrome Slipstream 2 (community/newer pools)
  if (config.aerodromeCLFactory2) {
    promises.push(findAerodromeCLPools(client, tokenAddress, config, config.aerodromeCLFactory2));
  }

  if (config.pancakeswapFactory) {
    promises.push(findPancakeswapPools(client, tokenAddress, config));
  }

  // GeckoTerminal for V4 pools (catches pools with unknown hooks)
  // and ALL V3-compatible pools (catches pools our on-chain queries might miss)
  if (chainId === 8453) {
    // Base
    promises.push(findGeckoTerminalV4Pools(tokenAddress, "base", config));
    promises.push(findGeckoTerminalAllPools(tokenAddress, "base", config));
  } else if (chainId === 1) {
    // Ethereum mainnet
    promises.push(findGeckoTerminalV4Pools(tokenAddress, "eth", config));
    promises.push(findGeckoTerminalAllPools(tokenAddress, "eth", config));
  }

  const results = await Promise.all(promises);
  const allPools = results.flat();

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[PoolFinder] Found ${allPools.length} pools for ${tokenAddress} on chain ${chainId}`,
    );
    if (allPools.length > 0) {
      allPools.forEach((p, i) => {
        const isInvalidAddr = p.address.length !== 42;
        console.log(
          `[PoolFinder]   ${i + 1}. ${p.protocol} ${p.address.slice(0, 42)}${isInvalidAddr ? "... (INVALID)" : ""} TVL=$${p.tvlUsd.toFixed(2)}`,
        );
      });
    }
  }

  // If no pools found or all have very low TVL, try CoinGecko as fallback
  if (allPools.length === 0 || allPools.every((p) => p.tvlUsd < 100)) {
    const coinGeckoPool = await findCoinGeckoPrice(tokenAddress, chainId, config);
    if (coinGeckoPool) {
      allPools.push(coinGeckoPool);
    }
  }

  return allPools;
}

/**
 * Find best pool (highest TVL) for a given token
 * @param tokenAddress The token to find pools for
 * @param chainId The chain ID to search on (default: Base Mainnet 8453)
 * @returns Single best pool or null if none found
 */
export async function findBestPool(
  tokenAddress: string,
  chainId: number = 8453,
): Promise<PoolInfo | null> {
  const cacheKey = `pool:${chainId}:${tokenAddress.toLowerCase()}`;

  // Check cache first
  const cached = getCached<PoolInfo | null>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const allPools = await fetchAllPoolsInternal(tokenAddress, chainId);

  // Filter out pools with invalid addresses (e.g., V4 poolIds which are 32-byte hashes)
  const validPools = allPools.filter((pool) => {
    const addr = pool.address;
    const isValidLength = typeof addr === "string" && addr.startsWith("0x") && addr.length === 42;
    if (!isValidLength && process.env.NODE_ENV === "development") {
      console.warn(
        `[PoolFinder] Filtering out pool with invalid address (${addr.length} chars): ${addr.slice(0, 20)}...`,
      );
    }
    return isValidLength;
  });

  if (validPools.length === 0) {
    setCache(cacheKey, null, POOL_CACHE_TTL_MS);
    return null;
  }

  // Sort by TVL descending
  validPools.sort((a, b) => b.tvlUsd - a.tvlUsd);

  // Return pool with highest TVL
  const bestPool = validPools[0];

  if (bestPool.tvlUsd < 1000 && process.env.NODE_ENV === "development") {
    console.warn(
      `[PoolFinder] Warning: Best pool has low TVL ($${bestPool.tvlUsd.toFixed(2)}). Pool may have limited liquidity.`,
    );
  }

  setCache(cacheKey, bestPool, POOL_CACHE_TTL_MS);
  return bestPool;
}

/**
 * Find Uniswap V3 pools with retry and caching
 */
async function findUniswapV3Pools(
  client: PublicClient,
  tokenAddress: string,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo[]> {
  const pools: PoolInfo[] = [];

  // Helper to check a pool with retry - let errors propagate (fail-fast)
  const checkPool = async (
    baseTokenAddress: string,
    baseTokenSymbol: "USDC" | "WETH",
    fee: number,
  ) => {
    const poolAddress = await withRetryAndCache(
      `uni-v3-pool:${config.uniV3Factory}:${tokenAddress}:${baseTokenAddress}:${fee}`,
      async () => {
        return poolReadContract<Address>(client, {
          address: config.uniV3Factory as Address,
          abi: uniFactoryAbi as Abi,
          functionName: "getPool",
          args: [tokenAddress as `0x${string}`, baseTokenAddress as `0x${string}`, fee],
        });
      },
      { cacheTtlMs: POOL_CACHE_TTL_MS },
    );

    if (poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000") {
      const poolInfo = await getUniPoolInfo(
        client,
        poolAddress,
        baseTokenSymbol,
        fee,
        config,
        tokenAddress,
      );
      if (poolInfo) pools.push(poolInfo);
    }
  };

  // Check all combinations
  // Only check USDC if NOT on BSC, because BSC USDC is 18 decimals and breaks UniswapV3TWAPOracle
  if (config.nativeToken !== "BNB") {
    await Promise.all([
      ...FEE_TIERS.map((fee) => checkPool(config.usdc, "USDC", fee)),
      ...FEE_TIERS.map((fee) => checkPool(config.weth, "WETH", fee)),
    ]);
  } else {
    // BSC: Only check WETH (WBNB)
    await Promise.all([...FEE_TIERS.map((fee) => checkPool(config.weth, "WETH", fee))]);
  }

  return pools;
}

/**
 * Compute Uniswap V4 PoolId from PoolKey components
 * PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
 * In V4, Currency is just address (address(0) for native ETH)
 */
function computeV4PoolId(
  currency0: Address,
  currency1: Address,
  fee: number,
  tickSpacing: number,
  hooks: Address,
): `0x${string}` {
  // Sort currencies - currency0 must be < currency1
  const [sorted0, sorted1] =
    BigInt(currency0) < BigInt(currency1) ? [currency0, currency1] : [currency1, currency0];

  // PoolKey struct: (Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, IHooks hooks)
  // Use abi.encode (not packed) - each field is padded to 32 bytes
  const encoded = encodeAbiParameters(
    [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
    [sorted0, sorted1, fee, tickSpacing, hooks],
  );
  return keccak256(encoded);
}

/**
 * Find Uniswap V4 pools (for Clanker v4 support)
 * V4 uses a singleton PoolManager - pools are identified by PoolKey hash
 */
async function findUniswapV4Pools(
  client: PublicClient,
  tokenAddress: string,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo[]> {
  if (!config.uniV4PoolManager || !config.uniV4StateView) return [];

  const pools: PoolInfo[] = [];

  if (process.env.NODE_ENV === "development") {
    console.log(`[PoolFinder] Checking V4 pools for ${tokenAddress}`);
  }

  // Helper to check a V4 pool - let errors propagate (fail-fast)
  const checkPool = async (
    baseTokenAddress: string,
    baseTokenSymbol: "USDC" | "WETH",
    fee: number,
    hookAddress: Address,
  ) => {
    // FAIL-FAST: Fee must exist in V4_TICK_SPACINGS mapping
    const tickSpacing = V4_TICK_SPACINGS[fee];
    if (tickSpacing === undefined) {
      throw new Error(
        `Unsupported V4 fee tier: ${fee}. Supported fees: ${Object.keys(V4_TICK_SPACINGS).join(", ")}`,
      );
    }
    const poolId = computeV4PoolId(
      tokenAddress as Address,
      baseTokenAddress as Address,
      fee,
      tickSpacing,
      hookAddress,
    );

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[PoolFinder] V4 checking poolId=${poolId.slice(0, 18)}... fee=${fee} tick=${tickSpacing} hook=${hookAddress.slice(0, 10)}...`,
      );
    }

    // Try to get slot0 - if it reverts, pool doesn't exist
    const [slot0Result, liquidityResult] = await Promise.all([
      withRetryAndCache(
        `v4-slot0:${poolId}`,
        async () => {
          return poolReadContract<readonly [bigint, number, number, number]>(client, {
            address: config.uniV4StateView as Address,
            abi: stateViewAbi as Abi,
            functionName: "getSlot0",
            args: [poolId],
          });
        },
        { cacheTtlMs: POOL_CACHE_TTL_MS },
      ),
      withRetryAndCache(
        `v4-liq:${poolId}`,
        async () => {
          return poolReadContract<bigint>(client, {
            address: config.uniV4StateView as Address,
            abi: stateViewAbi as Abi,
            functionName: "getLiquidity",
            args: [poolId],
          });
        },
        { cacheTtlMs: POOL_CACHE_TTL_MS },
      ),
    ]);

    // If slot0 returns valid data (sqrtPriceX96 > 0), pool exists
    if (slot0Result && slot0Result[0] > 0n) {
      const sqrtPriceX96 = slot0Result[0];
      // FAIL-FAST: liquidityResult should be defined if slot0Result exists
      // Liquidity can be 0n (valid), but undefined means the call failed
      if (liquidityResult === undefined) {
        throw new Error("Liquidity query failed but slot0 succeeded - inconsistent pool state");
      }
      const liquidity = liquidityResult;

      // Sort tokens to determine which is token0/token1
      const [token0, token1] =
        BigInt(tokenAddress) < BigInt(baseTokenAddress)
          ? [tokenAddress, baseTokenAddress]
          : [baseTokenAddress, tokenAddress];

      // Calculate TVL and price
      const tvlUsd = calculateV3TVL(
        liquidity,
        sqrtPriceX96,
        token0,
        token1,
        baseTokenSymbol,
        config,
      );

      // Calculate price
      const isToken0Target = token0.toLowerCase() === tokenAddress.toLowerCase();
      const Q96 = 2n ** 96n;
      const sqrtP = Number(sqrtPriceX96) / Number(Q96);
      const price0in1 = sqrtP * sqrtP;

      // Decimals: token is 18, USDC is 6, WETH is 18
      const tokenDecimals = 18;
      const baseDecimals = baseTokenSymbol === "USDC" ? 6 : 18;
      const decimalAdjustment = isToken0Target
        ? 10 ** (tokenDecimals - baseDecimals)
        : 10 ** (baseDecimals - tokenDecimals);
      const price0in1Adjusted = price0in1 * decimalAdjustment;

      const baseTokenPrice = baseTokenSymbol === "USDC" ? 1 : config.nativeTokenPriceEstimate;
      const priceUsd = isToken0Target
        ? price0in1Adjusted * baseTokenPrice
        : (1 / price0in1Adjusted) * baseTokenPrice;

      pools.push({
        protocol: "Uniswap V3", // Report as V3 for oracle compatibility
        address: poolId, // V4 pools don't have separate addresses, use poolId
        token0,
        token1,
        fee,
        tickSpacing,
        liquidity,
        tvlUsd,
        priceUsd,
        baseToken: baseTokenSymbol,
      });

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[PoolFinder] Found V4 pool: ${poolId} fee=${fee} tickSpacing=${tickSpacing} TVL=$${tvlUsd.toFixed(2)}`,
        );
      }
    }
  };

  // Check pools with known hooks
  // Clanker frequently deploys new hook versions - keep this list updated
  const hookAddresses: Address[] = [
    // Latest Clanker V4 Hook (as of Dec 2025)
    "0xd60D6B218116cFd801E28F78d011a203D2b068Cc",
    // ClankerHookStaticFee v4.0.0 (newer version)
    "0xDd5EeaFf7BD481AD55Db083062b13a3cdf0A68CC",
    // ClankerHookStaticFee (original)
    "0x6C24D0bCC264EF6A740754A11cA579b9d225e8Cc",
    // ClankerHookDynamicFee v4.0.0
    "0x34a45c6b61876d739400bd71228cbcbd4f53e8cc",
    // No hook (vanilla V4 pools)
    "0x0000000000000000000000000000000000000000",
  ];

  // Add configured hook if not already in list
  if (config.clankerHook && !hookAddresses.includes(config.clankerHook as Address)) {
    hookAddresses.unshift(config.clankerHook as Address);
  }

  // Check all combinations
  const checks: Promise<void>[] = [];
  for (const hook of hookAddresses) {
    for (const fee of V4_FEE_TIERS) {
      // Check WETH pairs
      checks.push(checkPool(config.weth, "WETH", fee, hook));
      // V4 uses address(0) for native ETH - check those too
      checks.push(checkPool("0x0000000000000000000000000000000000000000", "WETH", fee, hook));
    }
  }

  await Promise.all(checks);

  return pools;
}

/**
 * Find Aerodrome Slipstream (CL) pools
 * These are compatible with UniswapV3TWAPOracle (Uniswap V3 interface)
 * Uses the official Velodrome Slipstream PoolFactory
 * @param factoryAddress - The Aerodrome CL factory address to query
 */
async function findAerodromeCLPools(
  client: PublicClient,
  tokenAddress: string,
  config: (typeof CONFIG)[number],
  factoryAddress: string,
): Promise<PoolInfo[]> {
  if (!factoryAddress) return [];

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[PoolFinder] Checking Aerodrome CL pools for ${tokenAddress} (factory: ${factoryAddress.slice(0, 10)}...)`,
    );
  }

  const pools: PoolInfo[] = [];

  // Helper to check a pool with retry
  const checkPool = async (
    baseTokenAddress: string,
    baseTokenSymbol: "USDC" | "WETH",
    tickSpacing: number,
  ) => {
    const poolAddress = await withRetryAndCache(
      `aero-cl-pool:${factoryAddress}:${tokenAddress}:${baseTokenAddress}:${tickSpacing}`,
      async () => {
        return poolReadContract<Address>(client, {
          address: factoryAddress as Address,
          abi: aeroCLFactoryAbi as Abi,
          functionName: "getPool",
          args: [tokenAddress as Address, baseTokenAddress as Address, tickSpacing],
        });
      },
      { cacheTtlMs: POOL_CACHE_TTL_MS },
    );

    if (process.env.NODE_ENV === "development") {
      console.log(`[PoolFinder] Aerodrome CL ${baseTokenSymbol}/${tickSpacing}: ${poolAddress}`);
    }

    if (poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000") {
      // Use getAeroSlipstreamPoolInfo for Aerodrome CL pools (different slot0 signature)
      const poolInfo = await getAeroSlipstreamPoolInfo(
        client,
        poolAddress,
        baseTokenSymbol,
        tickSpacing,
        config,
        tokenAddress,
      );
      if (poolInfo) {
        pools.push(poolInfo);
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[PoolFinder] Found Aerodrome CL pool: ${poolAddress} TVL=$${poolInfo.tvlUsd.toFixed(2)}`,
          );
        }
      }
    }
  };

  // Check all combinations
  // On Base, check both USDC and WETH
  await Promise.all([
    ...TICK_SPACINGS.map((ts) => checkPool(config.usdc, "USDC", ts)),
    ...TICK_SPACINGS.map((ts) => checkPool(config.weth, "WETH", ts)),
  ]);

  return pools;
}

/**
 * GeckoTerminal API response types
 */
interface GeckoTerminalPool {
  id: string;
  attributes: {
    address: string;
    name: string;
    base_token_price_usd: string;
    reserve_in_usd: string;
  };
  relationships: {
    dex: {
      data: {
        id: string;
      };
    };
    base_token: {
      data: {
        id: string;
      };
    };
    quote_token: {
      data: {
        id: string;
      };
    };
  };
}

interface GeckoTerminalResponse {
  data: GeckoTerminalPool[];
}

/**
 * Find Uniswap V4 pools via GeckoTerminal API
 * This is a fallback for when direct V4 queries don't find pools (e.g., unknown Clanker hooks)
 * GeckoTerminal indexes V4 pools and can find them regardless of which hook was used
 * @param network - GeckoTerminal network identifier (e.g., "base", "eth")
 */
async function findGeckoTerminalV4Pools(
  tokenAddress: string,
  network: string,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo[]> {
  const pools: PoolInfo[] = [];

  // Check cache first (synchronous, doesn't throw)
  const cacheKey = `gecko-v4:${network}:${tokenAddress.toLowerCase()}`;
  const cached = getCached<PoolInfo[]>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[PoolFinder] Checking GeckoTerminal for V4 pools on ${network}: ${tokenAddress}`);
  }

  // Use backend proxy to avoid CSP violations
  // In browser: use relative URL. Server-side: prepend localhost
  const isBrowser = typeof window !== "undefined";
  // FAIL-FAST: PORT must be configured for server-side requests
  if (!isBrowser && !process.env.PORT) {
    throw new Error("PORT environment variable is required for server-side GeckoTerminal requests");
  }
  // PORT is guaranteed to exist here (checked above for server-side)
  const port = process.env.PORT ?? "4444";
  const baseUrl = isBrowser ? "" : `http://localhost:${port}`;
  const proxyUrl = `${baseUrl}/api/pool-prices/geckoterminal?network=${network}&token=${tokenAddress.toLowerCase()}`;

  const response = await fetch(proxyUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`GeckoTerminal proxy error: ${response.status}`);
  }

  const data: GeckoTerminalResponse = await response.json();

  if (!data.data || data.data.length === 0) {
    setCache(cacheKey, pools, POOL_CACHE_TTL_MS);
    return pools;
  }

  // Filter for Uniswap V4 pools only (we handle V3 separately)
  // GeckoTerminal uses "uniswap-v4-base", "uniswap-v4-ethereum", etc.
  const v4DexId = network === "eth" ? "uniswap-v4-ethereum" : `uniswap-v4-${network}`;
  const v4Pools = data.data.filter((p) => p.relationships.dex.data.id === v4DexId);

  if (process.env.NODE_ENV === "development") {
    console.log(`[PoolFinder] GeckoTerminal found ${v4Pools.length} V4 pools for ${tokenAddress}`);
  }

  for (const pool of v4Pools) {
    // Determine base token (WETH, USDC, or USDT)
    const quoteTokenId = pool.relationships.quote_token.data.id;
    const isWethPair = quoteTokenId.toLowerCase().includes(config.weth.toLowerCase());
    const isUsdcPair = quoteTokenId.toLowerCase().includes(config.usdc.toLowerCase());
    const isUsdtPair =
      config.usdt && quoteTokenId.toLowerCase().includes(config.usdt.toLowerCase());

    if (!isWethPair && !isUsdcPair && !isUsdtPair) continue; // Skip non-standard pairs

    // USDT is treated as USDC for pricing purposes (both are $1 stablecoins)
    const baseToken: "WETH" | "USDC" = isWethPair ? "WETH" : "USDC";
    const quoteTokenAddress = isWethPair ? config.weth : isUsdcPair ? config.usdc : config.usdt;

    // FAIL-FAST: Validate quote token address is configured
    if (!quoteTokenAddress) {
      throw new Error(
        `Quote token address not configured for chain. Expected WETH, USDC, or USDT.`,
      );
    }
    const quoteAddr = quoteTokenAddress;

    // FAIL-FAST: Validate numeric values from API
    const tvlUsdRaw = parseFloat(pool.attributes.reserve_in_usd);
    const priceUsdRaw = parseFloat(pool.attributes.base_token_price_usd);
    if (Number.isNaN(tvlUsdRaw) || tvlUsdRaw < 0) {
      throw new Error(`Invalid TVL value from GeckoTerminal: ${pool.attributes.reserve_in_usd}`);
    }
    if (Number.isNaN(priceUsdRaw) || priceUsdRaw < 0) {
      throw new Error(
        `Invalid price value from GeckoTerminal: ${pool.attributes.base_token_price_usd}`,
      );
    }
    const tvlUsd = tvlUsdRaw;
    const priceUsd = priceUsdRaw;

    // V4 pool "address" is actually the poolId (bytes32 hash)
    const poolId = pool.attributes.address;

    // Determine token0/token1 from pool name or token IDs
    const baseTokenId = pool.relationships.base_token.data.id;
    const token0: string = baseTokenId.toLowerCase().includes(tokenAddress.toLowerCase())
      ? tokenAddress
      : quoteAddr;
    const token1: string = token0 === tokenAddress ? quoteAddr : tokenAddress;

    pools.push({
      protocol: "Uniswap V3", // Report as V3 for oracle compatibility (V4 uses same price format)
      address: poolId,
      token0,
      token1,
      fee: 10000, // Default 1%
      tickSpacing: 200,
      liquidity: 0n, // Not available from GeckoTerminal
      tvlUsd,
      priceUsd,
      baseToken,
    });

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[PoolFinder] GeckoTerminal V4 pool: ${poolId.slice(0, 18)}... TVL=$${tvlUsd.toFixed(2)} price=$${priceUsd}`,
      );
    }
  }

  setCache(cacheKey, pools, POOL_CACHE_TTL_MS);
  return pools;
}

/**
 * Find ALL V3-compatible pools via GeckoTerminal API
 * This catches pools from various DEXes (Uniswap V3, Aerodrome CL, SushiSwap, etc.)
 * that our direct on-chain queries might miss
 * @param network - GeckoTerminal network identifier (e.g., "base", "eth")
 */
async function findGeckoTerminalAllPools(
  tokenAddress: string,
  network: string,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo[]> {
  const pools: PoolInfo[] = [];

  // Check cache first (synchronous, doesn't throw)
  const cacheKey = `gecko-all:${network}:${tokenAddress.toLowerCase()}`;
  const cached = getCached<PoolInfo[]>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[PoolFinder] Checking GeckoTerminal for ALL pools on ${network}: ${tokenAddress}`);
  }

  const isBrowser = typeof window !== "undefined";
  // FAIL-FAST: PORT must be configured for server-side requests
  if (!isBrowser && !process.env.PORT) {
    throw new Error("PORT environment variable is required for server-side GeckoTerminal requests");
  }
  // PORT is guaranteed to exist here (checked above for server-side)
  const port = process.env.PORT ?? "4444";
  const baseUrl = isBrowser ? "" : `http://localhost:${port}`;
  const proxyUrl = `${baseUrl}/api/pool-prices/geckoterminal?network=${network}&token=${tokenAddress.toLowerCase()}`;

  const response = await fetch(proxyUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`GeckoTerminal proxy error: ${response.status}`);
  }

  const data: GeckoTerminalResponse = await response.json();

  if (!data.data || data.data.length === 0) {
    setCache(cacheKey, pools, POOL_CACHE_TTL_MS);
    return pools;
  }

  // V3-compatible DEX patterns (concentrated liquidity / TWAP compatible)
  const v3CompatibleDexPatterns = [
    "uniswap_v3",
    "uniswap-v3",
    "aerodrome-cl",
    "aerodrome_cl",
    "aerodrome-slipstream",
    "velodrome-cl",
    "velodrome_cl",
    "sushiswap-v3",
    "sushiswap_v3",
    "pancakeswap-v3",
    "pancakeswap_v3",
  ];

  // Filter for V3-compatible pools only (NOT V4 - those use poolIds not addresses)
  const v3Pools = data.data.filter((p) => {
    const dexId = p.relationships.dex.data.id.toLowerCase();
    // Must be V3-compatible but NOT V4
    return (
      v3CompatibleDexPatterns.some((pattern) => dexId.includes(pattern)) && !dexId.includes("v4")
    );
  });

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[PoolFinder] GeckoTerminal found ${v3Pools.length} V3-compatible pools for ${tokenAddress}`,
    );
  }

  for (const pool of v3Pools) {
    // Validate pool address is 20 bytes (filter out any V4 poolIds that slipped through)
    const poolAddress = pool.attributes.address;
    if (!poolAddress || poolAddress.length !== 42) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[PoolFinder] Skipping GeckoTerminal pool with invalid address: ${poolAddress}`,
        );
      }
      continue;
    }

    // Determine base token (WETH, USDC, or USDT)
    const quoteTokenId = pool.relationships.quote_token.data.id;
    const isWethPair = quoteTokenId.toLowerCase().includes(config.weth.toLowerCase());
    const isUsdcPair = quoteTokenId.toLowerCase().includes(config.usdc.toLowerCase());
    const isUsdtPair =
      config.usdt && quoteTokenId.toLowerCase().includes(config.usdt.toLowerCase());

    if (!isWethPair && !isUsdcPair && !isUsdtPair) continue;

    const baseToken: "WETH" | "USDC" = isWethPair ? "WETH" : "USDC";
    const quoteTokenAddress = isWethPair ? config.weth : isUsdcPair ? config.usdc : config.usdt;

    // FAIL-FAST: Validate quote token address is configured
    if (!quoteTokenAddress) {
      throw new Error(
        `Quote token address not configured for chain. Expected WETH, USDC, or USDT.`,
      );
    }
    const quoteAddr = quoteTokenAddress;

    // FAIL-FAST: Validate numeric values from API
    const tvlUsdRaw = parseFloat(pool.attributes.reserve_in_usd);
    const priceUsdRaw = parseFloat(pool.attributes.base_token_price_usd);
    if (Number.isNaN(tvlUsdRaw) || tvlUsdRaw < 0) {
      throw new Error(`Invalid TVL value from GeckoTerminal: ${pool.attributes.reserve_in_usd}`);
    }
    if (Number.isNaN(priceUsdRaw) || priceUsdRaw < 0) {
      throw new Error(
        `Invalid price value from GeckoTerminal: ${pool.attributes.base_token_price_usd}`,
      );
    }
    const tvlUsd = tvlUsdRaw;
    const priceUsd = priceUsdRaw;

    // Determine token ordering
    const baseTokenId = pool.relationships.base_token.data.id;
    const token0: string = baseTokenId.toLowerCase().includes(tokenAddress.toLowerCase())
      ? tokenAddress
      : quoteAddr;
    const token1: string = token0 === tokenAddress ? quoteAddr : tokenAddress;

    // Determine protocol name from DEX ID
    const dexId = pool.relationships.dex.data.id;
    let protocol: PoolInfo["protocol"] = "Uniswap V3";
    if (dexId.toLowerCase().includes("aerodrome")) {
      protocol = "Aerodrome Slipstream";
    } else if (dexId.toLowerCase().includes("velodrome")) {
      protocol = "Velodrome CL";
    } else if (dexId.toLowerCase().includes("sushiswap")) {
      protocol = "SushiSwap V3";
    } else if (dexId.toLowerCase().includes("pancakeswap")) {
      protocol = "Pancakeswap V3";
    }

    pools.push({
      protocol,
      address: poolAddress,
      token0,
      token1,
      fee: 3000, // Default 0.3% - actual fee may vary
      tickSpacing: 60,
      liquidity: 0n,
      tvlUsd,
      priceUsd,
      baseToken,
    });

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[PoolFinder] GeckoTerminal ${protocol}: ${poolAddress} TVL=$${tvlUsd.toFixed(2)} price=$${priceUsd}`,
      );
    }
  }

  setCache(cacheKey, pools, POOL_CACHE_TTL_MS);
  return pools;
}

/**
 * CoinGecko network ID mapping
 */
const COINGECKO_NETWORKS: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  56: "binance-smart-chain",
};

/**
 * CoinGecko API response type
 */
interface CoinGeckoTokenResponse {
  id: string;
  symbol: string;
  name: string;
  market_data?: {
    current_price?: {
      usd?: number;
    };
    market_cap?: {
      usd?: number;
    };
    total_volume?: {
      usd?: number;
    };
  };
}

/**
 * Find token price via CoinGecko API
 * This is a fallback for when DEX pools aren't found or have very low liquidity
 * Creates a "virtual" pool entry with CoinGecko price data
 */
async function findCoinGeckoPrice(
  tokenAddress: string,
  chainId: number,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo | null> {
  const network = COINGECKO_NETWORKS[chainId];
  if (!network) return null;

  // Check cache first (synchronous, doesn't throw)
  const cacheKey = `coingecko:${chainId}:${tokenAddress.toLowerCase()}`;
  const cached = getCached<PoolInfo | null>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[PoolFinder] Checking CoinGecko for price: ${tokenAddress}`);
  }

  // Use backend proxy to avoid CSP violations
  // In browser: use relative URL. Server-side: prepend localhost
  const isBrowser = typeof window !== "undefined";
  // FAIL-FAST: PORT must be configured for server-side requests
  if (!isBrowser && !process.env.PORT) {
    throw new Error("PORT environment variable is required for server-side CoinGecko requests");
  }
  // PORT is guaranteed to exist here (checked above for server-side)
  const port = process.env.PORT ?? "4444";
  const baseUrl = isBrowser ? "" : `http://localhost:${port}`;
  const proxyUrl = `${baseUrl}/api/pool-prices/coingecko-token?network=${network}&token=${tokenAddress.toLowerCase()}`;

  const response = await fetch(proxyUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[PoolFinder] CoinGecko proxy error (${response.status})`);
    }
    setCache(cacheKey, null, POOL_CACHE_TTL_MS);
    return null;
  }

  const data: CoinGeckoTokenResponse | null = await response.json();

  // Proxy returns null if token not found
  if (!data) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[PoolFinder] CoinGecko: Token not found`);
    }
    setCache(cacheKey, null, POOL_CACHE_TTL_MS);
    return null;
  }

  if (!data.market_data) {
    throw new Error("CoinGecko response missing market_data field");
  }
  // FAIL-FAST: Validate market_data structure
  if (!data.market_data.current_price) {
    throw new Error("CoinGecko response missing market_data.current_price field");
  }
  const priceUsd = data.market_data.current_price.usd;
  // market_cap and total_volume are optional fields - use 0 if missing
  const marketCap = data.market_data.market_cap?.usd ?? 0;
  const volume24h = data.market_data.total_volume?.usd ?? 0;

  if (priceUsd === undefined || priceUsd <= 0) {
    setCache(cacheKey, null, POOL_CACHE_TTL_MS);
    return null;
  }

  // Create a virtual pool entry with CoinGecko data
  // Use market cap as a proxy for TVL (not accurate but gives a sense of size)
  // Use volume as a better proxy for liquidity
  const estimatedTvl = Math.min(marketCap * 0.01, volume24h * 0.5); // Conservative estimate

  const pool: PoolInfo = {
    protocol: "Uniswap V3", // Report as V3 for compatibility
    address: `coingecko:${tokenAddress}`, // Virtual address
    token0: tokenAddress,
    token1: config.usdc,
    fee: 3000, // Default 0.3%
    liquidity: 0n,
    tvlUsd: estimatedTvl,
    priceUsd,
    baseToken: "USDC",
  };

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[PoolFinder] CoinGecko price found: $${priceUsd.toFixed(6)} (est. TVL: $${estimatedTvl.toFixed(0)})`,
    );
  }

  setCache(cacheKey, pool, POOL_CACHE_TTL_MS);
  return pool;
}

/**
 * Find Aerodrome pools (Stable + Volatile)
 * @internal Currently disabled pending token-agnostic deployment
 */
async function _findAerodromePools(
  client: PublicClient,
  tokenAddress: string,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo[]> {
  if (!config.aerodromeFactory) return [];

  const pools: PoolInfo[] = [];

  // Helper to check a pool
  const checkPool = async (
    baseTokenAddress: string,
    baseTokenSymbol: "USDC" | "WETH",
    stable: boolean,
  ) => {
    const poolAddress = await poolReadContract<Address>(client, {
      address: config.aerodromeFactory as Address,
      abi: aeroFactoryAbi as Abi,
      functionName: "getPool",
      args: [tokenAddress as Address, baseTokenAddress as Address, stable],
    });

    if (poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000") {
      const poolInfo = await getAeroPoolInfo(client, poolAddress, baseTokenSymbol, stable, config);
      if (poolInfo) pools.push(poolInfo);
    }
  };

  // Check Stable and Volatile for both base tokens
  await Promise.all([
    checkPool(config.usdc, "USDC", false), // Volatile
    checkPool(config.usdc, "USDC", true), // Stable
    checkPool(config.weth, "WETH", false), // Volatile
    checkPool(config.weth, "WETH", true), // Stable
  ]);

  return pools;
}

/**
 * Find PancakeSwap V3 pools (Same interface as Uniswap V3) with retry and caching
 */
async function findPancakeswapPools(
  client: PublicClient,
  tokenAddress: string,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo[]> {
  if (!config.pancakeswapFactory) return [];

  const pools: PoolInfo[] = [];

  // Helper to check a pool with retry - let errors propagate (fail-fast)
  const checkPool = async (
    baseTokenAddress: string,
    baseTokenSymbol: "USDC" | "WETH",
    fee: number,
  ) => {
    const poolAddress = await withRetryAndCache(
      `pancake-v3-pool:${config.pancakeswapFactory}:${tokenAddress}:${baseTokenAddress}:${fee}`,
      async () => {
        return poolReadContract<Address>(client, {
          address: config.pancakeswapFactory as Address,
          abi: uniFactoryAbi as Abi, // Compatible ABI
          functionName: "getPool",
          args: [tokenAddress as Address, baseTokenAddress as Address, fee],
        });
      },
      { cacheTtlMs: POOL_CACHE_TTL_MS },
    );

    if (poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000") {
      const poolInfo = await getUniPoolInfo(
        client,
        poolAddress,
        baseTokenSymbol,
        fee,
        config,
        tokenAddress,
      );
      if (poolInfo) {
        poolInfo.protocol = "Pancakeswap V3";
        pools.push(poolInfo);
      }
    }
  };

  // Check all combinations
  // Only check USDC if NOT on BSC, because BSC USDC is 18 decimals and breaks UniswapV3TWAPOracle
  if (config.nativeToken !== "BNB") {
    await Promise.all([
      ...FEE_TIERS.map((fee) => checkPool(config.usdc, "USDC", fee)),
      ...FEE_TIERS.map((fee) => checkPool(config.weth, "WETH", fee)),
    ]);
  } else {
    // BSC: Only check WETH (WBNB)
    await Promise.all([...FEE_TIERS.map((fee) => checkPool(config.weth, "WETH", fee))]);
  }

  return pools;
}

/**
 * Get detailed information about a Uniswap V3 pool
 */
async function getUniPoolInfo(
  client: PublicClient,
  poolAddress: string,
  baseToken: "USDC" | "WETH",
  fee: number,
  config: (typeof CONFIG)[number],
  targetTokenAddress: string,
): Promise<PoolInfo | null> {
  const [token0, token1, liquidity, slot0] = await Promise.all([
    poolReadContract<Address>(client, {
      address: poolAddress as Address,
      abi: uniPoolAbi as Abi,
      functionName: "token0",
    }),
    poolReadContract<Address>(client, {
      address: poolAddress as Address,
      abi: uniPoolAbi as Abi,
      functionName: "token1",
    }),
    poolReadContract<bigint>(client, {
      address: poolAddress as Address,
      abi: uniPoolAbi as Abi,
      functionName: "liquidity",
    }),
    poolReadContract<readonly [bigint, ...unknown[]]>(client, {
      address: poolAddress as Address,
      abi: uniPoolAbi as Abi,
      functionName: "slot0",
    }),
  ]);

  // Fetch decimals for price calculation
  const [decimals0, decimals1] = await Promise.all([
    poolReadContract<number>(client, {
      address: token0,
      abi: erc20Abi as Abi,
      functionName: "decimals",
    }),
    poolReadContract<number>(client, {
      address: token1,
      abi: erc20Abi as Abi,
      functionName: "decimals",
    }),
  ]);

  // Calculate real TVL using liquidity and sqrtPrice
  // slot0 returns a tuple: [sqrtPriceX96, tick, observationIndex, ...]
  const sqrtPriceX96 = slot0[0];
  const tvlUsd = calculateV3TVL(liquidity, sqrtPriceX96, token0, token1, baseToken, config);

  // Calculate Price in USD
  // Price of Token0 in terms of Token1 = (sqrtPriceX96 / 2^96)^2
  // Adjusted Price = Price * 10^(decimals0 - decimals1)
  // We want price of TargetToken in USD.

  let priceUsd = 0;
  const isToken0Target = (token0 as string).toLowerCase() === targetTokenAddress.toLowerCase();

  // P = price of Token0 in Token1 (raw)
  const Q96 = 2n ** 96n;
  // Use number for price calc (precision loss acceptable for validation)
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  const price0in1 = sqrtP * sqrtP;

  // Adjust for decimals: Price of 1 unit of Token0 = X units of Token1
  // Real Price 0 in 1 = price0in1 * 10^(decimals0 - decimals1) ??
  // Formula: price0 = (sqrtP^2) * (10^dec0 / 10^dec1) ??
  // Standard: price0 = price0in1 / (10^dec1 / 10^dec0) = price0in1 * 10^(dec0 - dec1)

  const decimalAdjustment = 10 ** (decimals0 - decimals1);
  const price0in1Adjusted = price0in1 * decimalAdjustment;

  // Base Token Price (USDC or ETH)
  let baseTokenPrice = 0;
  if (baseToken === "USDC") baseTokenPrice = 1;
  else baseTokenPrice = config.nativeTokenPriceEstimate; // e.g. 3200 for ETH

  if (isToken0Target) {
    // Target is Token0. We want price of Token0 in USD.
    // If Token1 is Base (Quote): Price0 = Price0in1 * PriceBase
    priceUsd = price0in1Adjusted * baseTokenPrice;
  } else {
    // Target is Token1. We want price of Token1 in USD.
    // Price1in0 = 1 / Price0in1
    // Price1 = (1 / price0in1Adjusted) * PriceBase
    priceUsd = (1 / price0in1Adjusted) * baseTokenPrice;
  }

  return {
    protocol: "Uniswap V3",
    address: poolAddress,
    token0: token0 as string,
    token1: token1 as string,
    fee,
    liquidity: BigInt(liquidity.toString()),
    tvlUsd,
    priceUsd,
    baseToken,
  };
}

/**
 * Get detailed information about an Aerodrome Slipstream (CL) pool
 * Uses different slot0 signature than Uniswap V3 (no feeProtocol field)
 */
async function getAeroSlipstreamPoolInfo(
  client: PublicClient,
  poolAddress: string,
  baseToken: "USDC" | "WETH",
  tickSpacing: number,
  config: (typeof CONFIG)[number],
  targetTokenAddress: string,
): Promise<PoolInfo | null> {
  const [token0, token1, liquidity, slot0] = await Promise.all([
    poolReadContract<Address>(client, {
      address: poolAddress as Address,
      abi: aeroSlipstreamPoolAbi as Abi,
      functionName: "token0",
    }),
    poolReadContract<Address>(client, {
      address: poolAddress as Address,
      abi: aeroSlipstreamPoolAbi as Abi,
      functionName: "token1",
    }),
    poolReadContract<bigint>(client, {
      address: poolAddress as Address,
      abi: aeroSlipstreamPoolAbi as Abi,
      functionName: "liquidity",
    }),
    poolReadContract<readonly [bigint, ...unknown[]]>(client, {
      address: poolAddress as Address,
      abi: aeroSlipstreamPoolAbi as Abi,
      functionName: "slot0",
    }),
  ]);

  // Fetch decimals for price calculation
  const [decimals0, decimals1] = await Promise.all([
    poolReadContract<number>(client, {
      address: token0,
      abi: erc20Abi as Abi,
      functionName: "decimals",
    }),
    poolReadContract<number>(client, {
      address: token1,
      abi: erc20Abi as Abi,
      functionName: "decimals",
    }),
  ]);

  // Calculate real TVL using liquidity and sqrtPrice
  // slot0 returns a tuple: [sqrtPriceX96, tick, observationIndex, ...]
  const sqrtPriceX96 = slot0[0];
  const tvlUsd = calculateV3TVL(liquidity, sqrtPriceX96, token0, token1, baseToken, config);

  // Calculate Price in USD
  let priceUsd = 0;
  const isToken0Target = (token0 as string).toLowerCase() === targetTokenAddress.toLowerCase();

  const Q96 = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  const price0in1 = sqrtP * sqrtP;

  const decimalAdjustment = 10 ** (decimals0 - decimals1);
  const price0in1Adjusted = price0in1 * decimalAdjustment;

  let baseTokenPrice = 0;
  if (baseToken === "USDC") baseTokenPrice = 1;
  else baseTokenPrice = config.nativeTokenPriceEstimate;

  if (isToken0Target) {
    priceUsd = price0in1Adjusted * baseTokenPrice;
  } else {
    priceUsd = (1 / price0in1Adjusted) * baseTokenPrice;
  }

  return {
    protocol: "Aerodrome Slipstream",
    address: poolAddress,
    token0: token0 as string,
    token1: token1 as string,
    tickSpacing,
    liquidity: BigInt(liquidity.toString()),
    tvlUsd,
    priceUsd,
    baseToken,
  };
}

/**
 * Get detailed information about an Aerodrome pool
 */
async function getAeroPoolInfo(
  client: PublicClient,
  poolAddress: string,
  baseToken: "USDC" | "WETH",
  stable: boolean,
  config: (typeof CONFIG)[number],
): Promise<PoolInfo | null> {
  const [token0, token1, reserve0, reserve1] = await Promise.all([
    poolReadContract<Address>(client, {
      address: poolAddress as Address,
      abi: aeroPoolAbi as Abi,
      functionName: "token0",
    }),
    poolReadContract<Address>(client, {
      address: poolAddress as Address,
      abi: aeroPoolAbi as Abi,
      functionName: "token1",
    }),
    poolReadContract<bigint>(client, {
      address: poolAddress as Address,
      abi: aeroPoolAbi as Abi,
      functionName: "reserve0",
    }),
    poolReadContract<bigint>(client, {
      address: poolAddress as Address,
      abi: aeroPoolAbi as Abi,
      functionName: "reserve1",
    }),
  ]);

  // Determine which reserve corresponds to the base token to estimate TVL
  // Note: This is a simplification. In production we should check decimals.
  const baseAddress = baseToken === "USDC" ? config.usdc : config.weth;
  const isToken0Base = token0.toLowerCase() === baseAddress.toLowerCase();
  const baseReserve = isToken0Base ? reserve0 : reserve1;

  // Estimate TVL: Base Reserve * 2 (assuming 50/50 pool value)
  // This works for both volatile and stable pools roughly
  const liquidity = baseReserve;

  // Normalize liquidity for the estimateTVL function which expects "units" roughly matching V3
  // But for V2 style, we can just calculate USD value directly
  let tvlUsd = 0;
  if (baseToken === "USDC") {
    tvlUsd = (Number(liquidity) / 1e6) * 2;
  } else {
    tvlUsd = (Number(liquidity) / 1e18) * 3000 * 2;
  }

  return {
    protocol: "Aerodrome",
    address: poolAddress,
    token0: token0 as string,
    token1: token1 as string,
    stable,
    liquidity, // This is raw reserve, different from V3 liquidity
    tvlUsd,
    baseToken,
  };
}

/**
 * Calculate V3 TVL in USD
 */
function calculateV3TVL(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  token0: string,
  _token1: string,
  baseTokenSymbol: "USDC" | "WETH",
  config: (typeof CONFIG)[number],
): number {
  if (liquidity === 0n) return 0;

  const Q96 = 2n ** 96n;
  const baseAddress = baseTokenSymbol === "USDC" ? config.usdc : config.weth;
  const isToken0Base = token0.toLowerCase() === baseAddress.toLowerCase();

  // Calculate amount of base token in the pool
  // L = sqrt(x * y)
  // sqrtP = y / x (price of 0 in terms of 1? No, price of 0 in terms of 1 is y/x if 0 is base... wait)
  // Uniswap Price P is amount of token1 per 1 token0.
  // P = y / x. sqrtP = sqrt(y/x).
  // sqrtPriceX96 = sqrt(P) * 2^96.

  // If Token0 is Base (x is Base):
  // We want x.
  // x = L / sqrtP = L * 2^96 / sqrtPriceX96.

  // If Token1 is Base (y is Base):
  // We want y.
  // y = L * sqrtP = L * sqrtPriceX96 / 2^96.

  let baseAmount = 0n;

  if (isToken0Base) {
    // Base is x
    baseAmount = (liquidity * Q96) / sqrtPriceX96;
  } else {
    // Base is y
    baseAmount = (liquidity * sqrtPriceX96) / Q96;
  }

  // Convert to USD
  // TVL is roughly 2x the base token amount (50/50 ratio in V3 at current tick range approx)
  // Actually V3 is concentrated, but for ranking, assuming 2x base is fair enough vs Aerodrome.

  if (baseTokenSymbol === "USDC") {
    // 6 decimals
    return (Number(baseAmount) / 1e6) * 2;
  } else {
    // 18 decimals (WETH/WBNB)
    return (Number(baseAmount) / 1e18) * config.nativeTokenPriceEstimate * 2;
  }
}

/**
 * Validate pool has sufficient liquidity
 */
export function validatePoolLiquidity(pool: PoolInfo): {
  valid: boolean;
  warning?: string;
} {
  const MIN_LIQUIDITY_USD = 10000; // $10k minimum (lowered to be more permissive for finding)

  if (pool.tvlUsd < MIN_LIQUIDITY_USD) {
    return {
      valid: false,
      warning: `Low liquidity: $${pool.tvlUsd.toLocaleString()}. Minimum recommended: $${MIN_LIQUIDITY_USD.toLocaleString()}`,
    };
  }

  return { valid: true };
}

/**
 * Format pool info for display
 */
export function formatPoolInfo(pool: PoolInfo): string {
  if (pool.protocol === "Aerodrome") {
    const type = pool.stable ? "Stable" : "Volatile";
    return `Aerodrome ${type} (${pool.baseToken}) - TVL: ~$${Math.floor(pool.tvlUsd).toLocaleString()}`;
  }
  // FAIL-FAST: fee is required for non-Aerodrome pools
  if (pool.fee === undefined) {
    throw new Error(`Pool ${pool.address} missing required fee field`);
  }
  const feePercent = (pool.fee / 10000).toFixed(2);
  return `${pool.protocol} (${feePercent}%, ${pool.baseToken}) - TVL: ~$${Math.floor(pool.tvlUsd).toLocaleString()}`;
}
