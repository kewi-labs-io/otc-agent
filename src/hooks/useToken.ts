/**
 * useToken - React Query hook for fetching token data
 *
 * Replaces useTokenCache.ts with proper React Query integration:
 * - Automatic caching and deduplication
 * - Background refetching
 * - Shared cache across components
 * - No manual subscription management
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Address, createPublicClient, erc20Abi, http } from "viem";
import { base, bsc, mainnet } from "viem/chains";
import { parseOrThrow } from "@/lib/validation/helpers";
import type { Token, TokenMarketData } from "@/types";
import { TokenResponseSchema } from "@/types/validation/hook-schemas";
import { tokenKeys, priceKeys } from "./queryKeys";

// Chain configs for on-chain fetching (RPC endpoints via API proxy)
const chainConfigs = {
	base: { chain: base, rpcUrl: "/api/rpc/base" },
	ethereum: { chain: mainnet, rpcUrl: "/api/rpc/ethereum" },
	bsc: { chain: bsc, rpcUrl: "/api/rpc/base" }, // BSC uses same proxy pattern
} as const;

type SupportedEvmChain = keyof typeof chainConfigs;

/**
 * Parse tokenId to extract chain and address
 * Format: "token-{chain}-{address}"
 */
function parseTokenId(tokenId: string): { chain: string; address: string } {
	const parts = tokenId.split("-");
	if (parts.length < 3) {
		throw new Error(
			`Invalid tokenId format: ${tokenId}. Expected "token-{chain}-{address}"`,
		);
	}
	const chain = parts[1];
	const address = parts.slice(2).join("-"); // Handle addresses with dashes (unlikely but safe)
	if (!address) {
		throw new Error(`Missing address in tokenId: ${tokenId}`);
	}
	return { chain, address };
}

/**
 * Fetch token directly from blockchain (fallback for unregistered tokens)
 * Only supports EVM chains where we can read ERC20 metadata
 */
