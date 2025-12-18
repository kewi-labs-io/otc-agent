import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Token, TokenMarketData } from "@/types";

interface TokenWithMarketData {
  token: Token;
  marketData: TokenMarketData | null;
}

interface BatchResponse {
  success: boolean;
  tokens: Record<string, TokenWithMarketData | null>;
  error?: string;
}

async function fetchTokenBatch(
  tokenIds: string[],
): Promise<Record<string, TokenWithMarketData | null>> {
  if (tokenIds.length === 0) return {};

  const response = await fetch(
    `/api/tokens/batch?ids=${encodeURIComponent(tokenIds.join(","))}`,
  );
  const data: BatchResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error ?? "Failed to fetch tokens");
  }

  return data.tokens;
}

/**
 * Query key factory for tokens
 */
export const tokenKeys = {
  all: ["tokens"] as const,
  batches: () => [...tokenKeys.all, "batch"] as const,
  batch: (ids: string[]) => [...tokenKeys.batches(), ids.sort().join(",")] as const,
  single: (id: string) => [...tokenKeys.all, "single", id] as const,
};

/**
 * Hook to batch-fetch multiple tokens at once.
 *
 * Much more efficient than individual fetches when displaying a list
 * of tokens (e.g., trading desk with 20+ consignments).
 *
 * Features:
 * - Single HTTP request for all tokens
 * - 2 minute cache (tokens rarely change)
 * - Automatic deduplication
 */
export function useTokenBatch(tokenIds: string[]) {
  // Sort and dedupe for stable query key
  const uniqueIds = [...new Set(tokenIds)].sort();

  return useQuery({
    queryKey: tokenKeys.batch(uniqueIds),
    queryFn: () => fetchTokenBatch(uniqueIds),
    staleTime: 120_000, // 2 minutes - token metadata rarely changes
    gcTime: 300_000, // 5 minutes
    enabled: uniqueIds.length > 0,
    refetchOnWindowFocus: false, // Token metadata doesn't need frequent updates
  });
}

/**
 * Hook to prefetch a batch of tokens
 */
export function usePrefetchTokenBatch() {
  const queryClient = useQueryClient();

  return (tokenIds: string[]) => {
    const uniqueIds = [...new Set(tokenIds)].sort();
    if (uniqueIds.length === 0) return;

    queryClient.prefetchQuery({
      queryKey: tokenKeys.batch(uniqueIds),
      queryFn: () => fetchTokenBatch(uniqueIds),
      staleTime: 120_000,
    });
  };
}

/**
 * Get a single token from the batch query cache.
 * Use this when you have already fetched a batch and need to access individual tokens.
 */
export function useTokenFromBatch(
  tokenId: string,
  batchData: Record<string, TokenWithMarketData | null> | undefined,
): TokenWithMarketData | null {
  if (!batchData || !tokenId) return null;
  return batchData[tokenId] ?? null;
}

