/**
 * usePoolCheck - React Query hook for pool validation
 *
 * Validates that EVM tokens have liquidity pools for price discovery.
 * Used in consignment form to verify token can be listed.
 *
 * Features:
 * - Caches results to avoid redundant API calls
 * - Shared across form-step and review-step
 * - Only runs for EVM chains (Solana skipped)
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chain, PoolCheckResult } from "@/types";
import { poolKeys } from "./queryKeys";

/**
 * Validate pool check response has required fields
 * Throws if validation fails
 */
function validatePoolCheckResult(data: unknown): PoolCheckResult {
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid pool check response: expected object");
  }

  const obj = data as Record<string, unknown>;

  // Validate required fields
  if (typeof obj.success !== "boolean") {
    throw new Error("Invalid pool check response: missing success field");
  }
  if (typeof obj.tokenAddress !== "string") {
    throw new Error("Invalid pool check response: missing tokenAddress field");
  }
  if (typeof obj.chain !== "string") {
    throw new Error("Invalid pool check response: missing chain field");
  }
  if (typeof obj.hasPool !== "boolean") {
    throw new Error("Invalid pool check response: missing hasPool field");
  }

  return data as PoolCheckResult;
}

/**
 * Fetch pool check data from API
 */
async function fetchPoolCheck(address: string, chain: Chain): Promise<PoolCheckResult> {
  const response = await fetch(
    `/api/token-pool-check?address=${encodeURIComponent(address)}&chain=${chain}`,
  );

  if (!response.ok) {
    throw new Error(`Pool check failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return validatePoolCheckResult(data);
}

/**
 * Hook to check pool availability for a token
 *
 * Features:
 * - 60s stale time (pool data doesn't change frequently)
 * - 5min cache time
 * - Only enabled for EVM chains (chain !== "solana")
 * - Shared cache across form steps
 *
 * @param address - Token contract address
 * @param chain - Chain to check (base, bsc, ethereum, solana)
 * @returns { poolCheck, isLoading, error }
 */
export function usePoolCheck(address: string | null | undefined, chain: Chain | null | undefined) {
  // Solana doesn't use pool checks
  const isSolana = chain === "solana";
  const isEnabled = !!address && !!chain && !isSolana;

  const query = useQuery({
    queryKey: address && chain ? poolKeys.check(address, chain) : poolKeys.all,
    queryFn: () => {
      if (!address || !chain) {
        throw new Error("Address and chain required for pool check");
      }
      return fetchPoolCheck(address, chain);
    },
    staleTime: 60_000, // 1 minute
    gcTime: 300_000, // 5 minutes
    enabled: isEnabled,
    retry: 2,
    retryDelay: 1000,
  });

  return {
    poolCheck: query.data ?? null,
    isLoading: query.isLoading,
    isCheckingPool: query.isLoading, // Alias for compatibility with form-step
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to invalidate pool check cache
 * Call after token registration to refresh pool data
 */
export function useInvalidatePoolCheck() {
  const queryClient = useQueryClient();

  return (address?: string, chain?: Chain) => {
    if (address && chain) {
      queryClient.invalidateQueries({
        queryKey: poolKeys.check(address, chain),
      });
    } else {
      queryClient.invalidateQueries({ queryKey: poolKeys.all });
    }
  };
}

/**
 * Hook to prefetch pool check data
 * Useful for optimistic loading when user selects a token
 */
export function usePrefetchPoolCheck() {
  const queryClient = useQueryClient();

  return (address: string, chain: Chain) => {
    if (chain === "solana") return Promise.resolve(); // Skip Solana

    return queryClient.prefetchQuery({
      queryKey: poolKeys.check(address, chain),
      queryFn: () => fetchPoolCheck(address, chain),
      staleTime: 60_000,
    });
  };
}
