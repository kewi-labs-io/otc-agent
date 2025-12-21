import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseOrThrow } from "@/lib/validation/helpers";
import type { Chain, OTCConsignment } from "@/types";
import {
  type ConsignmentsFilters,
  ConsignmentsFiltersSchema,
  ConsignmentsResponseSchema,
} from "@/types/validation/hook-schemas";
import { consignmentKeys } from "./queryKeys";

async function fetchConsignments(
  filters: ConsignmentsFilters,
): Promise<OTCConsignment[]> {
  const params = new URLSearchParams();

  if (filters.chains && Array.isArray(filters.chains)) {
    filters.chains.forEach((chain) => params.append("chains", chain));
  }
  if (filters.negotiableTypes && Array.isArray(filters.negotiableTypes)) {
    filters.negotiableTypes.forEach((type) =>
      params.append("negotiableTypes", type),
    );
  }
  if (filters.tokenId) params.set("tokenId", filters.tokenId);
  if (filters.consigner) params.set("consigner", filters.consigner);
  if (filters.requester) params.set("requester", filters.requester);

  const response = await fetch(`/api/consignments?${params.toString()}`);
  if (!response.ok) {
    throw new Error(
      `Consignments API failed: ${response.status} ${response.statusText}`,
    );
  }
  const rawData = await response.json();

  // Validate response structure
  const data = parseOrThrow(ConsignmentsResponseSchema, rawData);

  if (!data.success) {
    if (!data.error) {
      throw new Error("Failed to fetch consignments: unknown error");
    }
    throw new Error(data.error);
  }

  if (!Array.isArray(data.consignments)) {
    throw new Error("Invalid consignments response: expected array");
  }

  // Type is validated by schema - safe to return
  return data.consignments;
}

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

  const validatedFilters = parseOrThrow(ConsignmentsFiltersSchema, filters);

  return useQuery({
    queryKey: consignmentKeys.list(validatedFilters),
    queryFn: () => fetchConsignments(validatedFilters),
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
  chains: Chain[];
  negotiableTypes: ("negotiable" | "fixed")[];
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
 * Hook to invalidate consignments cache (call after mutations)
 */
export function useInvalidateConsignments() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: consignmentKeys.all });
  };
}
