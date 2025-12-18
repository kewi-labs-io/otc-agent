import { NextRequest, NextResponse } from "next/server";
import { findBestPool, type PoolInfo } from "@/utils/pool-finder-base";
import { createPublicClient, http, keccak256, encodePacked, type Address } from "viem";
import { base, mainnet, bsc } from "viem/chains";
import { SUPPORTED_CHAINS, type Chain } from "@/config/chains";
import { getCurrentNetwork } from "@/config/contracts";

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

interface PoolCheckResult {
  success: boolean;
  tokenAddress: string;
  chain: Chain;
  isRegistered: boolean;
  hasPool: boolean;
  pool?: {
    address: string;
    protocol: string;
    tvlUsd: number;
    priceUsd?: number;
    baseToken: "USDC" | "WETH";
  };
  registrationFee?: string; // In wei
  registrationFeeEth?: string; // Human readable
  warning?: string;
  error?: string;
}

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
  try {
    const { searchParams } = new URL(request.url);
    const tokenAddress = searchParams.get("address");
    const chain = (searchParams.get("chain") || "base") as Chain;

    if (!tokenAddress) {
      return NextResponse.json(
        { success: false, error: "Token address required" },
        { status: 400 },
      );
    }

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

    const chainConfig = SUPPORTED_CHAINS[chain];
    const otcAddress = chainConfig?.contracts?.otc;
    const registrationHelperAddress = chainConfig?.contracts?.registrationHelper;
    const chainId = chainConfig?.chainId;

    if (!otcAddress || !chainId) {
      return NextResponse.json({
        success: false,
        tokenAddress,
        chain,
        isRegistered: false,
        hasPool: false,
        error: `OTC contract not deployed on ${chain}`,
      });
    }

    const viemChain = getViemChain(chain);
    const rpcUrl = chainConfig.rpcUrl.startsWith("/")
      ? `http://localhost:${process.env.PORT || "4444"}${chainConfig.rpcUrl}`
      : chainConfig.rpcUrl;

    const client = createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl),
    });

    // Check if token is registered
    const tokenIdBytes32 = keccak256(encodePacked(["address"], [tokenAddress as Address]));
    
    let isRegistered = false;
    try {
      const read = client.readContract as (params: unknown) => Promise<[Address, number, boolean, Address]>;
      const result = await read({
        address: otcAddress as Address,
        abi: tokensAbi,
        functionName: "tokens",
        args: [tokenIdBytes32],
      });
      
      const [registeredAddress, , isActive] = result;
      isRegistered = isActive && registeredAddress !== "0x0000000000000000000000000000000000000000";
    } catch (err) {
      console.error("[PoolCheck] Error checking registration:", err);
    }

    // Find best pool
    let pool: PoolInfo | null = null;
    let poolError: string | undefined;
    
    try {
      pool = await findBestPool(tokenAddress, chainId);
    } catch (err) {
      poolError = err instanceof Error ? err.message : "Failed to find pool";
    }

    // Get registration fee if helper is configured and token is not registered
    let registrationFee: string | undefined;
    let registrationFeeEth: string | undefined;
    
    if (!isRegistered && registrationHelperAddress) {
      try {
        const read = client.readContract as (params: unknown) => Promise<bigint>;
        const fee = await read({
          address: registrationHelperAddress as Address,
          abi: registrationHelperAbi,
          functionName: "registrationFee",
        });
        registrationFee = fee.toString();
        registrationFeeEth = (Number(fee) / 1e18).toFixed(6);
      } catch (err) {
        console.error("[PoolCheck] Error fetching registration fee:", err);
      }
    }

    // Build warning message
    let warning: string | undefined;
    
    if (!pool) {
      warning = "No liquidity pool found. This token needs a Uniswap V3 or compatible pool to be listed.";
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

    if (registrationFee) {
      result.registrationFee = registrationFee;
      result.registrationFeeEth = registrationFeeEth;
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("[PoolCheck] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to check token pool",
      },
      { status: 500 },
    );
  }
}

