"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { Button } from "@/components/button";
import { useMultiWallet } from "@/components/multiwallet";
import { ConsignmentRow } from "@/components/consignment-row";
import { WalletAvatar } from "@/components/wallet-avatar";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useDeals, type DealFromAPI } from "@/hooks/useDeals";
import { useMyConsignments } from "@/hooks/useConsignments";
import { resumeFreshAuth } from "@/utils/x-share";
import { useRenderTracker } from "@/utils/render-tracker";

// Extended offer type with quoteId and token metadata
interface OfferWithQuoteId {
  id: bigint;
  beneficiary: string;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: string;
  amountPaid: bigint;
  quoteId?: string;
  // Token metadata for display
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string;
  tokenId?: string;
  chain?: string;
}

function formatDate(tsSeconds: bigint): string {
  const d = new Date(Number(tsSeconds) * 1000);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTokenAmount(amount: bigint): string {
  // Amount is already in human-readable form (not wei)
  const num = Number(amount);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getLockupLabel(createdAt: bigint, unlockTime: bigint): string {
  const seconds = Math.max(0, Number(unlockTime) - Number(createdAt));
  const months = Math.max(1, Math.round(seconds / (30 * 24 * 60 * 60)));
  return `${months} month${months === 1 ? "" : "s"}`;
}

// --- Helper: Transform Solana deals from API to offer format ---
function transformSolanaDeal(
  deal: DealFromAPI,
  walletAddress: string,
): OfferWithQuoteId {
  const createdTs = deal.createdAt
    ? new Date(deal.createdAt).getTime() / 1000
    : Date.now() / 1000;
  // Use actual lockup from deal, fallback to 6 months (180 days)
  const lockupDays =
    deal.lockupDays ?? (deal.lockupMonths ? deal.lockupMonths * 30 : 180);

  // tokenAmount from API is ALREADY in human-readable form (e.g., "1000" = 1000 tokens)
  // Don't multiply by decimals - that's only for on-chain representation
  // Store as raw number for display purposes
  const tokenAmountRaw = BigInt(
    Math.floor(parseFloat(deal.tokenAmount || "0")),
  );

  return {
    id: BigInt(deal.offerId || "0"),
    beneficiary: deal.beneficiary || walletAddress,
    tokenAmount: tokenAmountRaw,
    discountBps: BigInt(deal.discountBps || 1000),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + lockupDays * 86400)),
    // Use actual price data from deal if available, otherwise 0 (unknown)
    priceUsdPerToken: BigInt(Math.floor((deal.priceUsdPerToken || 0) * 1e8)),
    ethUsdPrice: BigInt(0), // Not used for Solana
    currency:
      deal.paymentCurrency === "SOL" || deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: deal.payer || walletAddress,
    amountPaid: BigInt(deal.paymentAmount || "0"),
    quoteId: deal.quoteId,
    // Token metadata
    tokenSymbol: deal.tokenSymbol,
    tokenName: deal.tokenName,
    tokenLogoUrl: deal.tokenLogoUrl,
    tokenId: deal.tokenId,
    chain: deal.chain || "solana",
  };
}

// --- Helper: Transform EVM deal from API to offer format ---
function transformEvmDeal(
  deal: DealFromAPI,
  walletAddress: string,
): OfferWithQuoteId {
  const createdTs = deal.createdAt
    ? new Date(deal.createdAt).getTime() / 1000
    : Date.now() / 1000;
  // Use actual lockup from deal, fallback to 6 months (180 days) for consistency
  const lockupDays =
    deal.lockupDays ?? (deal.lockupMonths ? deal.lockupMonths * 30 : 180);

  // tokenAmount from API is ALREADY in human-readable form (e.g., "1000" = 1000 tokens)
  // Don't multiply by decimals - that's only for on-chain representation
  const tokenAmountRaw = BigInt(
    Math.floor(parseFloat(deal.tokenAmount || "0")),
  );

  return {
    id: BigInt(deal.offerId || "0"),
    beneficiary: deal.beneficiary || walletAddress,
    tokenAmount: tokenAmountRaw,
    discountBps: BigInt(deal.discountBps || 1000),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + lockupDays * 86400)),
    // Use actual price data from deal if available, otherwise 0 (unknown)
    priceUsdPerToken: BigInt(Math.floor((deal.priceUsdPerToken || 0) * 1e8)),
    ethUsdPrice: BigInt(Math.floor((deal.ethUsdPrice || 0) * 1e8)),
    currency: deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: deal.payer || walletAddress,
    amountPaid: BigInt(deal.paymentAmount || "0"),
    quoteId: deal.quoteId,
    // Token metadata
    tokenSymbol: deal.tokenSymbol,
    tokenName: deal.tokenName,
    tokenLogoUrl: deal.tokenLogoUrl,
    tokenId: deal.tokenId,
    chain: deal.chain || "base",
  };
}

// --- Helper: Merge database deals with contract offers ---
function mergeDealsWithOffers(
  dbDeals: DealFromAPI[],
  contractOffers: OfferWithQuoteId[],
  walletAddress: string,
): OfferWithQuoteId[] {
  const result: OfferWithQuoteId[] = [];
  const processedOfferIds = new Set<string>();

  // Process database deals first (they have quoteId)
  for (const deal of dbDeals) {
    if (deal.status !== "executed" && deal.status !== "approved") continue;

    const contractOffer = deal.offerId
      ? contractOffers.find((o) => o.id.toString() === deal.offerId)
      : undefined;

    if (contractOffer) {
      result.push({ ...contractOffer, quoteId: deal.quoteId });
      if (deal.offerId) processedOfferIds.add(deal.offerId);
    } else {
      result.push(transformEvmDeal(deal, walletAddress));
    }
  }

  // Add contract offers not in database
  const contractOnlyOffers = contractOffers.filter((o) => {
    const offerId = o.id.toString();
    if (processedOfferIds.has(offerId)) return false;
    return (
      o?.id != null &&
      o?.tokenAmount > 0n &&
      o?.paid &&
      !o?.fulfilled &&
      !o?.cancelled
    );
  });

  result.push(...contractOnlyOffers.map((o) => ({ ...o, quoteId: undefined })));
  return result;
}

