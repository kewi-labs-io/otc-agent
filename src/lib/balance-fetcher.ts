/**
 * Consolidated balance fetching utilities
 * Extracted from API routes for reuse and testability
 */

import { agentRuntime } from "@/lib/agent-runtime";
import type {
  TokenBalance,
  SolanaTokenBalance,
  CachedWalletBalances,
  BulkMetadataCache,
  BulkPriceCache,
  CachedTokenMetadata,
} from "@/types/api";
import { fetchEvmPrices, fetchJupiterPrices } from "@/utils/price-fetcher";
import { batchCheckBlobCache, getReliableLogoUrl } from "@/utils/blob-storage";

// Cache TTLs
export const PRICE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const WALLET_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const LOGO_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get cached wallet balances for EVM chains
 */
export async function getCachedEvmWalletBalances(
  chain: string,
  address: string,
): Promise<TokenBalance[] | null> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<CachedWalletBalances<TokenBalance>>(
    `evm-wallet:${chain}:${address.toLowerCase()}`,
  );
  if (!cached) return null;
  if (Date.now() - cached.cachedAt >= WALLET_CACHE_TTL_MS) return null;
  console.log(
    `[Balance Fetcher] Using cached EVM wallet data (${cached.tokens.length} tokens)`,
  );
  return cached.tokens;
}

/**
 * Set cached wallet balances for EVM chains
 */
export async function setCachedEvmWalletBalances(
  chain: string,
  address: string,
  tokens: TokenBalance[],
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`evm-wallet:${chain}:${address.toLowerCase()}`, {
    tokens,
    cachedAt: Date.now(),
  });
}

/**
 * Get cached wallet balances for Solana
 */
export async function getCachedSolanaWalletBalances(
  address: string,
): Promise<SolanaTokenBalance[] | null> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<
    CachedWalletBalances<SolanaTokenBalance>
  >(`solana-wallet:${address}`);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt >= WALLET_CACHE_TTL_MS) return null;
  console.log(
    `[Balance Fetcher] Using cached Solana wallet data (${cached.tokens.length} tokens)`,
  );
  return cached.tokens;
}

/**
 * Set cached wallet balances for Solana
 */
export async function setCachedSolanaWalletBalances(
  address: string,
  tokens: SolanaTokenBalance[],
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`solana-wallet:${address}`, {
    tokens,
    cachedAt: Date.now(),
  });
}

/**
 * Get bulk metadata cache for EVM chains
 */
export async function getBulkEvmMetadataCache(
  chain: string,
): Promise<Record<string, CachedTokenMetadata>> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<
    BulkMetadataCache<Record<string, CachedTokenMetadata>>
  >(`evm-metadata-bulk:${chain}`);
  if (!cached || !cached.metadata) {
    return {};
  }
  return cached.metadata;
}

/**
 * Set bulk metadata cache for EVM chains
 */
export async function setBulkEvmMetadataCache(
  chain: string,
  metadata: Record<string, CachedTokenMetadata>,
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`evm-metadata-bulk:${chain}`, { metadata });
}

/**
 * Get bulk price cache for EVM chains
 */
export async function getBulkEvmPriceCache(
  chain: string,
): Promise<Record<string, number>> {
  const runtime = await agentRuntime.getRuntime();
  const cached = await runtime.getCache<BulkPriceCache>(
    `evm-prices-bulk:${chain}`,
  );
  if (!cached) return {};
  if (Date.now() - cached.cachedAt >= PRICE_CACHE_TTL_MS) return {};
  console.log(
    `[Balance Fetcher] Using cached EVM prices (${Object.keys(cached.prices).length} tokens)`,
  );
  return cached.prices;
}

/**
 * Set bulk price cache for EVM chains
 */
export async function setBulkEvmPriceCache(
  chain: string,
  prices: Record<string, number>,
): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`evm-prices-bulk:${chain}`, {
    prices,
    cachedAt: Date.now(),
  });
}

/**
 * Enrich EVM tokens with prices from cache or API
 */
