import { NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import {
  fetchJupiterPrices,
  fetchCoinGeckoPrices,
} from "@/utils/price-fetcher";
import {
  validateQueryParams,
  validationErrorResponse,
} from "@/lib/validation/helpers";
import {
  GetTokenPricesQuerySchema,
  TokenPricesResponseSchema,
} from "@/types/validation/api-schemas";
import { z } from "zod";
import type { CachedPrice } from "@/types/api";

// Price cache TTL: 5 minutes
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get cached token price
 */
async function getCachedPrice(
  chain: string,
  address: string,
): Promise<number | null> {
  const runtime = await agentRuntime.getRuntime();
  const cacheKey = `token-price:${chain}:${address.toLowerCase()}`;
  const cached = await runtime.getCache<CachedPrice>(cacheKey);

  if (!cached) return null;
  if (Date.now() - cached.cachedAt >= PRICE_CACHE_TTL_MS) return null;

  return cached.priceUsd;
}

/**
 * Set cached token price
 */
async function setCachedPrice(
  chain: string,
  address: string,
  priceUsd: number,
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  const cacheKey = `token-price:${chain}:${address.toLowerCase()}`;
  await runtime.setCache(cacheKey, {
    priceUsd,
    cachedAt: Date.now(),
  });
}

/**
 * GET /api/token-prices?chain=solana&addresses=mint1,mint2
 * Returns cached prices with 5-minute TTL
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params - return 400 on missing required params
  const parseResult = GetTokenPricesQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, 400);
  }
  const { chain, addresses } = parseResult.data;

  if (addresses.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  // Check cache for each address
  const prices: Record<string, number> = {};
  const uncachedAddresses: string[] = [];

  for (const addr of addresses) {
    const cached = await getCachedPrice(chain, addr);
    if (cached !== null) {
      prices[addr] = cached;
    } else {
      uncachedAddresses.push(addr);
    }
  }

  // Fetch uncached prices using shared utilities
  if (uncachedAddresses.length > 0) {
    let freshPrices: Record<string, number> = {};

    if (chain === "solana") {
      freshPrices = await fetchJupiterPrices(uncachedAddresses);
    } else {
      freshPrices = await fetchCoinGeckoPrices(chain, uncachedAddresses);
    }

    // Cache and merge fresh prices
    for (const [addr, price] of Object.entries(freshPrices)) {
      await setCachedPrice(chain, addr, price);
      // Match original case for Solana
      const originalAddr =
        uncachedAddresses.find((a) => a.toLowerCase() === addr.toLowerCase()) ||
        addr;
      prices[originalAddr] = price;
    }
  }

  // Validate response before returning
  const response = { prices };
  const validatedResponse = TokenPricesResponseSchema.parse(response);

  // Cache for 30 seconds - prices update frequently but can tolerate short delay
  return NextResponse.json(validatedResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