export function MyDealsContent() {
  useRenderTracker("MyDealsContent");
  const router = useRouter();

  const {
    activeFamily,
    evmAddress,
    solanaPublicKey,
    hasWallet,
    disconnect,
    networkLabel,
    connectWallet,
    privyAuthenticated,
  } = useMultiWallet();
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

  // Determine if current active wallet is Solana
  const isSolanaWallet = activeFamily === "solana" || (!activeFamily && !!solanaPublicKey && !evmAddress);

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
  }, [activeFamily, hasWallet, solanaPublicKey, evmAddress, evmWalletAddr, solanaWalletAddr, networkLabel]);

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
  const isLoadingConsignments = isLoadingEvmConsignments || isLoadingSolanaConsignments;
  const isConsignmentsError = isEvmConsignmentsError && isSolanaConsignmentsError;

  // Refetch functions
  const refetchDeals = useCallback(async () => {
    await Promise.all([refetchEvmDeals(), refetchSolanaDeals()]);
  }, [refetchEvmDeals, refetchSolanaDeals]);

  const refetchConsignments = useCallback(async () => {
    await Promise.all([refetchEvmConsignments(), refetchSolanaConsignments()]);
  }, [refetchEvmConsignments, refetchSolanaConsignments]);

  // Combined loading state - true if any query is loading or we don't have any wallet address yet
  const isLoading = isLoadingDeals || isLoadingConsignments || (hasWallet && !evmWalletAddr && !solanaWalletAddr);
  
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
        transformSolanaDeal(deal, solanaPublicKey)
      );
      allPurchases.push(...solanaTransformed);
    }

    // Transform EVM deals and merge with contract offers
    if (evmDeals.length > 0 || (myOffers && myOffers.length > 0)) {
      const evmMerged = mergeDealsWithOffers(evmDeals, myOffers ?? [], evmAddress || "");
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

    resumeFreshAuth().catch((err) => {
      console.error("[MyDeals] Failed to resume fresh auth:", err);
    });
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
    const solanaDealsLoaded = !isLoadingSolanaDeals && solanaDeals !== undefined;
    const evmListingsLoaded = !isLoadingEvmConsignments && evmListings !== undefined;
    const solanaListingsLoaded = !isLoadingSolanaConsignments && solanaListings !== undefined;
    
    // Need at least one query per connected wallet to have completed
    const evmDataLoaded = !evmWalletAddr || (evmDealsLoaded && evmListingsLoaded);
    const solanaDataLoaded = !solanaWalletAddr || (solanaDealsLoaded && solanaListingsLoaded);
    
    return evmDataLoaded && solanaDataLoaded;
  }, [
    isLoadingEvmDeals, evmDeals,
    isLoadingSolanaDeals, solanaDeals,
    isLoadingEvmConsignments, evmListings,
    isLoadingSolanaConsignments, solanaListings,
    evmWalletAddr, solanaWalletAddr,
  ]);

  const hasAnyWallet = !!evmWalletAddr || !!solanaWalletAddr;

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
    return (
      <main className="flex-1 min-h-[60dvh] flex items-center justify-center">
        <div className="text-zinc-600 dark:text-zinc-400">Loading deals…</div>
      </main>
    );
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
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1.5">Base</span>
                    {`${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}`}
                  </p>
                )}
                {solanaPublicKey && (
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1.5">Solana</span>
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
                <p className="text-zinc-600 dark:text-zinc-400">
                  No deals yet
                </p>
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
                  {sortedPurchases.map((o, index) => {
                    const now = Math.floor(Date.now() / 1000);
                    const matured = Number(o.unlockTime) <= now;
                    const discountPct = Number(o.discountBps ?? 0n) / 100;
                    const lockup = getLockupLabel(o.createdAt, o.unlockTime);
                    const uniqueKey =
                      o.quoteId || o.id.toString() || `deal-${index}`;

                    return (
                      <div
                        key={uniqueKey}
                        className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 overflow-hidden"
                      >
                        {/* Token Header */}
                        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-zinc-200 dark:border-zinc-800 min-w-0">
                          {o.tokenLogoUrl ? (
                            <Image
                              src={o.tokenLogoUrl}
                              alt={o.tokenSymbol || "Token"}
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
                              {o.tokenSymbol?.slice(0, 2) || "TK"}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">
                              ${o.tokenSymbol || "TOKEN"}
                            </div>
                            <div className="text-xs text-zinc-500 truncate">
                              {o.tokenName || "Token"} •{" "}
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
                              {formatTokenAmount(o.tokenAmount)}{" "}
                              {o.tokenSymbol || "tokens"}
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
                                try {
                                  await emergencyRefund(o.id);
                                  setRefundStatus({
                                    type: "success",
                                    message: "Refund successful",
                                  });
                                } catch (err) {
                                  setRefundStatus({
                                    type: "error",
                                    message: `Refund failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                                  });
                                } finally {
                                  setRefunding(null);
                                }
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