async function fetchTokenFromChain(tokenId: string): Promise<Token> {
	const { chain, address } = parseTokenId(tokenId);

	if (!address.startsWith("0x")) {
		throw new Error(
			`Invalid EVM address in tokenId: ${tokenId}. Address must start with "0x"`,
		);
	}

	const chainConfig = chainConfigs[chain as SupportedEvmChain];
	if (!chainConfig) {
		throw new Error(
			`On-chain token fetch not supported for chain: ${chain}. Supported: ${Object.keys(chainConfigs).join(", ")}`,
		);
	}

	const publicClient = createPublicClient({
		chain: chainConfig.chain,
		transport: http(chainConfig.rpcUrl),
	});

	// Type assertion for viem's strict generics
	type ReadContractFn = (params: {
		address: Address;
		abi: typeof erc20Abi;
		functionName: string;
	}) => Promise<unknown>;

	const readContract = publicClient.readContract.bind(
		publicClient,
	) as ReadContractFn;

	const [symbol, name, decimals] = await Promise.all([
		readContract({
			address: address as `0x${string}`,
			abi: erc20Abi,
			functionName: "symbol",
		}),
		readContract({
			address: address as `0x${string}`,
			abi: erc20Abi,
			functionName: "name",
		}),
		readContract({
			address: address as `0x${string}`,
			abi: erc20Abi,
			functionName: "decimals",
		}),
	]);

	return {
		id: tokenId,
		symbol: symbol as string,
		name: name as string,
		decimals: decimals as number,
		chain: chain as Token["chain"],
		contractAddress: address,
		logoUrl: "",
		description: "",
		isActive: true,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

/**
 * Fetch token from API, with fallback to on-chain for EVM tokens
 */
async function fetchToken(tokenId: string): Promise<{
	token: Token;
	marketData: TokenMarketData | null;
}> {
	const response = await fetch(`/api/tokens/${encodeURIComponent(tokenId)}`);

	if (!response.ok) {
		// Token not in database - try on-chain fetch for EVM tokens
		const { chain } = parseTokenId(tokenId);
		if (chain === "solana") {
			throw new Error(
				`Token ${tokenId} not found in database. Solana tokens must be registered.`,
			);
		}

		const chainToken = await fetchTokenFromChain(tokenId);
		return { token: chainToken, marketData: null };
	}

	const rawData = await response.json();
	const data = parseOrThrow(TokenResponseSchema, rawData);

	if (!data.success || !data.token) {
		throw new Error(`Invalid token response for: ${tokenId}`);
	}

	return {
		token: data.token as Token,
		marketData: (data.marketData as TokenMarketData) ?? null,
	};
}

/**
 * Fetch market data for a token
 */
async function fetchMarketData(
	tokenId: string,
): Promise<TokenMarketData | null> {
	const response = await fetch(`/api/market-data/${encodeURIComponent(tokenId)}`);

	if (!response.ok) {
		return null;
	}

	const data = await response.json();
	if (!data.success || !data.marketData) {
		return null;
	}

	return data.marketData as TokenMarketData;
}

/**
 * Hook to fetch token data with caching
 *
 * Features:
 * - 30s stale time (data considered fresh)
 * - 5min cache time (keep unused data)
 * - Automatic deduplication of concurrent requests
 * - Shared cache across all components
 *
 * @param tokenId - Token ID in format "token-{chain}-{address}"
 * @returns { token, marketData, isLoading, error }
 */
export function useToken(tokenId: string | null) {
	const query = useQuery({
		queryKey: tokenId ? tokenKeys.single(tokenId) : tokenKeys.all,
		queryFn: () => {
			if (!tokenId) throw new Error("No tokenId provided");
			return fetchToken(tokenId);
		},
		staleTime: 30_000, // 30 seconds
		gcTime: 300_000, // 5 minutes
		enabled: !!tokenId,
		retry: 2,
		retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
	});

	return {
		token: query.data?.token ?? null,
		marketData: query.data?.marketData ?? null,
		isLoading: query.isLoading,
		error: query.error,
		refetch: query.refetch,
	};
}

/**
 * Hook to fetch and auto-refresh market data
 *
 * Features:
 * - Auto-refresh every 30s while component is mounted
 * - Independent from token data (can update more frequently)
 * - Pauses refresh when tab is not visible
 *
 * @param tokenId - Token ID to fetch market data for
 * @returns { marketData, isLoading, error }
 */
export function useMarketData(tokenId: string | null) {
	const query = useQuery({
		queryKey: tokenId ? tokenKeys.marketData(tokenId) : priceKeys.all,
		queryFn: () => {
			if (!tokenId) return null;
			return fetchMarketData(tokenId);
		},
		staleTime: 30_000, // 30 seconds
		gcTime: 300_000, // 5 minutes
		enabled: !!tokenId,
		refetchInterval: 30_000, // Auto-refresh every 30s
		refetchIntervalInBackground: false, // Don't refresh when tab not visible
	});

	return {
		marketData: query.data ?? null,
		isLoading: query.isLoading,
		error: query.error,
	};
}

/**
 * Hook to fetch market data that updates alongside token data
 * Use this when you want market data to refresh with the main token
 *
 * @deprecated Use useMarketData for independent refresh, or useToken which includes marketData
 */
export function useMarketDataRefresh(
	tokenId: string | null,
	_token: Token | null, // Kept for API compatibility, not used
) {
	const { marketData } = useMarketData(tokenId);
	return marketData;
}

/**
 * Hook to invalidate token cache (call after mutations that affect token data)
 */
export function useInvalidateToken() {
	const queryClient = useQueryClient();

	return (tokenId?: string) => {
		if (tokenId) {
			queryClient.invalidateQueries({ queryKey: tokenKeys.single(tokenId) });
			queryClient.invalidateQueries({ queryKey: tokenKeys.marketData(tokenId) });
		} else {
			queryClient.invalidateQueries({ queryKey: tokenKeys.all });
		}
	};
}

/**
 * Hook to prefetch token data (for optimistic loading)
 */
export function usePrefetchToken() {
	const queryClient = useQueryClient();

	return (tokenId: string) => {
		return queryClient.prefetchQuery({
			queryKey: tokenKeys.single(tokenId),
			queryFn: () => fetchToken(tokenId),
			staleTime: 30_000,
		});
	};
}

// Re-export for backward compatibility with useTokenCache consumers
export { useToken as useTokenCache };
