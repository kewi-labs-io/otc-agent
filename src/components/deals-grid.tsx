"use client";

import { useMemo, useState, memo, useCallback } from "react";
import { TokenDealsSection } from "./token-deals-section";
import { useTradingDeskConsignments } from "@/hooks/useConsignments";
import { useTokenBatch } from "@/hooks/useTokenBatch";
import { useRenderTracker } from "@/utils/render-tracker";
import { Button } from "./button";
import type { OTCConsignment, Token, TokenMarketData, Chain } from "@/types";

const PAGE_SIZE = 10;

type NegotiableType = "negotiable" | "fixed";

interface DealsGridProps {
  filters: {
    chains: Chain[];
    minMarketCap: number;
    maxMarketCap: number;
    negotiableTypes: NegotiableType[];
  };
  searchQuery?: string;
}

interface TokenGroup {
  tokenId: string;
  token: Token | null;
  marketData: TokenMarketData | null;
  consignments: OTCConsignment[];
}

// --- Helper: Filter valid consignments (active with remaining amount) ---
function filterValidConsignments(
  consignments: OTCConsignment[],
): OTCConsignment[] {
  return consignments.filter((c) => {
    if (c.status !== "active") return false;
    const remaining = BigInt(c.remainingAmount);
    if (remaining <= 0n) return false;
    return true;
  });
}

// --- Helper: Group consignments by tokenId ---
function groupConsignmentsByToken(
  consignments: OTCConsignment[],
): TokenGroup[] {
  const validConsignments = filterValidConsignments(consignments);
  const uniqueMap = new Map(validConsignments.map((c) => [c.id, c]));
  const unique = Array.from(uniqueMap.values());

  const grouped = new Map<string, TokenGroup>();
  for (const consignment of unique) {
    let group = grouped.get(consignment.tokenId);
    if (!group) {
      group = {
        tokenId: consignment.tokenId,
        token: null,
        marketData: null,
        consignments: [],
      };
      grouped.set(consignment.tokenId, group);
    }
    group.consignments.push(consignment);
  }

  return Array.from(grouped.values()).filter((g) => g.consignments.length > 0);
}

interface TokenGroupWithDataProps {
  tokenGroup: TokenGroup;
  tokenData: { token: Token; marketData: TokenMarketData | null } | null;
}

const TokenGroupWithData = memo(function TokenGroupWithData({
  tokenGroup,
  tokenData,
}: TokenGroupWithDataProps) {
  useRenderTracker("TokenGroupWithData", { tokenId: tokenGroup.tokenId });

  // FAIL-FAST: If there are consignments for a tokenId, that token must exist
  // If tokenData is null/undefined after loading, that's a data integrity issue
  if (!tokenData) {
    throw new Error(
      `Token data missing for tokenId: ${tokenGroup.tokenId} - consignments exist but token not found`,
    );
  }
  if (!tokenData.token) {
    throw new Error(
      `Token missing in tokenData for tokenId: ${tokenGroup.tokenId} - data integrity issue`,
    );
  }

  return (
    <TokenDealsSection
      token={tokenData.token}
      consignments={tokenGroup.consignments}
    />
  );
});