export async function enrichEvmTokensWithPrices(
  chain: string,
  tokens: TokenBalance[],
): Promise<TokenBalance[]> {
  const cachedPrices = await getBulkEvmPriceCache(chain);
  const tokensNeedingPrices = tokens.filter((t) => !t.priceUsd);
  const uncachedAddresses: string[] = [];

  // Apply cached prices first
  for (const token of tokensNeedingPrices) {
    const cachedPrice = cachedPrices[token.contractAddress.toLowerCase()];
    if (cachedPrice !== undefined) {
      token.priceUsd = cachedPrice;
    } else {
      uncachedAddresses.push(token.contractAddress);
    }
  }

  // Fetch uncached prices
  if (uncachedAddresses.length > 0) {
    const newPrices = await fetchEvmPrices(chain, uncachedAddresses);
    for (const token of tokensNeedingPrices) {
      if (!token.priceUsd) {
        const price = newPrices[token.contractAddress.toLowerCase()] || 0;
        token.priceUsd = price;
      }
    }

    // Merge and cache new prices
    const allPrices = { ...cachedPrices };
    for (const [addr, price] of Object.entries(newPrices)) {
      if (price > 0) {
        allPrices[addr.toLowerCase()] = price;
      }
    }
    await setBulkEvmPriceCache(chain, allPrices);
  }

  // Calculate USD values
  for (const token of tokens) {
    if (!token.balanceUsd && token.priceUsd) {
      const humanBalance =
        Number(BigInt(token.balance)) / Math.pow(10, token.decimals);
      token.balanceUsd = humanBalance * token.priceUsd;
    }
  }

  return tokens;
}

/**
 * Enrich Solana tokens with prices from cache or API
 */
export async function enrichSolanaTokensWithPrices(
  tokens: SolanaTokenBalance[],
): Promise<SolanaTokenBalance[]> {
  const mints = tokens.map((t) => t.mint);
  const prices = await fetchJupiterPrices(mints);

  // Apply prices and calculate USD values
  for (const token of tokens) {
    const price = prices[token.mint] || 0;
    token.priceUsd = price;
    const humanBalance = token.amount / Math.pow(10, token.decimals);
    token.balanceUsd = humanBalance * price;
  }

  return tokens;
}

/**
 * Upgrade logo URLs to blob-cached URLs for EVM tokens
 */
export async function upgradeEvmTokenLogos(
  tokens: TokenBalance[],
): Promise<TokenBalance[]> {
  const logoUrls = tokens
    .map((t) => t.logoUrl)
    .filter((u): u is string => !!u && !u.includes("blob.vercel-storage.com"));

  if (logoUrls.length === 0) return tokens;

  const cachedBlobUrls = await batchCheckBlobCache(logoUrls);

  return tokens.map((token) => {
    if (!token.logoUrl) return token;
    const blobUrl = cachedBlobUrls[token.logoUrl];
    if (blobUrl) {
      return { ...token, logoUrl: blobUrl };
    }
    return token;
  });
}

/**
 * Get reliable logo URL for Solana tokens
 */
export function getReliableSolanaLogoUrl(
  rawLogoUrl: string | null,
  cachedBlobUrls: Record<string, string>,
): string | null {
  return getReliableLogoUrl(rawLogoUrl, cachedBlobUrls);
}

/**
 * Filter tokens by minimum thresholds
 */
export function filterDustTokens(
  tokens: TokenBalance[],
  minTokenBalance = 1,
  minValueUsd = 0.001,
): TokenBalance[] {
  return tokens.filter((t) => {
    const humanBalance = Number(BigInt(t.balance)) / Math.pow(10, t.decimals);
    // balanceUsd can legitimately be 0 - use explicit check
    const balanceUsd = typeof t.balanceUsd === "number" ? t.balanceUsd : 0;
    const hasPrice = typeof t.priceUsd === "number" && t.priceUsd > 0;

    // If we have a price, use minimal USD filter
    if (hasPrice && balanceUsd < minValueUsd) {
      return false;
    }
    // Always require at least minimum token balance
    return humanBalance >= minTokenBalance;
  });
}

/**
 * Sort tokens: priced tokens first (by USD value), then unpriced tokens (by balance)
 */
export function sortTokensByValue(tokens: TokenBalance[]): TokenBalance[] {
  return [...tokens].sort((a, b) => {
    const aHasPrice = a.priceUsd && a.priceUsd > 0;
    const bHasPrice = b.priceUsd && b.priceUsd > 0;

    // Priced tokens come first
    if (aHasPrice && !bHasPrice) return -1;
    if (!aHasPrice && bHasPrice) return 1;

    // Both priced: sort by USD value
    if (aHasPrice && bHasPrice) {
      const aBalanceUsd = typeof a.balanceUsd === "number" ? a.balanceUsd : 0;
      const bBalanceUsd = typeof b.balanceUsd === "number" ? b.balanceUsd : 0;
      return bBalanceUsd - aBalanceUsd;
    }

    // Both unpriced: sort by token balance
    const aBalance = Number(BigInt(a.balance)) / Math.pow(10, a.decimals);
    const bBalance = Number(BigInt(b.balance)) / Math.pow(10, b.decimals);
    return bBalance - aBalance;
  });
}
