import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/helpers";
import type { Token } from "@/types";
import { TokenBatchResponseSchema } from "@/types/validation/hook-schemas";
import { tokenKeys } from "./queryKeys";

// Token IDs array validation
const TokenIdsArraySchema = z.array(z.string().min(1));

// API returns flat Token objects (not wrapped in { token, marketData })
async function fetchTokenBatch(
  tokenIds: string[],
): Promise<Record<string, Token | null>> {
  if (tokenIds.length === 0) return {};

  // Validate token IDs
  parseOrThrow(TokenIdsArraySchema, tokenIds);

  const response = await fetch(
    `/api/tokens/batch?ids=${encodeURIComponent(tokenIds.join(","))}`,
  );
  const rawData = await response.json();

  // Validate response structure
  const data = parseOrThrow(TokenBatchResponseSchema, rawData);

  if (!data.success) {
    // Error message is optional in error response - provide fallback
    const errorMessage =
      typeof data.error === "string" && data.error.trim() !== ""
        ? data.error
        : "Failed to fetch tokens";
    throw new Error(errorMessage);
  }

  return data.tokens as Record<string, Token | null>;
}

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
