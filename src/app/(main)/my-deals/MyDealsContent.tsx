"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { Button } from "@/components/button";
import { useMultiWallet } from "@/components/multiwallet";
import { MyListingsTab } from "@/components/my-listings-tab";
import { useOTC } from "@/hooks/contracts/useOTC";
import { resumeFreshAuth } from "@/utils/x-share";

// Type for deals from the API
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
  quoteId?: string;
  status?: string;
}

// Import OTCConsignment type for listings
import type { OTCConsignment } from "@/types";

// Extended offer type with quoteId
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
}

function formatDate(tsSeconds: bigint): string {
  const d = new Date(Number(tsSeconds) * 1000);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTokenAmount(amountWei: bigint): string {
  const num = Number(amountWei) / 1e18;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
  const lockupDays = 180;
  const tokenAmountBigInt = BigInt(deal.tokenAmount || "0") * BigInt(1e18);

  return {
    id: BigInt(deal.offerId || "0"),
    beneficiary: deal.beneficiary || walletAddress,
    tokenAmount: tokenAmountBigInt,
    discountBps: BigInt(deal.discountBps || 1000),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + lockupDays * 86400)),
    priceUsdPerToken: BigInt(100_000_000),
    ethUsdPrice: BigInt(10_000_000_000),
    currency:
      deal.paymentCurrency === "SOL" || deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: deal.payer || walletAddress,
    amountPaid: BigInt(deal.paymentAmount || "0"),
    quoteId: deal.quoteId,
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
  const lockupDays = deal.lockupMonths ? deal.lockupMonths * 30 : 150;
  const tokenAmountBigInt = BigInt(deal.tokenAmount || "0") * BigInt(1e18);

  return {
    id: BigInt(deal.offerId || "0"),
    beneficiary: deal.beneficiary || walletAddress,
    tokenAmount: tokenAmountBigInt,
    discountBps: BigInt(deal.discountBps || 1000),
    createdAt: BigInt(Math.floor(createdTs)),
    unlockTime: BigInt(Math.floor(createdTs + lockupDays * 86400)),
    priceUsdPerToken: BigInt(100_000_000),
    ethUsdPrice: BigInt(10_000_000_000),
    currency: deal.paymentCurrency === "ETH" ? 0 : 1,
    approved: true,
    paid: true,
    fulfilled: false,
    cancelled: false,
    payer: walletAddress,
    amountPaid: BigInt(0),
    quoteId: deal.quoteId,
  };
}