export function DealsGrid({ filters, searchQuery = "" }: DealsGridProps) {
  useRenderTracker("DealsGrid", {
    searchQuery,
    chainsCount: filters.chains.length,
  });

  const [currentPage, setCurrentPage] = useState(1);

  // Fetch consignments using React Query (cached, deduplicated)
  const {
    data: consignments,
    isLoading: isLoadingConsignments,
    error: consignmentsError,
  } = useTradingDeskConsignments({
    chains: filters.chains,
    negotiableTypes: filters.negotiableTypes,
  });

  // Group consignments by token
  const tokenGroups = useMemo(() => {
    if (!consignments) return [];
    return groupConsignmentsByToken(consignments);
  }, [consignments]);

  // Extract unique token IDs for batch fetching
  const tokenIds = useMemo(() => {
    return tokenGroups.map((g) => g.tokenId);
  }, [tokenGroups]);

  // Batch fetch all tokens in a single request (cached)
  const { data: tokensData, isLoading: isLoadingTokens } =
    useTokenBatch(tokenIds);

  // Filter token groups by search query (memoized)
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return tokenGroups;
    const query = searchQuery.toLowerCase();
    return tokenGroups.filter((group) => {
      // Search by tokenId
      if (group.tokenId.toLowerCase().includes(query)) return true;
      // Search by token symbol/name if available
      const tokenData = tokensData && tokensData[group.tokenId];
      if (tokenData && tokenData.token) {
        if (tokenData.token.symbol.toLowerCase().includes(query)) return true;
        if (tokenData.token.name.toLowerCase().includes(query)) return true;
      }
      return false;
    });
  }, [tokenGroups, searchQuery, tokensData]);

  // Reset to page 1 when filters or search changes
  useMemo(() => {
    setCurrentPage(1);
  }, [
    filters.chains.join(","),
    filters.negotiableTypes.join(","),
    searchQuery,
  ]);

  // Pagination
  const totalPages = Math.ceil(filteredGroups.length / PAGE_SIZE);
  const paginatedGroups = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredGroups.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredGroups, currentPage]);

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(Math.max(1, Math.min(page, totalPages)));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [totalPages],
  );

  const isLoading =
    isLoadingConsignments || (tokenIds.length > 0 && isLoadingTokens);

  if (isLoading) {
    return (
      <div className="space-y-6 pb-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 animate-pulse"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>
              <div className="flex-1">
                <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-32 mb-2"></div>
                <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-48"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (consignmentsError) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 dark:text-red-400">
          Failed to load deals. Please try again.
        </p>
      </div>
    );
  }

  if (filteredGroups.length === 0 && searchQuery) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-zinc-400 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
          No results found
        </h3>
        <p className="text-zinc-600 dark:text-zinc-400">
          No tokens match &quot;{searchQuery}&quot;. Try a different search
          term.
        </p>
      </div>
    );
  }

  if (filteredGroups.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No OTC deals match your filters. Try adjusting the filters or be the
          first to list a deal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      {/* Token groups */}
      {paginatedGroups.map((group) => {
        // FAIL-FAST: If there are consignments for a tokenId, that token must exist after loading
        // tokensData should contain all tokens for the groups we're rendering
        if (!tokensData) {
          throw new Error(
            `Tokens data missing - should be loaded before rendering groups`,
          );
        }
        const tokenData = tokensData[group.tokenId];
        if (!tokenData) {
          throw new Error(
            `Token data missing for tokenId: ${group.tokenId} - consignments exist but token not found in batch`,
          );
        }
        return (
          <TokenGroupWithData
            key={group.tokenId}
            tokenGroup={group}
            tokenData={tokenData}
          />
        );
      })}

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="!px-3 !py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Button>

          <div className="flex items-center gap-1">
            {/* First page */}
            {currentPage > 2 && (
              <>
                <button
                  onClick={() => goToPage(1)}
                  className="w-8 h-8 rounded-lg text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  1
                </button>
                {currentPage > 3 && (
                  <span className="px-1 text-zinc-400">...</span>
                )}
              </>
            )}

            {/* Page numbers around current */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }

              if (pageNum < 1 || pageNum > totalPages) return null;
              if (pageNum === 1 && currentPage > 2) return null;
              if (pageNum === totalPages && currentPage < totalPages - 1)
                return null;

              return (
                <button
                  key={pageNum}
                  onClick={() => goToPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === pageNum
                      ? "bg-brand-500 text-white"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            {/* Last page */}
            {currentPage < totalPages - 1 && (
              <>
                {currentPage < totalPages - 2 && (
                  <span className="px-1 text-zinc-400">...</span>
                )}
                <button
                  onClick={() => goToPage(totalPages)}
                  className="w-8 h-8 rounded-lg text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  {totalPages}
                </button>
              </>
            )}
          </div>

          <Button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="!px-3 !py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Button>
        </div>
      )}
    </div>
  );
}
