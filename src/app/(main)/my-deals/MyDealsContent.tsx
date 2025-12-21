"use client";

import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/button";
import { ConsignmentRow } from "@/components/consignment-row";
import { useChain, useWalletActions, useWalletConnection } from "@/contexts";
import { CardLoading } from "@/components/ui/loading-spinner";
import { WalletAvatar } from "@/components/wallet-avatar";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useMyConsignments } from "@/hooks/useConsignments";
import { useDeals } from "@/hooks/useDeals";
import { usePrefetchQuote } from "@/hooks/useQuote";
import {
  mergeDealsWithOffers,
  type OfferWithMetadata,
  transformSolanaDeal,
} from "@/utils/deal-transforms";

// Shared utilities
import { formatDate, formatTokenAmount, getLockupLabel } from "@/utils/format";
import { useRenderTracker } from "@/utils/render-tracker";
import { resumeFreshAuth } from "@/utils/x-share";

// Re-export type for backward compatibility
type OfferWithQuoteId = OfferWithMetadata;

export function MyDealsContent() {
  useRenderTracker("MyDealsContent");
  const router = useRouter();

  const { activeFamily } = useChain();
  const {
    evmAddress,
    solanaPublicKey,
    hasWallet,
    networkLabel,
    privyAuthenticated,
  } = useWalletConnection();
  const { disconnect, connectWallet } = useWalletActions();
  const { login, ready: privyReady } = usePrivy();

  const handleConnect = useCallback(() => {
    if (privyAuthenticated) {
      connectWallet();
    } else {
      login();
    }
  }, [privyAuthenticated, connectWallet, login]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  const {
    myOffers,
    claim,
    isClaiming,
    emergencyRefund,
    emergencyRefundsEnabled,
  } = useOTC();

  // Prefetch quote data on hover for faster deal page loading
  const prefetchQuote = usePrefetchQuote();

  const [refunding, setRefunding] = useState<bigint | null>(null);
  const [refundStatus, setRefundStatus] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [showWithdrawnListings, setShowWithdrawnListings] = useState(false);

  // Query BOTH wallets when both are linked - user may have deals on either chain
  const evmWalletAddr = evmAddress?.toLowerCase();
  const solanaWalletAddr = solanaPublicKey;

  // Primary wallet for display purposes
  const primaryWalletAddr = useMemo(() => {
    if (activeFamily === "solana") return solanaPublicKey;
    if (activeFamily === "evm") return evmAddress?.toLowerCase();
    return solanaPublicKey || evmAddress?.toLowerCase();
  }, [activeFamily, solanaPublicKey, evmAddress]);

  // Debug logging for wallet state
  useEffect(() => {
    console.log("[MyDeals] Wallet state:", {
      activeFamily,
      hasWallet,
      solanaPublicKey: solanaPublicKey?.slice(0, 8),
      evmAddress: evmAddress?.slice(0, 10),
      evmWalletAddr: evmWalletAddr?.slice(0, 10),
      solanaWalletAddr: solanaWalletAddr?.slice(0, 8),
      networkLabel,
    });
  }, [
    activeFamily,
    hasWallet,
    solanaPublicKey,
    evmAddress,
    evmWalletAddr,
    solanaWalletAddr,
    networkLabel,
  ]);

  // Query EVM deals
  const {
    data: evmDeals = [],
    isLoading: isLoadingEvmDeals,
    isError: isEvmDealsError,
    refetch: refetchEvmDeals,
  } = useDeals(evmWalletAddr);

  // Query Solana deals
  const {
    data: solanaDeals = [],
    isLoading: isLoadingSolanaDeals,
    isError: isSolanaDealsError,
    refetch: refetchSolanaDeals,
  } = useDeals(solanaWalletAddr);

  // Query EVM consignments
  const {
    data: evmListings = [],
    isLoading: isLoadingEvmConsignments,
    isError: isEvmConsignmentsError,
    refetch: refetchEvmConsignments,
  } = useMyConsignments(evmWalletAddr);

  // Query Solana consignments
  const {
    data: solanaListings = [],
    isLoading: isLoadingSolanaConsignments,
    isError: isSolanaConsignmentsError,
    refetch: refetchSolanaConsignments,
  } = useMyConsignments(solanaWalletAddr);

  // Merge all listings
  const myListings = useMemo(() => {
    const all = [...evmListings, ...solanaListings];
    // Dedupe by id
    const seen = new Set<string>();
    return all.filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }, [evmListings, solanaListings]);

  // Combined loading/error states
  const isLoadingDeals = isLoadingEvmDeals || isLoadingSolanaDeals;
  const isDealsError = isEvmDealsError && isSolanaDealsError; // Only error if BOTH fail
  const isLoadingConsignments =
    isLoadingEvmConsignments || isLoadingSolanaConsignments;
  const isConsignmentsError =
    isEvmConsignmentsError && isSolanaConsignmentsError;

  // Refetch functions
  const refetchDeals = useCallback(async () => {
    await Promise.all([refetchEvmDeals(), refetchSolanaDeals()]);
  }, [refetchEvmDeals, refetchSolanaDeals]);

  const refetchConsignments = useCallback(async () => {
    await Promise.all([refetchEvmConsignments(), refetchSolanaConsignments()]);
  }, [refetchEvmConsignments, refetchSolanaConsignments]);

  // Combined loading state - true if any query is loading or we don't have any wallet address yet
  const isLoading =
    isLoadingDeals ||
    isLoadingConsignments ||
    (hasWallet && !evmWalletAddr && !solanaWalletAddr);

  // Error state - only error if ALL queries fail
  const hasError = isDealsError && isConsignmentsError;

  // Combined refresh function for UI actions
  const refreshDeals = useCallback(async () => {
    await Promise.all([refetchDeals(), refetchConsignments()]);
  }, [refetchDeals, refetchConsignments]);

  // Transform and merge deals from both chains
  const purchases = useMemo(() => {
    const allPurchases: OfferWithQuoteId[] = [];

    // Transform Solana deals
    if (solanaDeals.length > 0 && solanaPublicKey) {
      const solanaTransformed = solanaDeals.map((deal) =>
        transformSolanaDeal(deal),
      );
      allPurchases.push(...solanaTransformed);
    }

    // Transform EVM deals and merge with contract offers
    // myOffers is always an array (never null) - type signature guarantees it
    // Contract offers don't have token metadata, so transform them to OfferWithMetadata
    // with empty metadata - mergeDealsWithOffers will filter them out if they don't have metadata
    if (evmDeals.length > 0 || myOffers.length > 0) {
      // FAIL-FAST: evmAddress required for EVM deals
      if (!evmAddress) {
        throw new Error("evmAddress is required for EVM deals");
      }
      // Transform contract offers to OfferWithMetadata format (without metadata - will be filtered)
      const offersWithMetadata: OfferWithMetadata[] = myOffers.map((offer) => ({
        ...offer,
        tokenSymbol: "", // Contract offers don't have metadata - mergeDealsWithOffers will filter these out
        tokenName: "",
        tokenLogoUrl: undefined,
        chain: "base", // Default to base for EVM offers
      }));
      const evmMerged = mergeDealsWithOffers(evmDeals, offersWithMetadata);
      allPurchases.push(...evmMerged);
    }

    return allPurchases;
  }, [myOffers, solanaDeals, evmDeals, solanaPublicKey, evmAddress]);

  const sortedPurchases = useMemo(() => {
    const list = [...purchases];
    list.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    return list;
  }, [purchases]);

  const filteredListings = useMemo(() => {
    if (showWithdrawnListings) return myListings;
    return myListings.filter((c) => c.status !== "withdrawn");
  }, [myListings, showWithdrawnListings]);

  const withdrawnCount = useMemo(
    () => myListings.filter((c) => c.status === "withdrawn").length,
    [myListings],
  );

  // Resume pending share if coming back from OAuth 1.0a
  const hasResumedAuth = useRef(false);
  useEffect(() => {
    if (hasResumedAuth.current) return;
    hasResumedAuth.current = true;

    resumeFreshAuth();
  }, []);

  // Redirect to trading desk if no deals
  const hasAnyDeals =
    filteredListings.length > 0 ||
    sortedPurchases.length > 0 ||
    withdrawnCount > 0;

  // Track if we've successfully fetched data at least once
  const hasFetchedData = useMemo(() => {
    // Only consider redirect after queries have actually completed successfully
    // Check that at least one query has fetched (not just enabled=false returning early)
    const evmDealsLoaded = !isLoadingEvmDeals && evmDeals !== undefined;
    const solanaDealsLoaded =
      !isLoadingSolanaDeals && solanaDeals !== undefined;
    const evmListingsLoaded =
      !isLoadingEvmConsignments && evmListings !== undefined;
    const solanaListingsLoaded =
      !isLoadingSolanaConsignments && solanaListings !== undefined;

    // Need at least one query per connected wallet to have completed
    const evmDataLoaded =
      !evmWalletAddr || (evmDealsLoaded && evmListingsLoaded);
    const solanaDataLoaded =
      !solanaWalletAddr || (solanaDealsLoaded && solanaListingsLoaded);

    return evmDataLoaded && solanaDataLoaded;
  }, [
    isLoadingEvmDeals,
    evmDeals,
    isLoadingSolanaDeals,
    solanaDeals,
    isLoadingEvmConsignments,
    evmListings,
    isLoadingSolanaConsignments,
    solanaListings,
    evmWalletAddr,
    solanaWalletAddr,
  ]);

  if (!hasWallet) {
    return (
      <main className="flex-1 min-h-[60dvh] flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md mx-auto px-4">
          <h1 className="text-2xl sm:text-3xl font-semibold">
            Sign In to View Your Deals
          </h1>
          <Button
            color="brand"
            onClick={handleConnect}
            disabled={!privyReady}
            className="!px-8 !py-3 !text-base"
          >
            {privyReady
              ? privyAuthenticated
                ? "Connect Wallet"
                : "Sign In"
              : "Loading..."}
          </Button>
        </div>
      </main>
    );
  }

  // Show loading state
  if (isLoading) {
    return <CardLoading message="Loading deals..." />;
  }

  // Show error state with retry option
  if (hasError) {
    return (
      <main className="flex-1 min-h-[60dvh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-zinc-600 dark:text-zinc-400">
            Failed to load deals
          </div>
          <Button
            color="brand"
            onClick={() => {
              refetchDeals();
              refetchConsignments();
            }}
            className="!px-6 !py-2"
          >
            Retry
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-3 sm:px-4 md:px-6 py-4 sm:py-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-semibold">My Deals</h1>
          <Button
            color="brand"
            onClick={() => router.push("/consign")}
            className="!px-3 !py-1.5 !text-sm lg:hidden"
          >
            Create Listing
          </Button>
        </div>

        {/* Wallet & Network Info Banner */}
        <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              {primaryWalletAddr ? (
                <WalletAvatar address={primaryWalletAddr} size={32} />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-400 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">?</span>
                </div>
              )}
              <div className="space-y-1">
                {evmAddress && (
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1.5">
                      Base
                    </span>
                    {`${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}`}
                  </p>
                )}
                {solanaPublicKey && (
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1.5">
                      Solana
                    </span>
                    {`${solanaPublicKey.slice(0, 6)}...${solanaPublicKey.slice(-4)}`}
                  </p>
                )}
                {!evmAddress && !solanaPublicKey && (
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Not connected
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>

        {/* Status Message */}
        {refundStatus && (
          <div
            className={`p-3 rounded-lg border ${
              refundStatus.type === "success"
                ? "bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400"
                : refundStatus.type === "error"
                  ? "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400"
            }`}
          >
            <p className="text-sm">{refundStatus.message}</p>
            <button
              onClick={() => setRefundStatus(null)}
              className="text-xs underline mt-1 opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="space-y-6">
          {/* Empty State - shown inline when no deals */}
          {hasFetchedData && !hasAnyDeals && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-8 text-center">
              <p className="text-zinc-600 dark:text-zinc-400">No deals yet</p>
            </div>
          )}

          {/* My Listings Section */}
          {(filteredListings.length > 0 || withdrawnCount > 0) && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-500"></span>
                  My Listings
                  <span className="text-sm font-normal text-zinc-500">
                    ({filteredListings.length})
                  </span>
                </h2>
                {withdrawnCount > 0 && (
                  <button
                    onClick={() =>
                      setShowWithdrawnListings(!showWithdrawnListings)
                    }
                    className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    {showWithdrawnListings ? "Hide" : "Show"} withdrawn (
                    {withdrawnCount})
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {filteredListings.map((consignment) => (
                  <ConsignmentRow
                    key={consignment.id}
                    consignment={consignment}
                    onUpdate={refreshDeals}
                  />
                ))}
              </div>
            </div>
          )}

          {/* My Purchases Section */}
          {sortedPurchases.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                My Purchases
                <span className="text-sm font-normal text-zinc-500">
                  ({sortedPurchases.length})
                </span>
              </h2>
              <div className="space-y-3">
                {sortedPurchases.map((o) => {
                  // FAIL-FAST: tokenSymbol and tokenName are required for display
                  if (!o.tokenSymbol) {
                    throw new Error(
                      `Purchase ${o.id.toString()} missing required tokenSymbol`,
                    );
                  }
                  if (!o.tokenName) {
                    throw new Error(
                      `Purchase ${o.id.toString()} missing required tokenName`,
                    );
                  }

                  const now = Math.floor(Date.now() / 1000);
                  const matured = Number(o.unlockTime) <= now;
                  const discountPct = Number(o.discountBps) / 100;
                  const lockup = getLockupLabel(o.createdAt, o.unlockTime);
                  // id is always present (required in OfferWithMetadata)
                  // quoteId is optional - use id as fallback
                  const uniqueKey =
                    typeof o.quoteId === "string" && o.quoteId.trim() !== ""
                      ? o.quoteId
                      : o.id.toString();

                  return (
                    <div
                      key={uniqueKey}
                      data-testid={`purchase-row-${o.id.toString()}`}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 overflow-hidden"
                    >
                      {/* Token Header */}
                      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-zinc-200 dark:border-zinc-800 min-w-0">
                        {/* tokenSymbol and tokenName guaranteed by mergeDealsWithOffers filtering and transform functions */}
                        {o.tokenLogoUrl ? (
                          <Image
                            src={o.tokenLogoUrl}
                            alt={o.tokenSymbol}
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded-full flex-shrink-0"
                            unoptimized
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {o.tokenSymbol.slice(0, 2)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">
                            ${o.tokenSymbol}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">
                            {o.tokenName} •{" "}
                            {o.chain === "solana" ? "Solana" : "Base"}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                        <div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                            Amount
                          </div>
                          <div className="font-semibold text-sm">
                            {formatTokenAmount(o.tokenAmount)} {o.tokenSymbol}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                            Maturity
                          </div>
                          <div className="font-semibold text-sm">
                            {formatDate(o.unlockTime)}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                            Discount
                          </div>
                          <span className="inline-flex items-center rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-400 px-2 py-0.5 text-xs font-medium">
                            {discountPct.toFixed(0)}%
                          </span>
                        </div>

                        <div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                            Status
                          </div>
                          {matured ? (
                            <span className="inline-flex items-center rounded-full bg-green-600/15 text-green-700 dark:text-green-400 px-2 py-0.5 text-xs font-medium">
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-brand-400/15 text-brand-600 dark:text-brand-400 px-2 py-0.5 text-xs font-medium">
                              Locked ({lockup})
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                        <Button
                          color="zinc"
                          onMouseEnter={() => {
                            // Prefetch quote data on hover for faster navigation
                            if (o.quoteId) {
                              prefetchQuote(o.quoteId);
                            }
                          }}
                          onClick={async () => {
                            if (o.quoteId) {
                              window.location.href = `/deal/${o.quoteId}`;
                              return;
                            }
                            const response = await fetch(
                              `/api/quote/by-offer/${o.id}`,
                            );
                            if (response.ok) {
                              const data = await response.json();
                              if (data.quoteId) {
                                window.location.href = `/deal/${data.quoteId}`;
                              }
                            }
                          }}
                          className="!px-3 !py-1.5 !text-sm"
                        >
                          View
                        </Button>
                        {matured && (
                          <Button
                            color="brand"
                            disabled={isClaiming}
                            data-testid={`offer-claim-${o.id.toString()}`}
                            onClick={async () => {
                              await claim(o.id);
                            }}
                            className="!px-3 !py-1.5 !text-sm"
                          >
                            {isClaiming ? "Claiming…" : "Claim"}
                          </Button>
                        )}
                        {emergencyRefundsEnabled && !matured && (
                          <Button
                            color="red"
                            disabled={refunding === o.id}
                            onClick={async () => {
                              setRefundStatus(null);
                              const createdAt = Number(o.createdAt);
                              const now = Math.floor(Date.now() / 1000);
                              const daysSinceCreation =
                                (now - createdAt) / (24 * 60 * 60);

                              if (daysSinceCreation < 90) {
                                const daysRemaining = Math.ceil(
                                  90 - daysSinceCreation,
                                );
                                setRefundStatus({
                                  type: "info",
                                  message: `Emergency refund available in ${daysRemaining} days`,
                                });
                                return;
                              }

                              setRefunding(o.id);
                              await emergencyRefund(o.id);
                              setRefundStatus({
                                type: "success",
                                message: "Refund successful",
                              });
                              setRefunding(null);
                            }}
                            className="!px-3 !py-1.5 !text-sm"
                          >
                            {refunding === o.id ? "Refunding..." : "Refund"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
