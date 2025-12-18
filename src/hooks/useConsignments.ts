import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OTCConsignment } from "@/types";

interface ConsignmentsFilters {
  chains?: string[];
  negotiableTypes?: string[];
  tokenId?: string;
  consigner?: string;
  requester?: string;
}

interface ConsignmentsResponse {
  success: boolean;
  consignments: OTCConsignment[];
  error?: string;
}

async function fetchConsignments(
  filters: ConsignmentsFilters,
): Promise<OTCConsignment[]> {
  const params = new URLSearchParams();

  filters.chains?.forEach((chain) => params.append("chains", chain));
  filters.negotiableTypes?.forEach((type) =>
    params.append("negotiableTypes", type),
  );
  if (filters.tokenId) params.set("tokenId", filters.tokenId);
  if (filters.consigner) params.set("consigner", filters.consigner);
  if (filters.requester) params.set("requester", filters.requester);

  const response = await fetch(`/api/consignments?${params.toString()}`);
  const data: ConsignmentsResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error ?? "Failed to fetch consignments");
  }

  return data.consignments;
}

/**
 * Query key factory for consignments - enables fine-grained cache invalidation
 */
export const consignmentsKeys = {
  all: ["consignments"] as const,
  lists: () => [...consignmentsKeys.all, "list"] as const,
  list: (filters: ConsignmentsFilters) =>
    [...consignmentsKeys.lists(), filters] as const,
  byConsigner: (address: string) =>
    [...consignmentsKeys.lists(), { consigner: address }] as const,
  byToken: (tokenId: string) =>
    [...consignmentsKeys.lists(), { tokenId }] as const,
};

interface UseConsignmentsOptions {
  filters?: ConsignmentsFilters;
  enabled?: boolean;
}

/**
 * Hook to fetch and cache consignments using React Query.
 *
 * Features:
 * - 60s stale time (data considered fresh, no refetch)
 * - 5m cache time (keep unused data for 5 minutes)
 * - Background refetch on window focus
 * - Automatic deduplication of concurrent requests
 * - Shared cache across all components using same filters
 */
export function useConsignments(options: UseConsignmentsOptions = {}) {
  const { filters = {}, enabled = true } = options;

  return useQuery({
    queryKey: consignmentsKeys.list(filters),
    queryFn: () => fetchConsignments(filters),
    staleTime: 60_000, // 1 minute - consignments change less frequently
    gcTime: 300_000, // 5 minutes - keep in cache longer
    enabled,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

/**
 * Hook to fetch consignments for the trading desk (public listings)
 */
export function useTradingDeskConsignments(filters: {
  chains: string[];
  negotiableTypes: string[];
}) {
  return useConsignments({
    filters: {
      chains: filters.chains,
      negotiableTypes: filters.negotiableTypes,
    },
  });
}

/**
 * Hook to fetch consignments owned by a specific wallet
 */
export function useMyConsignments(walletAddress: string | undefined) {
  return useConsignments({
    filters: { consigner: walletAddress },
    enabled: !!walletAddress,
  });
}

/**
 * Hook to prefetch consignments (e.g., on hover or before navigation)
 */
export function usePrefetchConsignments() {
  const queryClient = useQueryClient();

  return (filters: ConsignmentsFilters) => {
    queryClient.prefetchQuery({
      queryKey: consignmentsKeys.list(filters),
      queryFn: () => fetchConsignments(filters),
      staleTime: 60_000,
    });
  };
}

/**
 * Hook to invalidate consignments cache (call after mutations)
 */
export function useInvalidateConsignments() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: consignmentsKeys.all });
  };
}

