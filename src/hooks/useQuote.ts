/**
 * useQuote - React Query hooks for quote data
 *
 * Handles fetching executed quotes for deal pages with:
 * - Automatic retry with exponential backoff
 * - Cache sharing across navigation
 * - Proper error handling
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DealQuote } from "@/components/deal-completion";
import { quoteKeys } from "./queryKeys";

/**
 * Fetch an executed quote by ID with retry logic
 * Handles the case where the quote may not be immediately available after redirect
 */
async function fetchExecutedQuote(quoteId: string): Promise<DealQuote> {
	const response = await fetch(`/api/quote/executed/${encodeURIComponent(quoteId)}`, {
		cache: "no-store",
	});

	if (!response.ok) {
		const errorText = await response.text();
		// Check if it's a transient error (service not ready)
		if (errorText.includes("not registered")) {
			throw new Error("SERVICE_NOT_READY");
		}
		throw new Error(`Quote not found: ${quoteId}`);
	}

	const data = await response.json();

	if (!data.quote) {
		throw new Error(`Quote not found in API response for: ${quoteId}`);
	}

	return data.quote as DealQuote;
}

/**
 * Fetch quote by offer ID (for linking offers to quotes)
 */
async function fetchQuoteByOffer(offerId: string): Promise<{ quoteId: string } | null> {
	const response = await fetch(`/api/quote/by-offer/${encodeURIComponent(offerId)}`);

	if (!response.ok) {
		return null;
	}

	const data = await response.json();
	if (!data.quoteId) {
		return null;
	}

	return { quoteId: data.quoteId };
}

/**
 * Hook to fetch an executed quote by ID
 *
 * Features:
 * - 3 retries with exponential backoff (handles service not ready after redirect)
 * - 60s stale time (quote data rarely changes)
 * - Cache shared across navigation
 *
 * @param quoteId - Quote ID to fetch
 * @returns { quote, isLoading, error, refetch }
 */
export function useExecutedQuote(quoteId: string | null | undefined) {
	const query = useQuery({
		queryKey: quoteId ? quoteKeys.executed(quoteId) : quoteKeys.all,
		queryFn: () => {
			if (!quoteId) throw new Error("No quoteId provided");
			return fetchExecutedQuote(quoteId);
		},
		staleTime: 60_000, // 1 minute - quote data rarely changes
		gcTime: 300_000, // 5 minutes
		enabled: !!quoteId,
		retry: 3,
		retryDelay: (attempt, error) => {
			// Faster retry for service not ready errors
			if (error instanceof Error && error.message === "SERVICE_NOT_READY") {
				return Math.min(500 * 2 ** attempt, 5000);
			}
			return Math.min(1000 * 2 ** attempt, 10000);
		},
	});

	return {
		quote: query.data ?? null,
		isLoading: query.isLoading,
		error: query.error,
		refetch: query.refetch,
	};
}

/**
 * Hook to fetch quote ID by offer ID
 *
 * Useful for linking contract offers to their associated quotes
 *
 * @param offerId - Offer ID to look up
 * @returns { quoteId, isLoading, error }
 */
export function useQuoteByOffer(offerId: string | null | undefined) {
	const query = useQuery({
		queryKey: offerId ? quoteKeys.byOffer(offerId) : quoteKeys.all,
		queryFn: () => {
			if (!offerId) return null;
			return fetchQuoteByOffer(offerId);
		},
		staleTime: 300_000, // 5 minutes - offer->quote mapping is stable
		gcTime: 600_000, // 10 minutes
		enabled: !!offerId,
	});

	return {
		quoteId: query.data?.quoteId ?? null,
		isLoading: query.isLoading,
		error: query.error,
	};
}

/**
 * Hook to invalidate quote cache
 */
export function useInvalidateQuote() {
	const queryClient = useQueryClient();

	return (quoteId?: string) => {
		if (quoteId) {
			queryClient.invalidateQueries({ queryKey: quoteKeys.executed(quoteId) });
		} else {
			queryClient.invalidateQueries({ queryKey: quoteKeys.all });
		}
	};
}

/**
 * Hook to prefetch quote data (for optimistic loading)
 */
export function usePrefetchQuote() {
	const queryClient = useQueryClient();

	return (quoteId: string) => {
		return queryClient.prefetchQuery({
			queryKey: quoteKeys.executed(quoteId),
			queryFn: () => fetchExecutedQuote(quoteId),
			staleTime: 60_000,
		});
	};
}
