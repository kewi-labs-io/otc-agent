import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chain } from "@/config/chains";
import type { WalletToken } from "@/types";
import { parseOrThrow } from "@/lib/validation/helpers";
import { AddressSchema, ChainSchema } from "@/types/validation/schemas";
import {
  EvmBalancesResponseSchema,
  SolanaBalancesResponseSchema,
} from "@/types/validation/hook-schemas";

// Re-export for consumers
export type { WalletToken } from "@/types";

interface EvmBalanceToken {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  logoUrl?: string;
  priceUsd?: number;
  balanceUsd?: number;
}

interface SolanaBalanceToken {
  mint: string;
  amount: number;
  decimals: number;
  symbol?: string;
  name?: string;
  logoURI?: string | null;
  priceUsd?: number;
  balanceUsd?: number;
}

/**
 * Minimum thresholds to filter dust tokens
 */
const MIN_TOKEN_BALANCE = 1;
const MIN_VALUE_USD = 0.001;

/**
 * Transform EVM balance to WalletToken
 */
function transformEvmToken(token: EvmBalanceToken, chain: Chain): WalletToken {
  if (!token.symbol || typeof token.symbol !== "string") {
    throw new Error(
      `EVM token missing symbol for address: ${token.contractAddress}`,
    );
  }
  if (!token.name || typeof token.name !== "string") {
    throw new Error(
      `EVM token missing name for address: ${token.contractAddress}`,
    );
  }

  return {
    id: `token-${chain}-${token.contractAddress}`,
    symbol: token.symbol,
    name: token.name,
    contractAddress: token.contractAddress,
    chain,
    decimals: token.decimals,
    // logoUrl is optional - use empty string as default if not provided
    logoUrl: token.logoUrl ?? "",
    description: "",
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    balance: token.balance,
    balanceUsd: token.balanceUsd ?? 0, // balanceUsd can legitimately be 0
    priceUsd: token.priceUsd ?? 0, // priceUsd can legitimately be 0
  };
}

/**
 * Transform Solana balance to WalletToken
 */
function transformSolanaToken(token: SolanaBalanceToken): WalletToken {
  if (!token.symbol || typeof token.symbol !== "string") {
    throw new Error(`Solana token missing symbol for mint: ${token.mint}`);
  }
  if (!token.name || typeof token.name !== "string") {
    throw new Error(`Solana token missing name for mint: ${token.mint}`);
  }

  return {
    id: `token-solana-${token.mint}`,
    symbol: token.symbol,
    name: token.name,
    contractAddress: token.mint,
    chain: "solana",
    decimals: token.decimals,
    // logoUrl is optional - use empty string as default if not provided
    logoUrl: token.logoURI ?? "",
    description: "",
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    balance: token.amount.toString(),
    balanceUsd: token.balanceUsd ?? 0, // balanceUsd can legitimately be 0
    priceUsd: token.priceUsd ?? 0, // priceUsd can legitimately be 0
  };
}

/**
 * Filter and sort tokens (remove dust, sort by value)
 */
function processTokens(tokens: WalletToken[]): WalletToken[] {
  // Filter dust
  const filtered = tokens.filter((t) => {
    const humanBalance = Number(BigInt(t.balance)) / Math.pow(10, t.decimals);
    if (t.priceUsd > 0 && t.balanceUsd < MIN_VALUE_USD) {
      return false;
    }
    return humanBalance >= MIN_TOKEN_BALANCE;
  });

  // Sort: priced tokens first, then by balance
  filtered.sort((a, b) => {
    const aHasPrice = a.priceUsd > 0;
    const bHasPrice = b.priceUsd > 0;
    if (aHasPrice && !bHasPrice) return -1;
    if (!aHasPrice && bHasPrice) return 1;
    if (aHasPrice && bHasPrice) return b.balanceUsd - a.balanceUsd;
    const aBalance = Number(BigInt(a.balance)) / Math.pow(10, a.decimals);
    const bBalance = Number(BigInt(b.balance)) / Math.pow(10, b.decimals);
    return bBalance - aBalance;
  });

  return filtered;
}

/**
 * Fetch EVM wallet tokens
 */
