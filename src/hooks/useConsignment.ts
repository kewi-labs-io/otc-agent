/**
 * useConsignment - React Query hook for single consignment data
 *
 * Fetches individual consignment by ID for:
 * - Accept quote modal (needs contractConsignmentId, remainingAmount)
 * - Consignment details pages
 *
 * Features:
 * - Shares cache with useConsignments list queries
 * - Supports caller address for owner-specific data
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OTCConsignment } from "@/types";
import { consignmentKeys } from "./queryKeys";

/**
 * API response shape for single consignment
 */
interface ConsignmentResponse {
  success: boolean;
  consignment?: OTCConsignment;
  error?: string;
}

/**
 * Fetch a single consignment by ID
 *
 * @param id - Consignment database ID
 * @param callerAddress - Optional wallet address for owner-specific data
 */
async function fetchConsignment(id: string, callerAddress?: string): Promise<OTCConsignment> {
  const url = callerAddress
    ? `/api/consignments/${encodeURIComponent(id)}?callerAddress=${encodeURIComponent(callerAddress)}`
    : `/api/consignments/${encodeURIComponent(id)}`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Consignment ${id} not found`);
    }
    throw new Error(`Failed to fetch consignment: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ConsignmentResponse;

  if (!data.success || !data.consignment) {
    throw new Error(data.error ?? `Consignment ${id} not found in response`);
  }

  return data.consignment;
}

/**
 * Hook to fetch a single consignment by ID
 *
 * Features:
 * - 30s stale time (consignments can change with deals)
 * - 5min cache time
 * - Supports caller address for owner-specific data visibility
 *
 * @param id - Consignment database ID
 * @param options - Optional configuration
 * @returns { consignment, isLoading, error }
 */
export function useConsignment(
  id: string | null | undefined,
  options?: {
    callerAddress?: string;
    enabled?: boolean;
  },
) {
  const { callerAddress, enabled = true } = options ?? {};

  const query = useQuery({
    queryKey: id ? consignmentKeys.single(id) : consignmentKeys.all,
    queryFn: () => {
      if (!id) throw new Error("No consignment ID provided");
      return fetchConsignment(id, callerAddress);
    },
    staleTime: 30_000, // 30 seconds
    gcTime: 300_000, // 5 minutes
    enabled: enabled && !!id,
    retry: 2,
    retryDelay: 1000,
  });

  return {
    consignment: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to invalidate consignment cache
 * Call after mutations that affect consignment data
 */
export function useInvalidateConsignment() {
  const queryClient = useQueryClient();

  return (id?: string) => {
    if (id) {
      queryClient.invalidateQueries({ queryKey: consignmentKeys.single(id) });
    }
    // Also invalidate list queries since they include this consignment
    queryClient.invalidateQueries({ queryKey: consignmentKeys.all });
  };
}

/**
 * Hook to prefetch consignment data
 */
export function usePrefetchConsignment() {
  const queryClient = useQueryClient();

  return (id: string, callerAddress?: string) => {
    return queryClient.prefetchQuery({
      queryKey: consignmentKeys.single(id),
      queryFn: () => fetchConsignment(id, callerAddress),
      staleTime: 30_000,
    });
  };
}

/**
 * Hook to update consignment in cache (for optimistic updates)
 */
export function useSetConsignmentData() {
  const queryClient = useQueryClient();

  return (id: string, data: OTCConsignment) => {
    queryClient.setQueryData(consignmentKeys.single(id), data);
  };
}
