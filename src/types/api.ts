/**
 * Shared types for API routes
 * Consolidates duplicate interfaces across API routes
 */

import type { QuoteMemory, ChainType } from "@/lib/plugin-otc-desk/types";

/**
 * Deal data returned from API (enriched QuoteMemory)
 * Token metadata fields come from QuoteMemory base class (now required)
 */
export interface DealFromAPI extends QuoteMemory {
  // Payment context (from contract/transaction)
  payer?: string;
  ethUsdPrice?: number;
}

/**
 * Response from deal-completion API
 */
export interface DealsResponse {
  success: boolean;
  deals: DealFromAPI[];
  error?: string;
}

/**
 * Cached price data structure
 */
export interface CachedPrice {
  readonly priceUsd: number;
  readonly cachedAt: number;
}

/**
 * Token balance structure for EVM chains
 */
export interface TokenBalance {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  logoUrl?: string;
  priceUsd?: number;
  balanceUsd?: number;
}

/**
 * Solana token balance structure
 */
export interface SolanaTokenBalance {
  mint: string;
  amount: number;
  decimals: number;
  symbol: string;
  name: string;
  logoURI: string | null;
  priceUsd: number;
  balanceUsd: number;
}

/**
 * Cached wallet balances structure
 */
export interface CachedWalletBalances<
  T extends TokenBalance | SolanaTokenBalance,
> {
  tokens: T[];
  cachedAt: number;
}

/**
 * Bulk metadata cache structure
 */
export interface BulkMetadataCache<T extends Record<string, unknown>> {
  readonly metadata: T;
}

/**
 * Bulk price cache structure
 */
export interface BulkPriceCache {
  readonly prices: Record<string, number>;
  readonly cachedAt: number;
}

/**
 * Cached token metadata (for EVM)
 */
export interface CachedTokenMetadata {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logoUrl?: string;
  readonly logoCheckedAt?: number; // Unix timestamp
}

/**
 * Solana metadata cache entry
 */
export interface SolanaMetadataCacheEntry {
  readonly symbol: string;
  readonly name: string;
  readonly logoURI: string | null;
}

/**
 * Codex GraphQL balance item response
 */
export interface CodexBalanceItem {
  readonly balance: string;
  readonly balanceUsd: string | null;
  readonly shiftedBalance: number;
  readonly tokenAddress: string;
  readonly token: {
    readonly name: string;
    readonly symbol: string;
    readonly address: string;
    readonly decimals: number;
    readonly networkId: number;
    readonly info?: {
      readonly imageSmallUrl: string | null;
    };
  } | null;
}

/**
 * Helius asset structure
 */
export interface HeliusAsset {
  readonly id: string;
  readonly content?: {
    readonly metadata?: { readonly name?: string; readonly symbol?: string };
    readonly links?: { readonly image?: string };
  };
  readonly token_info?: {
    readonly symbol?: string;
    readonly decimals?: number;
  };
}

/**
 * Token account structure (Solana RPC)
 */
export interface TokenAccount {
  readonly pubkey: string;
  readonly account: {
    readonly data: {
      readonly parsed: {
        readonly info: {
          readonly mint: string;
          readonly tokenAmount: {
            readonly amount: string;
            readonly decimals: number;
            readonly uiAmount: number | null;
          };
        };
      };
    };
  };
}

/**
 * Memory with optional timestamp (for rooms API)
 */
export interface MemoryWithTimestamp {
  readonly id: string;
  readonly entityId?: string;
  readonly agentId?: string;
  readonly content: string | Record<string, unknown>;
  readonly createdAt?: number;
  readonly roomId?: string;
}

/**
 * Next.js route context type
 */
export interface RouteContext {
  readonly params: Promise<Record<string, string>>;
}

/**
 * Token info structure for token lookup API
 */
export interface TokenInfo {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logoUrl: string | null;
  readonly chain: string;
  readonly priceUsd: number | null;
}
