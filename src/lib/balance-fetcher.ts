/**
 * Balance Fetcher Utilities
 *
 * Utilities for filtering, sorting, and enriching token balances.
 * Used by EVM and Solana balance APIs.
 */

import type { Chain } from "@/config/chains";
import type { SolanaTokenBalance, TokenBalance } from "@/types/api";
import { fetchTokenPrices } from "@/utils/price-fetcher";

/**
 * Filter out dust tokens below minimum thresholds
 *
 * Filtering logic:
 * - Always check token balance >= minBalance
 * - If price is available (non-zero), also check balanceUsd >= minUsdValue
 *
 * @param tokens - Array of token balances
 * @param minBalance - Minimum token balance (in human-readable units)
 * @param minUsdValue - Minimum USD value to keep (only applied when price > 0)
 */
export function filterDustTokens(
  tokens: TokenBalance[],
  minBalance: number,
  minUsdValue: number,
): TokenBalance[] {
  return tokens.filter((token) => {
    const balance = parseFloat(token.balance) / 10 ** token.decimals;

    // Must meet minimum balance threshold
    if (balance < minBalance) return false;

    // If price is available (non-zero), also check USD value threshold
    // priceUsd === 0 or undefined means "no price available"
    if (token.priceUsd && token.priceUsd > 0 && token.balanceUsd !== undefined) {
      return token.balanceUsd >= minUsdValue;
    }

    // No price available - balance check already passed
    return true;
  });
}

/**
 * Sort tokens by USD value (highest first), then by balance for unpriced tokens
 */
export function sortTokensByValue(tokens: TokenBalance[]): TokenBalance[] {
  return [...tokens].sort((a, b) => {
    // Priced tokens come first
    const aHasPrice = a.balanceUsd !== undefined;
    const bHasPrice = b.balanceUsd !== undefined;

    if (aHasPrice && !bHasPrice) return -1;
    if (!aHasPrice && bHasPrice) return 1;

    // Both have prices - sort by USD value
    if (aHasPrice && bHasPrice) {
      return (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0);
    }

    // Neither has price - sort by raw balance (normalized)
    const aBalance = parseFloat(a.balance) / 10 ** a.decimals;
    const bBalance = parseFloat(b.balance) / 10 ** b.decimals;
    return bBalance - aBalance;
  });
}

/**
 * Enrich EVM tokens with current prices
 *
 * @param chain - Chain identifier (ethereum, base, bsc)
 * @param tokens - Array of token balances to enrich
 */
export async function enrichEvmTokensWithPrices(
  chain: Chain,
  tokens: TokenBalance[],
): Promise<TokenBalance[]> {
  if (tokens.length === 0) return tokens;

  // Collect addresses that need pricing
  const addressesToPrice = tokens
    .filter((t) => t.priceUsd === undefined)
    .map((t) => t.contractAddress);

  if (addressesToPrice.length > 0) {
    const prices = await fetchTokenPrices(chain, addressesToPrice);

    // Update tokens with fetched prices
    for (const token of tokens) {
      if (token.priceUsd === undefined) {
        const price = prices[token.contractAddress.toLowerCase()];
        if (price) {
          token.priceUsd = price;
        }
      }
    }
  }

  // Calculate USD values for all tokens with prices
  for (const token of tokens) {
    if (token.priceUsd !== undefined) {
      const balance = parseFloat(token.balance) / 10 ** token.decimals;
      token.balanceUsd = balance * token.priceUsd;
    }
  }

  return tokens;
}

/**
 * Enrich Solana tokens with current prices from Jupiter
 *
 * @param tokens - Array of Solana token balances to enrich
 */
export async function enrichSolanaTokensWithPrices(
  tokens: SolanaTokenBalance[],
): Promise<SolanaTokenBalance[]> {
  if (tokens.length === 0) return tokens;

  // Collect mints that need pricing
  const mintsToPrice = tokens
    .filter((t) => t.priceUsd === undefined || t.priceUsd === 0)
    .map((t) => t.mint);

  if (mintsToPrice.length > 0) {
    const prices = await fetchTokenPrices("solana", mintsToPrice);

    // Update tokens with fetched prices
    for (const token of tokens) {
      if (token.priceUsd === undefined || token.priceUsd === 0) {
        const price = prices[token.mint];
        if (price) {
          token.priceUsd = price;
        }
      }
    }
  }

  // Calculate USD values for all tokens with prices
  for (const token of tokens) {
    if (token.priceUsd !== undefined && token.priceUsd > 0) {
      const balance = token.amount / 10 ** token.decimals;
      token.balanceUsd = balance * token.priceUsd;
    }
  }

  return tokens;
}
