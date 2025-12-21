/**
 * useNativePrices - React Query hook for native token prices
 *
 * Fetches ETH, BNB, and SOL prices in USD.
 * Used in accept-quote-modal for payment calculations.
 *
 * Features:
 * - Auto-refresh every 60s
 * - Shared cache across all components
 * - Pauses refresh when tab not visible
 */

import { useQuery } from "@tanstack/react-query";
import type { NativePrices } from "@/types";
import { priceKeys } from "./queryKeys";

/**
 * Response shape from /api/native-prices
 */
interface NativePricesResponse {
	ETH?: number;
	BNB?: number;
	SOL?: number;
}

/**
 * Fetch native prices from API
 */
async function fetchNativePrices(): Promise<NativePrices> {
	const response = await fetch("/api/native-prices");

	if (!response.ok) {
		throw new Error(`Failed to fetch native prices: ${response.status}`);
	}

	const data = (await response.json()) as NativePricesResponse;

	// Transform to NativePrices type, filtering out invalid values
	const prices: NativePrices = {};

	if (typeof data.ETH === "number" && data.ETH > 0) {
		prices.ETH = data.ETH;
	}
	if (typeof data.BNB === "number" && data.BNB > 0) {
		prices.BNB = data.BNB;
	}
	if (typeof data.SOL === "number" && data.SOL > 0) {
		prices.SOL = data.SOL;
	}

	return prices;
}

/**
 * Hook to fetch and auto-refresh native token prices
 *
 * Features:
 * - 60s stale time (prices change slowly)
 * - Auto-refresh every 60s
 * - Shared cache across components
 * - Pauses refresh when tab not visible
 *
 * @returns { prices, isLoading, error }
 */
export function useNativePrices() {
	const query = useQuery({
		queryKey: priceKeys.native(),
		queryFn: fetchNativePrices,
		staleTime: 60_000, // 1 minute
		gcTime: 300_000, // 5 minutes
		refetchInterval: 60_000, // Auto-refresh every minute
		refetchIntervalInBackground: false, // Don't refresh when tab not visible
		retry: 2,
		retryDelay: 1000,
	});

	return {
		prices: query.data ?? {},
		ethPrice: query.data?.ETH ?? 0,
		bnbPrice: query.data?.BNB ?? 0,
		solPrice: query.data?.SOL ?? 0,
		isLoading: query.isLoading,
		error: query.error,
	};
}

/**
 * Hook to get a specific native price
 *
 * @param symbol - "ETH" | "BNB" | "SOL"
 * @returns price in USD, or 0 if not available
 */
export function useNativePrice(symbol: "ETH" | "BNB" | "SOL") {
	const { prices, isLoading } = useNativePrices();

	return {
		price: prices[symbol] ?? 0,
		isLoading,
	};
}
