/**
 * Consolidated price fetching utilities
 *
 * Sources:
 * - CoinGecko: EVM token prices (with optional Pro API key)
 * - DeFiLlama: EVM token prices (free, good coverage for newer tokens)
 * - Jupiter: Solana token prices
 */

import { z } from "zod";
import type { Chain } from "@/config/chains";

// Price sanity threshold: $1 billion - reject obviously manipulated prices
const MAX_SANE_PRICE_USD = 1_000_000_000;

// =============================================================================
// Zod Schemas for External API Response Validation
// =============================================================================

// CoinGecko simple price response (native tokens and token prices)
const CoinGeckoPriceDataSchema = z.object({
  usd: z.number().positive("Price must be positive").optional(),
});

const CoinGeckoSimplePriceSchema = z.record(z.string(), CoinGeckoPriceDataSchema);

// DeFiLlama price response
const DeFiLlamaPriceDataSchema = z.object({
  price: z.number().positive("Price must be positive").optional(),
  symbol: z.string().optional(),
  timestamp: z.number().optional(),
  confidence: z.number().optional(),
});

const DeFiLlamaResponseSchema = z.object({
  coins: z.record(z.string(), DeFiLlamaPriceDataSchema).optional(),
});

// Jupiter price response
const JupiterPriceDataSchema = z.object({
  id: z.string().optional(),
  mintSymbol: z.string().optional(),
  vsToken: z.string().optional(),
  vsTokenSymbol: z.string().optional(),
  price: z.string().optional(),
});

const JupiterResponseSchema = z.object({
  data: z.record(z.string(), JupiterPriceDataSchema).optional(),
  timeTaken: z.number().optional(),
});

/**
 * Validate external API response with detailed error reporting
 */
function validateApiResponse<T>(schema: z.ZodSchema<T>, data: unknown, apiName: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid ${apiName} response: ${errors}`);
  }
  return result.data;
}

/**
 * Validate price is within sane bounds to detect manipulation
 */
function validatePriceSanity(price: number, source: string, identifier: string): void {
  if (price > MAX_SANE_PRICE_USD) {
    console.warn(
      `[Price Fetcher] ${source} price for ${identifier} (${price}) exceeds sanity threshold, skipping`,
    );
    throw new Error(`${source} price exceeds sanity threshold`);
  }
  if (price <= 0) {
    throw new Error(`${source} price must be positive`);
  }
}

/** CoinGecko platform IDs for each chain */
export const COINGECKO_PLATFORMS: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  base: "base",
  bsc: "binance-smart-chain",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
};

/** DeFiLlama chain identifiers */
export const DEFILLAMA_CHAINS: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  bsc: "bsc",
};

/** Native token CoinGecko IDs */
export const NATIVE_TOKEN_IDS: Record<string, string> = {
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
};

interface PriceFetchOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * Fetch native token prices (ETH, BNB, SOL) from CoinGecko
 */
export async function fetchNativePrices(
  symbols: string[] = ["ETH", "BNB", "SOL"],
  options: PriceFetchOptions = {},
): Promise<Record<string, number>> {
  const { timeout = 5000 } = options;
  const prices: Record<string, number> = {};

  const coinIds = symbols
    .map((s) => NATIVE_TOKEN_IDS[s])
    .filter(Boolean)
    .join(",");

  if (!coinIds) return prices;

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd`,
    {
      headers: { Accept: "application/json" },
      signal: options.signal !== undefined ? options.signal : AbortSignal.timeout(timeout),
    },
  );

  if (!response.ok) {
    // Rate limited or other error - return empty prices, don't throw
    console.warn(`[Price Fetcher] Native prices API error: HTTP ${response.status}`);
    return prices;
  }

  const rawData: unknown = await response.json();
  const data = validateApiResponse(CoinGeckoSimplePriceSchema, rawData, "CoinGecko Native");

  for (const [coinId, priceData] of Object.entries(data)) {
    const symbolEntry = Object.entries(NATIVE_TOKEN_IDS).find(([, id]) => id === coinId);
    if (!symbolEntry) continue;
    const symbol = symbolEntry[0];
    if (priceData.usd !== undefined) {
      try {
        validatePriceSanity(priceData.usd, "CoinGecko", symbol);
        prices[symbol] = priceData.usd;
      } catch {
        // Skip this price if sanity check fails
      }
    }
  }

  return prices;
}

/**
 * Fetch EVM token prices from CoinGecko
 */
