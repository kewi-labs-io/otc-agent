import { Chain } from "@/config/chains";
import { fetchJsonWithRetryAndCache } from "./retry-cache";

interface PriceValidationResult {
  valid: boolean;
  warning?: string;
  aggregatedPrice?: number;
  poolPrice?: number;
  divergencePercent?: number;
  error?: string;
}

interface CoinGeckoPriceResponse {
  [address: string]: {
    usd?: number;
  };
}

const COINGECKO_CHAIN_MAP: Record<string, string> = {
  base: "base",
  solana: "solana",
  bsc: "binance-smart-chain",
  ethereum: "ethereum",
};

const COINGECKO_CACHE_TTL_MS = 30_000;

// In production, fail-closed (reject if we can't verify price)
// In development, fail-open (allow if we can't verify)
const FAIL_CLOSED = process.env.NODE_ENV === "production";

/**
 * Check if the pool price diverges significantly (>10%) from the aggregated off-chain price.
 *
 * SECURITY: In production, this fails-closed - if we cannot verify the price,
 * the transaction is blocked. This prevents manipulation attacks.
 */
export async function checkPriceDivergence(
  tokenAddress: string,
  chain: Chain,
  poolPriceUsd: number,
): Promise<PriceValidationResult> {
  if (!poolPriceUsd || poolPriceUsd <= 0) {
    // Invalid pool price - cannot proceed safely
    return {
      valid: false,
      error: "Invalid pool price (zero or negative)",
    };
  }

  const platformId = COINGECKO_CHAIN_MAP[chain];
  if (!platformId) {
    // Unsupported chain - allow but log
    console.warn(`[PriceValidator] Unsupported chain: ${chain}`);
    return {
      valid: true,
      warning: `Price validation not available for chain: ${chain}`,
    };
  }

  // FAIL-FAST: Fetch price data - throws on network/API errors
  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${tokenAddress}&vs_currencies=usd`;
  const cacheKey = `coingecko:${platformId}:${tokenAddress.toLowerCase()}`;

  const data = await fetchJsonWithRetryAndCache<CoinGeckoPriceResponse>(
    url,
    { headers: { Accept: "application/json" } },
    {
      cacheTtlMs: COINGECKO_CACHE_TTL_MS,
      cacheKey,
      maxRetries: 3,
    },
  );

  const tokenData = data[tokenAddress.toLowerCase()];

  if (!tokenData || !tokenData.usd) {
    // Token not found on CoinGecko - this might be a new/unlisted token
    // In production (FAIL_CLOSED), this is a validation failure
    if (FAIL_CLOSED) {
      return {
        valid: false,
        error: "Token not found on price aggregator - cannot verify price",
        warning:
          "Price verification unavailable - transaction blocked for safety",
      };
    }
    // Development: allow with warning
    return {
      valid: true,
      warning: "Token not found on price aggregator - price unverified",
    };
  }

  const aggregatedPrice = tokenData.usd;
  const diff = Math.abs(poolPriceUsd - aggregatedPrice);
  const divergence = diff / aggregatedPrice;
  const divergencePercent = divergence * 100;

  if (divergencePercent > 10) {
    return {
      valid: false,
      warning: `Price diverges ${divergencePercent.toFixed(1)}% from market ($${poolPriceUsd.toFixed(4)} vs $${aggregatedPrice.toFixed(4)})`,
      aggregatedPrice,
      poolPrice: poolPriceUsd,
      divergencePercent,
    };
  }

  return {
    valid: true,
    aggregatedPrice,
    poolPrice: poolPriceUsd,
    divergencePercent,
  };
}
