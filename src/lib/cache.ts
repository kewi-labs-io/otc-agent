import { unstable_cache, revalidateTag } from "next/cache";
import { TokenDB, MarketDataDB, ConsignmentDB } from "@/services/database";
import type { Token, TokenMarketData, Chain } from "@/types";
import { getAddress } from "viem";

/**
 * Chain config for logo sources
 */
const CHAIN_CONFIG: Record<
  string,
  {
    alchemyNetwork: string;
    trustwalletChain: string;
    coingeckoPlatform: string;
  }
> = {
  ethereum: {
    alchemyNetwork: "eth-mainnet",
    trustwalletChain: "ethereum",
    coingeckoPlatform: "ethereum",
  },
  base: {
    alchemyNetwork: "base-mainnet",
    trustwalletChain: "base",
    coingeckoPlatform: "base",
  },
  bsc: {
    alchemyNetwork: "bnb-mainnet",
    trustwalletChain: "smartchain",
    coingeckoPlatform: "binance-smart-chain",
  },
};

/**
 * EIP-55 checksum address for Trust Wallet
 * FAIL-FAST: Throws if address format is invalid
 */
function checksumAddress(address: string): string {
  return getAddress(address);
}

/**
 * Try Trust Wallet Assets for logo
 */
async function fetchTrustWalletLogo(
  contractAddress: string,
  chain: string,
): Promise<string | null> {
  const config = CHAIN_CONFIG[chain];
  if (!config) return null;

  const checksummed = checksumAddress(contractAddress);
  const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${config.trustwalletChain}/assets/${checksummed}/logo.png`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    signal: AbortSignal.timeout(2000),
  });

  if (response.ok || response.status === 206) {
    return url;
  }
  return null;
}

/**
 * Try CoinGecko for logo
 */
async function fetchCoinGeckoLogo(
  contractAddress: string,
  chain: string,
): Promise<string | null> {
  const config = CHAIN_CONFIG[chain];
  if (!config) return null;

  const apiKey = process.env.COINGECKO_API_KEY;
  const baseUrl = apiKey
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

  const url = `${baseUrl}/coins/${config.coingeckoPlatform}/contract/${contractAddress.toLowerCase()}`;
  const headers: HeadersInit = {};
  if (apiKey) headers["X-Cg-Pro-Api-Key"] = apiKey;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (response.ok) {
    const data = (await response.json()) as {
      image?: { small?: string; thumb?: string };
    };
    // FAIL-FAST: Check for image data explicitly
    if (!data.image) return null;
    if (data.image.small) return data.image.small;
    if (data.image.thumb) return data.image.thumb;
  }
  return null;
}

/**
 * Fetch logo from multiple sources: TrustWallet -> Alchemy -> CoinGecko
 *
 * Optimized: TrustWallet and Alchemy are fetched in parallel since TrustWallet
 * has the best coverage for popular tokens.
 */
async function enrichTokenWithLogo(token: Token): Promise<Token> {
  // Skip if already has logo or is not EVM
  if (token.logoUrl || token.chain === "solana") {
    return token;
  }

  const config = CHAIN_CONFIG[token.chain];
  if (!config) {
    return token;
  }

  // 1. Try TrustWallet + Alchemy in parallel (TrustWallet has best coverage)
  const alchemyKey = process.env.ALCHEMY_API_KEY;

  const [trustWalletLogo, alchemyLogo] = await Promise.all([
    fetchTrustWalletLogo(token.contractAddress, token.chain),
    alchemyKey
      ? fetch(
          `https://${config.alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "alchemy_getTokenMetadata",
              params: [token.contractAddress],
            }),
            signal: AbortSignal.timeout(3000),
          },
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            // FAIL-FAST: Validate response structure
            if (!data || typeof data !== "object" || !("result" in data)) {
              return null;
            }
            const result = data.result as { logo?: string };
            if (!result || !result.logo) return null;
            return result.logo;
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // Prefer TrustWallet (most reliable), then Alchemy
  let logo = trustWalletLogo || alchemyLogo;
  let source = trustWalletLogo ? "TrustWallet" : alchemyLogo ? "Alchemy" : "";

  // 2. Try CoinGecko only if both failed
  if (!logo) {
    logo = await fetchCoinGeckoLogo(token.contractAddress, token.chain);
    if (logo) source = "CoinGecko";
  }

  if (logo) {
    console.log(`[Cache] Enriched ${token.symbol} with logo from ${source}`);
    // Update the token in the database (fire-and-forget)
    TokenDB.updateToken(token.id, { logoUrl: logo }).catch((err) =>
      console.debug(`[Cache] Failed to persist logo for ${token.symbol}:`, err),
    );
    return { ...token, logoUrl: logo };
  }

  return token;
}

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
 * Also enriches token with logo if missing
 */
export const getCachedToken = unstable_cache(
  async (tokenId: string) => {
    const token = await TokenDB.getToken(tokenId);
    // Enrich with logo if missing (best-effort)
    return await enrichTokenWithLogo(token);
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
 *
 * Optimized for parallel fetching:
 * 1. Fetch all tokens from DB in parallel
 * 2. Identify tokens missing logos
 * 3. Enrich logos in parallel (TrustWallet + Alchemy)
 */
export const getCachedTokenBatch = unstable_cache(
  async (tokenIds: string[]) => {
    const results: Record<
      string,
      { token: Token; marketData: TokenMarketData | null } | null
    > = {};

    // Step 1: Fetch all tokens from DB in parallel
    const tokenFetches = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const token = await TokenDB.getToken(tokenId);
        return { tokenId, token };
      }),
    );

    // Step 2: Identify tokens that need logo enrichment
    const tokensNeedingLogos: Token[] = [];
    const tokenMap = new Map<string, Token>();

    for (const { tokenId, token } of tokenFetches) {
      tokenMap.set(tokenId, token);
      if (!token.logoUrl && token.chain !== "solana") {
        tokensNeedingLogos.push(token);
      }
    }

    // Step 3: Enrich logos in parallel (batch to avoid API throttling)
    const LOGO_BATCH_SIZE = 10;
    for (let i = 0; i < tokensNeedingLogos.length; i += LOGO_BATCH_SIZE) {
      const batch = tokensNeedingLogos.slice(i, i + LOGO_BATCH_SIZE);
      const enrichedBatch = await Promise.all(
        batch.map((token) => enrichTokenWithLogo(token)),
      );

      // Update token map with enriched tokens
      for (const enrichedToken of enrichedBatch) {
        tokenMap.set(enrichedToken.id, enrichedToken);
      }
    }

    // Step 4: Build results
    for (const [tokenId, token] of tokenMap) {
      results[tokenId] = { token, marketData: null };
    }

    return results;
  },
  ["token-batch"],
  {
    revalidate: 300, // 5 minutes - token metadata rarely changes
    tags: ["tokens"],
  },
);
