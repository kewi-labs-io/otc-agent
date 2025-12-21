import { NextRequest, NextResponse } from "next/server";
import { TokenDB, MarketDataDB } from "@/services/database";
import { MarketDataService } from "@/services/marketDataService";
import { getNetwork } from "@/config/env";
import { getSolanaConfig } from "@/config/contracts";
import {
  validateRouteParams,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  GetMarketDataParamsSchema,
  MarketDataResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";

// Check if we're in local development mode (no external API calls needed)
function isLocalDevelopment(chain: string, contractAddress: string): boolean {
  // EVM local testnet (Anvil deploys to predictable addresses)
  if (
    contractAddress.startsWith("0x5FbDB") ||
    contractAddress.startsWith("0x5fbdb") ||
    contractAddress.startsWith("0xe7f1725") // Common Anvil deploy address
  ) {
    return true;
  }

  // Solana localnet - check if RPC is localhost or no Birdeye key
  if (chain === "solana") {
    const solanaRpc = getSolanaConfig(getNetwork()).rpc;
    const hasBirdeyeKey = !!process.env.BIRDEYE_API_KEY;
    if (
      solanaRpc.includes("127.0.0.1") ||
      solanaRpc.includes("localhost") ||
      !hasBirdeyeKey
    ) {
      return true;
    }
  }

  return false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const routeParams = await params;

  // Validate route params - return 400 on invalid params
  const parseResult = GetMarketDataParamsSchema.safeParse(routeParams);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }

  const { tokenId } = parseResult.data;
  let marketData = await MarketDataDB.getMarketData(tokenId);

  if (!marketData || Date.now() - marketData.lastUpdated > 300000) {
    // Token lookup - return 404 if not found
    const token = await TokenDB.getToken(tokenId);
    if (!token) {
      return NextResponse.json(
        { success: false, error: `Token ${tokenId} not found` },
        { status: 404 },
      );
    }

    // Skip external API calls for local development
    if (!isLocalDevelopment(token.chain, token.contractAddress)) {
      const service = new MarketDataService();
      await service.refreshTokenData(
        tokenId,
        token.contractAddress,
        token.chain,
      );
      marketData = await MarketDataDB.getMarketData(tokenId);
    }
  }

  // Cache for 60 seconds, serve stale for 5 minutes while revalidating
  // Market data changes frequently but not every request
  const response = { success: true, marketData };
  const validatedResponse = MarketDataResponseSchema.parse(response);

  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
