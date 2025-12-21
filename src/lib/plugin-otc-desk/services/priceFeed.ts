// Price feed service for fetching real-time token prices
// For multi-token support, use MarketDataService

interface PriceCache {
  price: number;
  timestamp: number;
}

const CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Get cached price from runtime storage
 */
async function getCachedPrice(key: string): Promise<PriceCache | null> {
  const { agentRuntime } = await import("../../agent-runtime");
  const runtime = await agentRuntime.getRuntime();
  return (await runtime.getCache<PriceCache>(`price:${key}`)) || null;
}

/**
 * Set cached price in runtime storage
 */
async function setCachedPrice(key: string, value: PriceCache): Promise<void> {
  const { agentRuntime } = await import("../../agent-runtime");
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`price:${key}`, value);
}

/**
 * Get ETH price in USD
 */
export async function getEthPriceUsd(): Promise<number> {
  const cacheKey = "ETH";

  // Check runtime cache
  const cached = await getCachedPrice(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }

  // Fetch from CoinGecko
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    throw new Error(`CoinGecko ETH fetch failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.ethereum || typeof data.ethereum.usd !== "number") {
    throw new Error(
      `Invalid ETH price response from CoinGecko: ${JSON.stringify(data)}`,
    );
  }
  const price = data.ethereum.usd;

  if (price <= 0) {
    throw new Error(`Invalid ETH price from CoinGecko: ${price}`);
  }

  await setCachedPrice(cacheKey, { price, timestamp: Date.now() });
  return price;
}

/**
 * Get BNB price in USD
 */
export async function getBnbPriceUsd(): Promise<number> {
  const cacheKey = "BNB";

  const cached = await getCachedPrice(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }

  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd",
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    throw new Error(`CoinGecko BNB fetch failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.binancecoin || typeof data.binancecoin.usd !== "number") {
    throw new Error(
      `Invalid BNB price response from CoinGecko: ${JSON.stringify(data)}`,
    );
  }
  const price = data.binancecoin.usd;

  if (price <= 0) {
    throw new Error(`Invalid BNB price from CoinGecko: ${price}`);
  }

  await setCachedPrice(cacheKey, { price, timestamp: Date.now() });
  return price;
}

/**
 * Get SOL price in USD
 */
export async function getSolPriceUsd(): Promise<number> {
  const cacheKey = "SOL";

  // Check runtime cache
  const cached = await getCachedPrice(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }

  // Fetch from CoinGecko
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    throw new Error(`CoinGecko SOL fetch failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.solana || typeof data.solana.usd !== "number") {
    throw new Error(
      `Invalid SOL price response from CoinGecko: ${JSON.stringify(data)}`,
    );
  }
  const price = data.solana.usd;

  if (price <= 0) {
    throw new Error(`Invalid SOL price from CoinGecko: ${price}`);
  }

  await setCachedPrice(cacheKey, {
    price,
    timestamp: Date.now(),
  });
  return price;
}

/**
 * Format token amount with proper display (K, M, B suffixes)
 */
export function formatTokenAmount(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;

  if (isNaN(num)) return "0";

  // Format with appropriate decimal places based on token value
  if (num >= 1000000000) {
    return `${(num / 1000000000).toFixed(2)}B`;
  } else if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K`;
  } else {
    return num.toLocaleString();
  }
}
