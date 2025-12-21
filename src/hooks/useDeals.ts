import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DealFromAPI, DealsResponse } from "@/types";
import { parseOrThrow } from "@/lib/validation/helpers";
import { AddressSchema } from "@/types/validation/schemas";
import { DealsResponseSchema } from "@/types/validation/hook-schemas";

// Re-export for consumers
export type { DealFromAPI, DealsResponse } from "@/types";

async function fetchDeals(walletAddress: string): Promise<DealFromAPI[]> {
  // Validate wallet address
  parseOrThrow(AddressSchema, walletAddress);

  const response = await fetch(
    `/api/deal-completion?wallet=${encodeURIComponent(walletAddress)}`,
  );
  const rawData = await response.json();

  // Validate response structure
  const data = parseOrThrow(DealsResponseSchema, rawData);

  if (!data.success) {
    // Error message is optional in error response - provide fallback
    const errorMessage =
      typeof data.error === "string" && data.error.trim() !== ""
        ? data.error
        : "Failed to fetch deals";
    throw new Error(errorMessage);
  }

  return data.deals as DealFromAPI[];
}

/**
 * Query key factory for deals
 */
export const dealsKeys = {
  all: ["deals"] as const,
  lists: () => [...dealsKeys.all, "list"] as const,
  byWallet: (wallet: string) => [...dealsKeys.lists(), wallet] as const,
};

/**
 * Hook to fetch and cache user deals using React Query.
 *
 * Features:
 * - 30s stale time (deals may update when transactions complete)
 * - 2m cache time
 * - Background refetch on window focus
 */
export function useDeals(walletAddress: string | undefined) {
  return useQuery({
    queryKey: walletAddress ? dealsKeys.byWallet(walletAddress) : dealsKeys.all,
    queryFn: () => {
      if (!walletAddress) throw new Error("No wallet address");
      return fetchDeals(walletAddress);
    },
    staleTime: 30_000, // 30 seconds - deals can change when tx complete
    gcTime: 120_000, // 2 minutes
    enabled: !!walletAddress,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to invalidate deals cache (call after transactions)
 */
export function useInvalidateDeals() {
  const queryClient = useQueryClient();

  return (walletAddress?: string) => {
    if (walletAddress) {
      queryClient.invalidateQueries({
        queryKey: dealsKeys.byWallet(walletAddress),
      });
    } else {
      queryClient.invalidateQueries({ queryKey: dealsKeys.all });
    }
  };
}

/**
 * Hook to prefetch deals for a wallet
 */
export function usePrefetchDeals() {
  const queryClient = useQueryClient();

  return (walletAddress: string) => {
    queryClient.prefetchQuery({
      queryKey: dealsKeys.byWallet(walletAddress),
      queryFn: () => fetchDeals(walletAddress),
      staleTime: 30_000,
    });
  };
}