// --- Helper: Merge database deals with contract offers ---
function mergeDealsWithOffers(
  dbDeals: DealFromAPI[],
  contractOffers: any[],
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
  const {
    activeFamily,
    setActiveFamily,
    evmAddress,
    solanaPublicKey,
    hasWallet,
    evmConnected,
    solanaConnected,
    disconnect,
    networkLabel,
    connectWallet,
    privyAuthenticated,
  } = useMultiWallet();
  const { login, ready: privyReady } = usePrivy();

  // Switch chain: if already authenticated, use connectWallet to add wallet
  // If not authenticated, use login to start fresh
  const handleSwitchToEvm = useCallback(() => {
    setActiveFamily("evm");
    if (!evmConnected) {
      privyAuthenticated ? connectWallet() : login();
    }
  }, [setActiveFamily, evmConnected, privyAuthenticated, connectWallet, login]);

  const handleSwitchToSolana = useCallback(() => {
    setActiveFamily("solana");
    if (!solanaConnected) {
      privyAuthenticated ? connectWallet() : login();
    }
  }, [
    setActiveFamily,
    solanaConnected,
    privyAuthenticated,
    connectWallet,
    login,
  ]);

  // Use connectWallet if already authenticated, login if not
  const handleConnect = useCallback(() => {
    privyAuthenticated ? connectWallet() : login();
  }, [privyAuthenticated, connectWallet, login]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  const networkName = activeFamily === "solana" ? "Solana" : "EVM";

  // Current wallet address based on active family
  const currentAddress =
    activeFamily === "solana" ? solanaPublicKey : evmAddress;
  const displayAddress = currentAddress
    ? `${currentAddress.slice(0, 6)}...${currentAddress.slice(-4)}`
    : null;
  const {
    myOffers,
    claim,
    isClaiming,
    isLoading,
    emergencyRefund,
    emergencyRefundsEnabled,
  } = useOTC();
  const [activeTab, setActiveTab] = useState<"purchases" | "listings">(
    "purchases",
  );
  const [sortAsc] = useState(true);
  const [refunding, setRefunding] = useState<bigint | null>(null);
  const [refundStatus, setRefundStatus] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [solanaDeals, setSolanaDeals] = useState<DealFromAPI[]>([]);
  const [evmDeals, setEvmDeals] = useState<DealFromAPI[]>([]);
  const [myListings, setMyListings] = useState<OTCConsignment[]>([]);

  const refreshListings = useCallback(async () => {
    // Solana addresses are Base58 and case-sensitive, EVM addresses are case-insensitive
    const walletAddr =
      activeFamily === "solana" ? solanaPublicKey : evmAddress?.toLowerCase();

    if (!walletAddr) {
      setSolanaDeals([]);
      setEvmDeals([]);
      setMyListings([]);
      return;
    }

    const [dealsRes, consignmentsRes] = await Promise.all([
      fetch(`/api/deal-completion?wallet=${walletAddr}`).then((res) =>
        res.json(),
      ),
      fetch(`/api/consignments?consigner=${walletAddr}`).then((res) =>
        res.json(),
      ),
    ]);

    if (dealsRes.success && dealsRes.deals) {
      if (activeFamily === "solana") {
        setSolanaDeals(dealsRes.deals);
      } else {
        setEvmDeals(dealsRes.deals);
      }
    }

    if (consignmentsRes.success) {
      setMyListings(consignmentsRes.consignments || []);
    }
  }, [activeFamily, solanaPublicKey, evmAddress]);

  useEffect(() => {
    refreshListings();
  }, [refreshListings]);

  const inProgress = useMemo(() => {
    if (activeFamily === "solana") {
      const walletAddress = solanaPublicKey?.toString() || "";
      return solanaDeals.map((deal) =>
        transformSolanaDeal(deal, walletAddress),
      );
    }

    return mergeDealsWithOffers(evmDeals, myOffers ?? [], evmAddress || "");
  }, [
    myOffers,
    activeFamily,
    solanaDeals,
    evmDeals,
    solanaPublicKey,
    evmAddress,
  ]);

  const sorted = useMemo(() => {
    const list = [...inProgress];
    list.sort((a, b) => Number(a.unlockTime) - Number(b.unlockTime));
    return sortAsc ? list : list.reverse();
  }, [inProgress, sortAsc]);

  // Resume pending share if coming back from OAuth 1.0a
  useMemo(() => {
    (async () => {
      const resumed = await resumeFreshAuth();
      return resumed;
    })();
  }, []);

  if (!hasWallet) {
    return (
      <main className="flex-1 min-h-[70vh] flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md mx-auto px-4">
          <h1 className="text-2xl sm:text-3xl font-semibold">My Deals</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            {privyAuthenticated
              ? "Connect a wallet to view your OTC deals and token listings."
              : "Sign in to view your OTC deals and token listings."}
          </p>
          <Button
            color="orange"
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
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Connect with Farcaster, MetaMask, Phantom, or other wallets
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="flex-1 px-3 sm:px-4 md:px-6 py-4 sm:py-6">
        <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl sm:text-2xl font-semibold">My Deals</h1>
          </div>

          <div className="flex gap-3 sm:gap-4 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
            <button
              onClick={() => setActiveTab("purchases")}
              className={`px-3 sm:px-4 py-2 font-medium transition-colors whitespace-nowrap text-sm sm:text-base ${
                activeTab === "purchases"
                  ? "text-orange-600 border-b-2 border-orange-600"
                  : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              My Purchases
            </button>
            <button
              onClick={() => setActiveTab("listings")}
              className={`px-3 sm:px-4 py-2 font-medium transition-colors whitespace-nowrap text-sm sm:text-base ${
                activeTab === "listings"
                  ? "text-orange-600 border-b-2 border-orange-600"
                  : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              My Listings
            </button>
          </div>

          {activeTab === "listings" ? (
            <MyListingsTab listings={myListings} onRefresh={refreshListings} />
          ) : (
            <>
              {/* Wallet & Network Info Banner */}
              <div className="mb-4 p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                {/* Current Wallet Info */}
                <div className="flex items-center justify-between gap-4 flex-wrap mb-3 pb-3 border-b border-zinc-200 dark:border-zinc-700">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">
                        {activeFamily === "solana" ? "S" : "E"}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {displayAddress || "Not connected"}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {networkLabel}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>

                {/* Chain Switching */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Showing {networkName} purchases
                  </p>
                  <div className="flex gap-2">
                    {activeFamily === "solana" && (
                      <button
                        onClick={handleSwitchToEvm}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap"
                      >
                        View EVM Deals
                      </button>
                    )}
                    {activeFamily === "evm" && (
                      <button
                        onClick={handleSwitchToSolana}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors whitespace-nowrap"
                      >
                        View Solana Deals
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Status Message */}
              {refundStatus && (
                <div
                  className={`mb-4 p-3 rounded-lg border ${
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

              {isLoading ? (
                <div className="text-zinc-600 dark:text-zinc-400">
                  Loading deals…
                </div>
              ) : inProgress.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-zinc-600 dark:text-zinc-400">
                  No active {networkName} deals. Create one from the chat to get
                  started.
                </div>
              ) : (
                <div className="space-y-4">
                  {sorted.map((o, index) => {
                    const now = Math.floor(Date.now() / 1000);
                    const matured = Number(o.unlockTime) <= now;
                    const discountPct = Number(o.discountBps ?? 0n) / 100;
                    const lockup = getLockupLabel(o.createdAt, o.unlockTime);
                    const offerWithQuote = o as OfferWithQuoteId;
                    const uniqueKey =
                      offerWithQuote.quoteId ||
                      o.id.toString() ||
                      `deal-${index}`;

                    return (
                      <div
                        key={uniqueKey}
                        className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                              Amount
                            </div>
                            <div className="font-semibold">
                              {formatTokenAmount(o.tokenAmount)} tokens
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                              Maturity Date
                            </div>
                            <div className="font-semibold">
                              {formatDate(o.unlockTime)}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                              Discount
                            </div>
                            <span className="inline-flex items-center rounded-full bg-orange-600/15 text-orange-700 dark:text-orange-400 px-2 py-0.5 text-xs font-medium">
                              {discountPct.toFixed(0)}%
                            </span>
                          </div>

                          <div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                              Lockup Duration
                            </div>
                            <span className="inline-flex items-center rounded-full bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 text-xs font-medium">
                              {lockup}
                            </span>
                          </div>

                          <div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                              Status
                            </div>
                            {matured ? (
                              <span className="inline-flex items-center rounded-full bg-orange-600/15 text-orange-700 dark:text-orange-400 px-2 py-0.5 text-xs font-medium">
                                Ready to Claim
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-amber-600/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-medium">
                                Locked
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

                              console.log(
                                "[MyDeals] No quoteId, looking up by offerId:",
                                o.id?.toString(),
                              );

                              const response = await fetch(
                                `/api/quote/by-offer/${o.id}`,
                              );
                              if (response.redirected) {
                                window.location.href = response.url;
                              } else if (response.ok) {
                                const data = await response.json();
                                if (data.quoteId) {
                                  window.location.href = `/deal/${data.quoteId}`;
                                } else {
                                  throw new Error("No quoteId in response");
                                }
                              } else {
                                throw new Error(
                                  `Failed to lookup quote: ${response.status}`,
                                );
                              }
                            }}
                            className="!px-4 !py-2"
                          >
                            View Deal
                          </Button>
                          {matured && (
                            <Button
                              color="orange"
                              disabled={isClaiming}
                              onClick={async () => {
                                await claim(o.id);
                              }}
                              className="!px-4 !py-2"
                            >
                              {isClaiming ? "Withdrawing…" : "Withdraw"}
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
                                  console.log(
                                    `[MyDeals] Refund not available yet, ${daysRemaining} days remaining`,
                                  );
                                  setRefundStatus({
                                    type: "info",
                                    message: `Emergency refund available in ${daysRemaining} days`,
                                  });
                                  return;
                                }

                                // Proceed with refund
                                setRefunding(o.id);
                                try {
                                  await emergencyRefund(o.id);
                                  console.log("[MyDeals] Refund successful");
                                  setRefundStatus({
                                    type: "success",
                                    message: "Refund successful",
                                  });
                                } catch (err) {
                                  console.error(
                                    "[MyDeals] Refund failed:",
                                    err,
                                  );
                                  setRefundStatus({
                                    type: "error",
                                    message: `Refund failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                                  });
                                } finally {
                                  setRefunding(null);
                                }
                              }}
                              title="Request emergency refund (90+ days)"
                              className="!px-4 !py-2"
                            >
                              {refunding === o.id ? "Refunding..." : "Refund"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
