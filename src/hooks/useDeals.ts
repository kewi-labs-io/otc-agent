import { useQuery, useQueryClient } from "@tanstack/react-query";

interface DealFromAPI {
  offerId: string;
  beneficiary: string;
  tokenAmount: string;
  discountBps: number;
  paymentCurrency: string;
  paymentAmount: string;
  payer: string;
  createdAt: string;
  lockupMonths?: number;
  lockupDays?: number;
  quoteId?: string;
  status?: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string;
  tokenId?: string;
  chain?: string;
  priceUsdPerToken?: number;
  ethUsdPrice?: number;
  totalUsd?: number;
  discountedUsd?: number;
}

interface DealsResponse {
  success: boolean;
  deals: DealFromAPI[];
  error?: string;
}

async function fetchDeals(walletAddress: string): Promise<DealFromAPI[]> {
  const response = await fetch(
    `/api/deal-completion?wallet=${encodeURIComponent(walletAddress)}`,
  );
  const data: DealsResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error ?? "Failed to fetch deals");
  }

  return data.deals;
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

export type { DealFromAPI };

