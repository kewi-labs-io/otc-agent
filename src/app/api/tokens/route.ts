import { type NextRequest, NextResponse } from "next/server";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { agentRuntime } from "@/lib/agent-runtime";
import { getCachedMarketData, getCachedTokens, invalidateTokenCache } from "@/lib/cache";
import { parseOrThrow, validateQueryParams } from "@/lib/validation/helpers";
import { type Chain, MarketDataDB, TokenDB } from "@/services/database";
import { MarketDataService } from "@/services/marketDataService";
import { TokenRegistryService } from "@/services/tokenRegistry";
import {
  CreateTokenRequestSchema,
  CreateTokenResponseSchema,
  DeleteTokenResponseSchema,
  GetTokensQuerySchema,
  TokensResponseSchema,
  UpdateTokenRequestSchema,
  UpdateTokenResponseSchema,
} from "@/types/validation/api-schemas";
import { isContractAddress } from "@/utils/address-utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = validateQueryParams(GetTokensQuerySchema, searchParams);

  const { chain, symbol, address, minMarketCap, maxMarketCap, isActive } = query;

  // Use serverless-optimized cache for token list
  const filters: { chain?: Chain; isActive?: boolean } = {};
  if (chain) filters.chain = chain;
  if (isActive !== undefined) filters.isActive = isActive;

  let tokens = await getCachedTokens(filters);

  // Filter by symbol or address if provided
  if (symbol) {
    tokens = tokens.filter((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
  }
  if (address) {
    tokens = tokens.filter((t) => {
      if (t.chain === "solana") {
        return t.contractAddress === address;
      }
      return t.contractAddress.toLowerCase() === address.toLowerCase();
    });
  }

  // Apply market cap filters if provided
  if (minMarketCap || maxMarketCap) {
    const service = new TokenRegistryService();
    tokens = await service.getAllTokens({
      ...filters,
      minMarketCap: minMarketCap ? Number(minMarketCap) : undefined,
      maxMarketCap: maxMarketCap ? Number(maxMarketCap) : undefined,
    });
  }

  // Filter out tokens with invalid chain values or contract addresses
  const validTokens = tokens.filter((token) => {
    // Filter out tokens with invalid chain (must be in SUPPORTED_CHAINS)
    if (!(token.chain in SUPPORTED_CHAINS)) {
      return false;
    }
    // Filter out tokens with invalid contract addresses
    if (!isContractAddress(token.contractAddress)) {
      return false;
    }
    return true;
  });

  // Batch fetch market data with cache
  const tokensWithMarketData = await Promise.all(
    validTokens.map(async (token) => {
      const marketData = await getCachedMarketData(token.id);
      return {
        ...token,
        marketData,
      };
    }),
  );

  const response = { success: true as const, tokens: tokensWithMarketData };
  const validatedResponse = TokensResponseSchema.parse(response);

  // Cache for 5 minutes - token metadata rarely changes
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const data = parseOrThrow(CreateTokenRequestSchema, body);

  const { symbol, name, contractAddress, chain, decimals, logoUrl, description } = data;

  // logoUrl and description are optional fields - use empty string as default
  const logoUrlValue = logoUrl ?? "";
  const descriptionValue = description ?? "";

  const service = new TokenRegistryService();
  const token = await service.registerToken({
    symbol,
    name,
    contractAddress,
    chain,
    decimals,
    logoUrl: logoUrlValue,
    description: descriptionValue,
  });

  // Always attempt to fetch real market data
  // MarketDataService handles localnet Solana with documented placeholder (price from on-chain)
  // For EVM tokens, if price fetching fails, the token is still registered but without price data
  const marketDataService = new MarketDataService();
  try {
    await marketDataService.refreshTokenData(token.id, contractAddress, chain);
  } catch (err) {
    // Log the error but don't fail token registration
    // Price data can be refreshed later via market-data API
    console.warn(
      `[TokenAPI] Failed to fetch initial market data for ${token.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Set minimal market data to indicate price is unknown (not fake data)
    await MarketDataDB.setMarketData({
      tokenId: token.id,
      priceUsd: 0, // 0 indicates "unknown" - not a fake price
      marketCap: 0,
      volume24h: 0,
      priceChange24h: 0,
      liquidity: 0,
      lastUpdated: Date.now(),
    });
  }

  // Invalidate token cache so next request gets fresh data
  invalidateTokenCache();

  const postResponse = { success: true, token };
  const validatedPost = CreateTokenResponseSchema.parse(postResponse);
  return NextResponse.json(validatedPost);
}

/**
 * PATCH /api/tokens - Update token metadata
 * Body: { tokenId, updates: { logoUrl?, name?, symbol?, ... } }
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { tokenId, updates } = parseOrThrow(UpdateTokenRequestSchema, body);

  const updated = await TokenDB.updateToken(tokenId, updates);
  // Invalidate cache after update
  invalidateTokenCache();
  const patchResponse = { success: true, token: updated };
  const validatedPatch = UpdateTokenResponseSchema.parse(patchResponse);
  return NextResponse.json(validatedPatch);
}

/**
 * DELETE /api/tokens - Clear all test/seeded tokens
 * Use with ?confirm=true to actually delete
 * Use with ?tokenId=xxx to delete a specific token
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const confirm = searchParams.get("confirm") === "true";
  const tokenId = searchParams.get("tokenId");

  if (!confirm) {
    return NextResponse.json(
      { error: "Add ?confirm=true to actually delete tokens" },
      { status: 400 },
    );
  }

  const runtime = await agentRuntime.getRuntime();

  if (tokenId) {
    // Delete a specific token
    const token = await runtime.getCache(`token:${tokenId}`);
    // FAIL-FAST: Token must exist to delete
    if (!token) {
      throw new Error(`Token ${tokenId} not found`);
    }

    await runtime.deleteCache(`token:${tokenId}`);
    await runtime.deleteCache(`market_data:${tokenId}`);

    // Remove from all_tokens index
    const allTokens = await runtime.getCache<string[]>("all_tokens");
    // allTokens is optional - default to empty array if not present
    const allTokensArray =
      allTokens !== undefined && allTokens !== null && Array.isArray(allTokens) ? allTokens : [];
    const updated = allTokensArray.filter((id) => id !== tokenId);
    await runtime.setCache("all_tokens", updated);

    const deleteOneResponse = {
      success: true,
      message: `Deleted token: ${tokenId}`,
    };
    const validatedDeleteOne = DeleteTokenResponseSchema.parse(deleteOneResponse);
    return NextResponse.json(validatedDeleteOne);
  }

  // Delete ALL tokens
  const allTokens = await runtime.getCache<string[]>("all_tokens");
  const deleted: string[] = [];

  if (allTokens) {
    for (const id of allTokens) {
      await runtime.deleteCache(`token:${id}`);
      await runtime.deleteCache(`market_data:${id}`);
      deleted.push(id);
    }
  }

  // Clear the index
  await runtime.setCache("all_tokens", []);

  // Also clear consignments since they reference tokens
  const allConsignments = await runtime.getCache<string[]>("all_consignments");
  if (allConsignments) {
    for (const id of allConsignments) {
      await runtime.deleteCache(`consignment:${id}`);
    }
  }
  await runtime.setCache("all_consignments", []);

  const deleteAllResponse = {
    success: true,
    message: `Deleted ${deleted.length} tokens and all consignments`,
    deletedTokens: deleted,
  };
  const validatedDeleteAll = DeleteTokenResponseSchema.parse(deleteAllResponse);
  return NextResponse.json(validatedDeleteAll);
}
