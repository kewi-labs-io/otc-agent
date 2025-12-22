/**
 * Consolidated price fetching utilities
 *
 * Sources:
 * - CoinGecko: EVM token prices (with optional Pro API key)
 * - DeFiLlama: EVM token prices (free, good coverage for newer tokens)
 * - Jupiter: Solana token prices
 */

import type { Chain } from "@/config/chains";

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

  const data = await response.json();

  interface CoinGeckoPriceData {
    usd?: number;
  }

  for (const [coinId, priceData] of Object.entries(data)) {
    const symbolEntry = Object.entries(NATIVE_TOKEN_IDS).find(([, id]) => id === coinId);
    if (!symbolEntry) continue;
    const symbol = symbolEntry[0];
    const priceDataTyped = priceData as CoinGeckoPriceData;
    if (priceDataTyped.usd !== undefined && typeof priceDataTyped.usd === "number") {
      prices[symbol] = priceDataTyped.usd;
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

  interface CoinGeckoTokenPriceData {
    usd?: number;
  }

  const data = (await response.json()) as Record<string, CoinGeckoTokenPriceData>;
  const prices: Record<string, number> = {};

  for (const [address, priceData] of Object.entries(data)) {
    const usd = priceData.usd;
    if (usd !== undefined && typeof usd === "number") {
      prices[address.toLowerCase()] = usd;
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

  interface DeFiLlamaPriceData {
    price?: number;
  }

  interface DeFiLlamaResponse {
    coins?: Record<string, DeFiLlamaPriceData>;
  }

  const data = (await response.json()) as DeFiLlamaResponse;
  const prices: Record<string, number> = {};

  if (!data.coins) {
    return prices;
  }
  for (const [key, priceData] of Object.entries(data.coins)) {
    const parts = key.split(":");
    if (parts.length < 2) continue;
    const address = parts[1].toLowerCase();
    const price = priceData.price;
    if (typeof price === "number" && price > 0) {
      prices[address] = price;
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

    interface JupiterPriceData {
      price?: string;
    }

    interface JupiterResponse {
      data?: Record<string, JupiterPriceData>;
    }

    const data = (await response.json()) as JupiterResponse;

    if (!data.data) {
      continue;
    }
    for (const [mint, priceData] of Object.entries(data.data)) {
      const price = priceData.price;
      if (price && typeof price === "string") {
        const parsedPrice = parseFloat(price);
        if (!Number.isNaN(parsedPrice)) {
          allPrices[mint] = parsedPrice;
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
