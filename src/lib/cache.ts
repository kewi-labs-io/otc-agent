import { unstable_cache, revalidateTag } from "next/cache";
import { TokenDB, MarketDataDB, ConsignmentDB } from "@/services/database";
import type { Token, TokenMarketData, Chain } from "@/types";

/**
 * Cache invalidation functions.
 * Call these after mutations to ensure fresh data on next request.
 */

/**
 * Invalidate token-related caches (call after token registration/update)
 */
export function invalidateTokenCache() {
  revalidateTag("tokens");
}

/**
 * Invalidate market data caches (call after price refresh)
 */
export function invalidateMarketDataCache() {
  revalidateTag("market-data");
}

/**
 * Invalidate consignment caches (call after consignment create/update/withdraw)
 */
export function invalidateConsignmentCache() {
  revalidateTag("consignments");
}

/**
 * Invalidate all caches (use sparingly)
 */
export function invalidateAllCaches() {
  revalidateTag("tokens");
  revalidateTag("market-data");
  revalidateTag("consignments");
}

/**
 * Serverless-optimized cache wrappers using Next.js unstable_cache.
 * 
 * This provides caching that persists across serverless function invocations
 * on Vercel, unlike in-memory caches which are lost on cold starts.
 * 
 * Cache is stored in Vercel's Data Cache and revalidated based on tags.
 */

/**
 * Get all tokens with caching (5 minute TTL)
 * Tag: "tokens" - invalidate when tokens are registered
 */
export const getCachedTokens = unstable_cache(
  async (filters?: { chain?: Chain; isActive?: boolean }) => {
    return TokenDB.getAllTokens(filters);
  },
  ["tokens-list"],
  {
    revalidate: 300, // 5 minutes
    tags: ["tokens"],
  },
);

/**
 * Get a single token by ID with caching (5 minute TTL)
 * Tag: "tokens" - invalidate when tokens are updated
 */
export const getCachedToken = unstable_cache(
  async (tokenId: string) => {
    try {
      return await TokenDB.getToken(tokenId);
    } catch {
      return null;
    }
  },
  ["token"],
  {
    revalidate: 300, // 5 minutes
    tags: ["tokens"],
  },
);

/**
 * Get token by symbol with caching (5 minute TTL)
 */
export const getCachedTokenBySymbol = unstable_cache(
  async (symbol: string) => {
    return TokenDB.getTokenBySymbol(symbol);
  },
  ["token-by-symbol"],
  {
    revalidate: 300, // 5 minutes
    tags: ["tokens"],
  },
);

/**
 * Get market data with caching (1 minute TTL)
 * Tag: "market-data" - invalidate when prices refresh
 */
export const getCachedMarketData = unstable_cache(
  async (tokenId: string) => {
    return MarketDataDB.getMarketData(tokenId);
  },
  ["market-data"],
  {
    revalidate: 60, // 1 minute - prices change frequently
    tags: ["market-data"],
  },
);

/**
 * Get all active consignments with caching (1 minute TTL)
 * Tag: "consignments" - invalidate when consignments change
 */
export const getCachedConsignments = unstable_cache(
  async (filters?: { chain?: Chain; tokenId?: string }) => {
    return ConsignmentDB.getAllConsignments(filters);
  },
  ["consignments-list"],
  {
    revalidate: 60, // 1 minute
    tags: ["consignments"],
  },
);

/**
 * Get token addresses only (lightweight, 5 minute TTL)
 */
export const getCachedTokenAddresses = unstable_cache(
  async (chain?: Chain) => {
    const tokens = await TokenDB.getAllTokens(
      chain ? { chain, isActive: true } : { isActive: true },
    );
    return tokens.map((t) => ({
      address: t.contractAddress,
      chain: t.chain,
    }));
  },
  ["token-addresses"],
  {
    revalidate: 300, // 5 minutes
    tags: ["tokens"],
  },
);

/**
 * Batch get multiple tokens with caching (no market data - for trading desk)
 * Market data is only fetched on token details pages via useMarketDataRefresh
 */
export const getCachedTokenBatch = unstable_cache(
  async (tokenIds: string[]) => {
    const results: Record<string, { token: Token; marketData: TokenMarketData | null } | null> = {};
    
    await Promise.all(
      tokenIds.map(async (tokenId) => {
        try {
          const token = await TokenDB.getToken(tokenId);
          // No market data fetch - prices are only shown on token details page
          results[tokenId] = { token, marketData: null };
        } catch {
          results[tokenId] = null;
        }
      }),
    );
    
    return results;
  },
  ["token-batch"],
  {
    revalidate: 300, // 5 minutes - token metadata rarely changes
    tags: ["tokens"],
  },
);