export async function fetchCoinGeckoPrices(
  chain: string,
  addresses: string[],
  options: PriceFetchOptions = {},
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  const platformId = COINGECKO_PLATFORMS[chain.toLowerCase()];
  if (!platformId) return {};

  const { timeout = 10000 } = options;
  const apiKey = process.env.COINGECKO_API_KEY;

  const addressList = addresses.map((a) => a.toLowerCase()).join(",");
  const url = apiKey
    ? `https://pro-api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${addressList}&vs_currencies=usd`
    : `https://api.coingecko.com/api/v3/simple/token_price/${platformId}?contract_addresses=${addressList}&vs_currencies=usd`;

  const headers: HeadersInit = { "User-Agent": "OTC-Desk/1.0" };
  if (apiKey) {
    headers["X-Cg-Pro-Api-Key"] = apiKey;
  }

  const response = await fetch(url, {
    headers,
    signal: options.signal !== undefined ? options.signal : AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    // Rate limited or other error - return empty prices, don't throw
    console.warn(`[Price Fetcher] CoinGecko API error: HTTP ${response.status}`);
    return {};
  }

  const rawData: unknown = await response.json();
  const data = validateApiResponse(CoinGeckoSimplePriceSchema, rawData, "CoinGecko Token");
  const prices: Record<string, number> = {};

  for (const [address, priceData] of Object.entries(data)) {
    const usd = priceData.usd;
    if (usd !== undefined) {
      try {
        validatePriceSanity(usd, "CoinGecko", address);
        prices[address.toLowerCase()] = usd;
      } catch {
        // Skip this price if sanity check fails
      }
    }
  }

  return prices;
}

/**
 * Fetch EVM token prices from DeFiLlama (free, good coverage)
 */
export async function fetchDeFiLlamaPrices(
  chain: string,
  addresses: string[],
  options: PriceFetchOptions = {},
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  const llamaChain = DEFILLAMA_CHAINS[chain.toLowerCase()] || chain;
  const { timeout = 10000 } = options;

  const coins = addresses.map((a) => `${llamaChain}:${a}`).join(",");
  const url = `https://coins.llama.fi/prices/current/${coins}`;

  const response = await fetch(url, {
    signal: options.signal !== undefined ? options.signal : AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`DeFiLlama API error: HTTP ${response.status}`);
  }

  const rawData: unknown = await response.json();
  const data = validateApiResponse(DeFiLlamaResponseSchema, rawData, "DeFiLlama");
  const prices: Record<string, number> = {};

  if (!data.coins) {
    return prices;
  }
  for (const [key, priceData] of Object.entries(data.coins)) {
    const parts = key.split(":");
    if (parts.length < 2) continue;
    const address = parts[1].toLowerCase();
    const price = priceData.price;
    if (price !== undefined) {
      try {
        validatePriceSanity(price, "DeFiLlama", address);
        prices[address] = price;
      } catch {
        // Skip this price if sanity check fails
      }
    }
  }

  console.log(`[Price Fetcher] DeFiLlama returned ${Object.keys(prices).length} prices`);
  return prices;
}

/**
 * Fetch Solana token prices from Jupiter Price API
 */
export async function fetchJupiterPrices(
  mints: string[],
  options: PriceFetchOptions = {},
): Promise<Record<string, number>> {
  if (mints.length === 0) return {};

  const { timeout = 10000 } = options;
  const allPrices: Record<string, number> = {};

  // Jupiter supports up to 100 tokens per request
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += 100) {
    chunks.push(mints.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const ids = chunk.join(",");
    const response = await fetch(`https://api.jup.ag/price/v2?ids=${ids}`, {
      signal: options.signal !== undefined ? options.signal : AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      console.warn(`[Price Fetcher] Jupiter API error: HTTP ${response.status}`);
      continue; // Skip this chunk, return what we have
    }

    const rawData: unknown = await response.json();
    const data = validateApiResponse(JupiterResponseSchema, rawData, "Jupiter");

    if (!data.data) {
      continue;
    }
    for (const [mint, priceData] of Object.entries(data.data)) {
      const price = priceData.price;
      if (price) {
        const parsedPrice = Number.parseFloat(price);
        if (!Number.isNaN(parsedPrice)) {
          try {
            validatePriceSanity(parsedPrice, "Jupiter", mint);
            allPrices[mint] = parsedPrice;
          } catch {
            // Skip this price if sanity check fails
          }
        }
      }
    }
  }

  return allPrices;
}

/**
 * Fetch EVM token prices - tries DeFiLlama first, then CoinGecko
 */
export async function fetchEvmPrices(
  chain: string,
  addresses: string[],
  options: PriceFetchOptions = {},
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  // Try DeFiLlama first (better coverage for newer tokens)
  const llamaPrices = await fetchDeFiLlamaPrices(chain, addresses, options);

  // Find addresses still missing prices
  const missingAddresses = addresses.filter((a) => !llamaPrices[a.toLowerCase()]);

  if (missingAddresses.length === 0) {
    return llamaPrices;
  }

  // Try CoinGecko for remaining
  const geckoPrices = await fetchCoinGeckoPrices(chain, missingAddresses, options);

  return { ...llamaPrices, ...geckoPrices };
}

/**
 * Fetch token prices for any chain
 */
export async function fetchTokenPrices(
  chain: Chain,
  addresses: string[],
  options: PriceFetchOptions = {},
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  if (chain === "solana") {
    return fetchJupiterPrices(addresses, options);
  }

  return fetchEvmPrices(chain, addresses, options);
}