async function fetchEvmTokens(
  address: string,
  chain: Chain,
  forceRefresh: boolean,
): Promise<WalletToken[]> {
  // Validate inputs
  parseOrThrow(AddressSchema, address);
  parseOrThrow(ChainSchema, chain);

  const url = `/api/evm-balances?address=${address}&chain=${chain}${forceRefresh ? "&refresh=true" : ""}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000),
  });
  const rawData = await response.json();

  const data = parseOrThrow(EvmBalancesResponseSchema, rawData);

  if (data.error) {
    throw new Error(`EVM balance fetch failed: ${data.error}`);
  }

  const tokens = data.tokens.map((t) =>
    transformEvmToken(t as EvmBalanceToken, chain),
  );
  return processTokens(tokens);
}

/**
 * Fetch Solana wallet tokens
 */
async function fetchSolanaTokens(
  address: string,
  forceRefresh: boolean,
): Promise<WalletToken[]> {
  // Validate address
  parseOrThrow(AddressSchema, address);

  const url = `/api/solana-balances?address=${address}${forceRefresh ? "&refresh=true" : ""}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Solana balance fetch failed: ${response.status}`);
  }

  const rawData = await response.json();

  const data = parseOrThrow(SolanaBalancesResponseSchema, rawData);

  const tokens = data.tokens.map((t) =>
    transformSolanaToken(t as SolanaBalanceToken),
  );
  return processTokens(tokens);
}

/**
 * Query key factory for wallet tokens
 */
export const walletTokensKeys = {
  all: ["walletTokens"] as const,
  byChain: (chain: Chain) => [...walletTokensKeys.all, chain] as const,
  byWallet: (address: string, chain: Chain) =>
    [...walletTokensKeys.byChain(chain), address] as const,
};

/**
 * Hook to fetch and cache wallet tokens using React Query.
 *
 * Features:
 * - 5 min stale time (wallet balances don't change often)
 * - 15 min cache time (keep data longer for returning users)
 * - Background refetch on window focus
 * - Deduplication of concurrent requests
 */
export function useWalletTokens(
  address: string | undefined,
  chain: Chain,
  options?: { enabled?: boolean; forceRefresh?: boolean },
) {
  const { enabled = true, forceRefresh = false } = options ?? {};

  return useQuery({
    queryKey: address
      ? walletTokensKeys.byWallet(address, chain)
      : walletTokensKeys.byChain(chain),
    queryFn: async () => {
      if (!address) return [];

      if (chain === "solana") {
        return fetchSolanaTokens(address, forceRefresh);
      }
      return fetchEvmTokens(address, chain, forceRefresh);
    },
    staleTime: 5 * 60_000, // 5 minutes - balances don't change frequently
    gcTime: 15 * 60_000, // 15 minutes - keep cached for returning users
    enabled: enabled && !!address,
    refetchOnWindowFocus: true,
    refetchOnMount: false, // Don't refetch on every mount if data exists
  });
}

/**
 * Hook to invalidate wallet tokens cache (call after transactions)
 */
export function useInvalidateWalletTokens() {
  const queryClient = useQueryClient();

  return (address?: string, chain?: Chain) => {
    if (address && chain) {
      queryClient.invalidateQueries({
        queryKey: walletTokensKeys.byWallet(address, chain),
      });
    } else if (chain) {
      queryClient.invalidateQueries({
        queryKey: walletTokensKeys.byChain(chain),
      });
    } else {
      queryClient.invalidateQueries({ queryKey: walletTokensKeys.all });
    }
  };
}

/**
 * Hook to refetch wallet tokens (force refresh)
 */
export function useRefetchWalletTokens() {
  const queryClient = useQueryClient();

  return async (address: string, chain: Chain) => {
    // Clear the cache entry first
    queryClient.removeQueries({
      queryKey: walletTokensKeys.byWallet(address, chain),
    });

    // Then refetch with forceRefresh=true
    return queryClient.fetchQuery({
      queryKey: walletTokensKeys.byWallet(address, chain),
      queryFn: async () => {
        if (chain === "solana") {
          return fetchSolanaTokens(address, true);
        }
        return fetchEvmTokens(address, chain, true);
      },
      staleTime: 5 * 60_000,
    });
  };
}
