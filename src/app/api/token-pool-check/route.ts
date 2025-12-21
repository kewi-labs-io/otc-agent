import { type NextRequest, NextResponse } from "next/server";
import {
  type Abi,
  type Address,
  createPublicClient,
  encodePacked,
  http,
  keccak256,
} from "viem";
import { base, bsc, mainnet } from "viem/chains";
import { type Chain, SUPPORTED_CHAINS } from "@/config/chains";
import { getCurrentNetwork } from "@/config/contracts";
import { validationErrorResponse } from "@/lib/validation/helpers";
import { safeReadContract } from "@/lib/viem-utils";
import type { PoolCheckResult } from "@/types";
import {
  TokenPoolCheckQuerySchema,
  TokenPoolCheckResponseSchema,
} from "@/types/validation/api-schemas";
import { findAllPools, type PoolInfo } from "@/utils/pool-finder-base";

// ABI for reading token registration status from OTC
const tokensAbi = [
  {
    type: "function",
    name: "tokens",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "bytes32" }],
    outputs: [
      { name: "tokenAddress", type: "address" },
      { name: "decimals", type: "uint8" },
      { name: "isActive", type: "bool" },
      { name: "priceOracle", type: "address" },
    ],
  },
] as const;

// ABI for reading registration fee
const registrationHelperAbi = [
  {
    type: "function",
    name: "registrationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function getViemChain(chain: Chain) {
  const network = getCurrentNetwork();
  const isMainnet = network === "mainnet";

  switch (chain) {
    case "ethereum":
      return isMainnet ? mainnet : mainnet; // Use mainnet for now
    case "base":
      return base;
    case "bsc":
      return bsc;
    default:
      return base;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on missing/invalid params
  const parseResult = TokenPoolCheckQuerySchema.safeParse({
    chain: searchParams.get("chain"),
    tokenAddress:
      searchParams.get("address") ?? searchParams.get("tokenAddress"),
  });

  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }

  const { tokenAddress, chain } = parseResult.data;

  // Only EVM chains have pool-based registration
  if (chain === "solana") {
    return NextResponse.json({
      success: true,
      tokenAddress,
      chain,
      isRegistered: false, // Would need Solana-specific check
      hasPool: true, // Solana uses different pricing mechanism
      warning: "Solana token registration is handled separately",
    });
  }

  // FAIL-FAST: chain must be valid Chain type, SUPPORTED_CHAINS guarantees ChainConfig exists
  if (!(chain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  const chainConfig = SUPPORTED_CHAINS[chain];

  // FAIL-FAST: ChainConfig requires contracts field - if missing, config is invalid
  if (!chainConfig.contracts) {
    throw new Error(
      `Chain config for ${chain} missing contracts - invalid ChainConfig`,
    );
  }

  // FAIL-FAST: ChainConfig requires rpcUrl field - if missing, config is invalid
  if (!chainConfig.rpcUrl) {
    throw new Error(
      `Chain config for ${chain} missing rpcUrl - invalid ChainConfig`,
    );
  }

  // FAIL-FAST: EVM chains require chainId
  if (chainConfig.chainId === undefined) {
    throw new Error(`Chain config missing chainId for: ${chain}`);
  }

  const otcAddress = chainConfig.contracts.otc;
  const registrationHelperAddress = chainConfig.contracts.registrationHelper;
  const chainId = chainConfig.chainId;

  // FAIL-FAST: EVM chains require OTC address
  if (!otcAddress) {
    throw new Error(`OTC contract not deployed on ${chain}`);
  }

  const viemChain = getViemChain(chain);
  const rpcUrl = chainConfig.rpcUrl.startsWith("/")
    ? (() => {
        if (!process.env.PORT) {
          throw new Error(
            "PORT environment variable not set for local RPC URL",
          );
        }
        return `http://localhost:${process.env.PORT}${chainConfig.rpcUrl}`;
      })()
    : chainConfig.rpcUrl;

  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  // Check if token is registered
  const tokenIdBytes32 = keccak256(
    encodePacked(["address"], [tokenAddress as Address]),
  );

  let isRegistered = false;
  const tokenResult = await safeReadContract<
    [Address, number, boolean, Address]
  >(client, {
    address: otcAddress as Address,
    abi: tokensAbi as Abi,
    functionName: "tokens",
    args: [tokenIdBytes32],
  });

  const [registeredAddress, , isActive] = tokenResult;
  isRegistered =
    isActive &&
    registeredAddress !== "0x0000000000000000000000000000000000000000";

  // Find all pools
  let allPoolsRaw: PoolInfo[] = [];
  let pool: PoolInfo | null = null;
  let poolError: string | undefined;

  allPoolsRaw = await findAllPools(tokenAddress, chainId);
  // Best pool is the first one (highest TVL)
  pool = allPoolsRaw.length > 0 ? allPoolsRaw[0] : null;

  // Get registration fee if helper is configured and token is not registered
  let registrationFee: string | undefined;
  let registrationFeeEth: string | undefined;

  if (!isRegistered && registrationHelperAddress) {
    const fee = await safeReadContract<bigint>(client, {
      address: registrationHelperAddress as Address,
      abi: registrationHelperAbi as Abi,
      functionName: "registrationFee",
    });
    registrationFee = fee.toString();
    registrationFeeEth = (Number(fee) / 1e18).toFixed(6);
  }

  // Build warning message
  let warning: string | undefined;

  if (!pool) {
    warning =
      "No liquidity pool found. Requires Uniswap V3/V4, Aerodrome, or Pancakeswap pool.";
  } else if (pool.tvlUsd < 1000) {
    warning = `Low liquidity detected ($${pool.tvlUsd.toFixed(0)}). Price accuracy may be affected.`;
  } else if (pool.tvlUsd < 10000) {
    warning = `Moderate liquidity ($${pool.tvlUsd.toFixed(0)}). Consider waiting for more liquidity for better price accuracy.`;
  }

  const result: PoolCheckResult = {
    success: true,
    tokenAddress,
    chain,
    isRegistered,
    hasPool: !!pool,
    warning,
    error: poolError,
  };

  if (pool) {
    result.pool = {
      address: pool.address,
      protocol: pool.protocol,
      tvlUsd: pool.tvlUsd,
      priceUsd: pool.priceUsd,
      baseToken: pool.baseToken,
    };
  }

  // Include all pools for user selection (sorted by TVL)
  if (allPoolsRaw.length > 0) {
    result.allPools = allPoolsRaw.map((p) => ({
      address: p.address,
      protocol: p.protocol,
      tvlUsd: p.tvlUsd,
      priceUsd: p.priceUsd,
      baseToken: p.baseToken,
    }));
  }

  // Only show registration fee if non-zero (we've removed the fee)
  if (registrationFee && registrationFee !== "0") {
    result.registrationFee = registrationFee;
    result.registrationFeeEth = registrationFeeEth;
  }

  const validatedResponse = TokenPoolCheckResponseSchema.parse(result);
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
