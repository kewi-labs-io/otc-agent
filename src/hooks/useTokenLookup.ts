/**
 * useTokenLookup - React Query hook for token address lookup
 *
 * Looks up token metadata by contract address using external APIs
 * (Alchemy for EVM, Codex for Solana).
 *
 * Used in consignment form for address-based token search.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chain } from "@/config/chains";
import type { TokenInfo } from "@/types/api";
import { tokenKeys } from "./queryKeys";

/**
 * API response shape
 */
interface TokenLookupResponse {
  success: boolean;
  token?: TokenInfo;
  error?: string;
}

/**
 * Fetch token by address from external API
 *
 * @param address - Token contract address
 * @param chain - Chain to search (optional, auto-detected from address)
 */
async function lookupToken(address: string, chain?: Chain): Promise<TokenInfo> {
  const params = new URLSearchParams();
  params.set("address", address);
  if (chain) {
    params.set("chain", chain);
  }

  const response = await fetch(`/api/token-lookup?${params.toString()}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Token not found at address: ${address}`);
    }
    if (response.status === 503) {
      throw new Error("Token lookup service not configured");
    }
    throw new Error(
      `Token lookup failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TokenLookupResponse;

  if (!data.success || !data.token) {
    throw new Error(data.error ?? `Token not found at address: ${address}`);
  }

  return data.token;
}

/**
 * Hook to look up a token by contract address
 *
 * Features:
 * - 5min stale time (token metadata rarely changes)
 * - 30min cache time (addresses are stable identifiers)
 * - Auto-detects chain from address format
 *
 * @param address - Token contract address
 * @param chain - Optional chain hint (auto-detected if not provided)
 * @param options - Additional options
 * @returns { token, isLoading, error }
 */
export function useTokenLookup(
  address: string | null | undefined,
  chain?: Chain,
  options?: {
    enabled?: boolean;
  },
) {
  const { enabled = true } = options ?? {};

  // Normalize address for cache key
  const normalizedAddress = address?.trim() ?? null;

  // Detect chain from address format if not provided
  const detectedChain =
    chain ?? (normalizedAddress?.startsWith("0x") ? "base" : "solana");

  const query = useQuery({
    queryKey: normalizedAddress
      ? tokenKeys.lookup(normalizedAddress, detectedChain)
      : tokenKeys.all,
    queryFn: () => {
      if (!normalizedAddress) {
        throw new Error("No address provided");
      }
      return lookupToken(normalizedAddress, chain);
    },
    staleTime: 300_000, // 5 minutes
    gcTime: 1800_000, // 30 minutes
    enabled: enabled && !!normalizedAddress,
    retry: 1, // Only retry once - address lookup failures are usually permanent
    retryDelay: 1000,
  });

  return {
    token: query.data ?? null,
    isLoading: query.isLoading,
    isSearching: query.isLoading, // Alias for form compatibility
    error: query.error,
    searchError: query.error instanceof Error ? query.error.message : null, // String error for form
    refetch: query.refetch,
  };
}

/**
 * Hook to invalidate token lookup cache
 */
export function useInvalidateTokenLookup() {
  const queryClient = useQueryClient();

  return (address?: string, chain?: Chain) => {
    if (address && chain) {
      queryClient.invalidateQueries({
        queryKey: tokenKeys.lookup(address, chain),
      });
    } else {
      // Invalidate all lookup queries
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) && key[0] === "tokens" && key[1] === "lookup"
          );
        },
      });
    }
  };
}

/**
 * Hook to prefetch token lookup data
 */
export function usePrefetchTokenLookup() {
  const queryClient = useQueryClient();

  return (address: string, chain?: Chain) => {
    return queryClient.prefetchQuery({
      queryKey: tokenKeys.lookup(address, chain ?? "base"),
      queryFn: () => lookupToken(address, chain),
      staleTime: 300_000,
    });
  };
}
