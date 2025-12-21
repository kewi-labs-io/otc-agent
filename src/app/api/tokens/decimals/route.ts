import { getMint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import { createPublicClient, erc20Abi, http } from "viem";
import { base, bsc, mainnet } from "viem/chains";
import type { Chain } from "@/config/chains";
import { getSolanaConfig } from "@/config/contracts";
import { getNetwork } from "@/config/env";
import { validationErrorResponse } from "@/lib/validation/helpers";
import { TokenDB } from "@/services/database";
import {
  GetTokenDecimalsQuerySchema,
  TokenDecimalsResponseSchema,
} from "@/types/validation/api-schemas";

/**
 * GET /api/tokens/decimals?address={address}&chain={chain}
 *
 * Fetch token decimals - tries DB first, then on-chain.
 * This ensures we always get accurate decimals even for unregistered tokens.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on invalid params
  const parseResult = GetTokenDecimalsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const query = parseResult.data;

  const { address, chain } = query;
  // First try to get from database (fastest)
  const tokenId = `token-${chain}-${address}`;
  try {
    const token = await TokenDB.getToken(tokenId);
    // If token exists, decimals must exist (Token type requires decimals)
    if (token?.decimals !== undefined) {
      console.log(
        `[Token Decimals] Found in DB: ${token.decimals} for ${tokenId}`,
      );
      const response = {
        success: true,
        decimals: token.decimals,
        source: "database" as const,
      };
      const validatedResponse = TokenDecimalsResponseSchema.parse(response);
      return NextResponse.json(validatedResponse);
    }
  } catch {
    // Token not in DB - will fetch from chain below
    console.log(`[Token Decimals] Not in DB, will fetch on-chain: ${tokenId}`);
  }

  // Fetch from on-chain
  let decimals: number;

  if (chain === "solana") {
    const solanaConfig = getSolanaConfig(getNetwork());
    const connection = new Connection(solanaConfig.rpc, "confirmed");
    const mintPubkey = new PublicKey(address);
    const mintInfo = await getMint(connection, mintPubkey);
    decimals = mintInfo.decimals;
    console.log(
      `[Token Decimals] Fetched from Solana chain: ${decimals} for ${address}`,
    );
  } else {
    // EVM chains
    const chainConfig =
      chain === "ethereum" ? mainnet : chain === "bsc" ? bsc : base;
    let rpcUrl: string;
    if (chain === "ethereum") {
      if (!process.env.ETHEREUM_RPC_URL) {
        throw new Error("ETHEREUM_RPC_URL must be configured");
      }
      rpcUrl = process.env.ETHEREUM_RPC_URL;
    } else if (chain === "bsc") {
      if (!process.env.BSC_RPC_URL) {
        throw new Error("BSC_RPC_URL must be configured");
      }
      rpcUrl = process.env.BSC_RPC_URL;
    } else {
      if (!process.env.BASE_RPC_URL) {
        throw new Error("BASE_RPC_URL must be configured");
      }
      rpcUrl = process.env.BASE_RPC_URL;
    }

    const client = createPublicClient({
      chain: chainConfig,
      transport: http(rpcUrl),
    });

    // Type assertion needed due to viem type definition issue with authorizationList
    const result = await (
      client.readContract as (args: {
        address: `0x${string}`;
        abi: typeof erc20Abi;
        functionName: "decimals";
      }) => Promise<number>
    )({
      address: address as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    decimals = Number(result);
    console.log(
      `[Token Decimals] Fetched from ${chain} chain: ${decimals} for ${address}`,
    );
  }

  // FAIL-FAST: Validate chain is a valid Chain type
  const validChains: Chain[] = ["ethereum", "base", "bsc", "solana"];
  if (!validChains.includes(chain as Chain)) {
    throw new Error(`Invalid chain: ${chain}`);
  }

  // Cache the result in DB for future lookups (best-effort, ignore duplicates)
  await TokenDB.createToken({
    symbol: "UNKNOWN",
    name: "Unknown Token",
    decimals,
    chain: chain as Chain, // Safe after validation above
    contractAddress: address,
    logoUrl: "",
    description: "",
    isActive: true,
  });
  console.log(`[Token Decimals] Cached token with decimals ${decimals}`);

  const response = {
    success: true,
    decimals,
    source: "chain" as const,
  };
  const validatedResponse = TokenDecimalsResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}
