"use client";

import { useMemo, useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/table";
import { useOTC } from "@/hooks/contracts/useOTC";
import { useMultiWallet } from "@/components/multiwallet";
import { createDealShareImage } from "@/utils/share-card";
import {
  ensureXAuth,
  getXCreds,
  shareOnX,
  setPendingShare,
  resumeFreshAuth,
} from "@/utils/x-share";

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

function computeUsd8(offer: any): bigint {
  const ta = BigInt(offer?.tokenAmount ?? 0n);
  const priceUsdPerToken = BigInt(offer?.priceUsdPerToken ?? 0n); // 8d
  const dbps = BigInt(offer?.discountBps ?? 0n);
  const usd8 =
    (((ta * priceUsdPerToken) / 10n ** 18n) * (10_000n - dbps)) / 10_000n;
  return usd8;
}

function formatUsd(amount: number): string {
  // No cents, compact thousands
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000)
    return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function getLockupLabel(createdAt: bigint, unlockTime: bigint): string {
  const seconds = Math.max(0, Number(unlockTime) - Number(createdAt));
  const months = Math.max(1, Math.round(seconds / (30 * 24 * 60 * 60)));
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function MyDealsContent() {
  const { isConnected, address } = useAccount();
  const solWallet = useWallet();
  const { activeFamily } = useMultiWallet();
  const {
    myOffers,
    claim,
    isClaiming,
    isLoading,
    emergencyRefund,
    emergencyRefundsEnabled,
  } = useOTC();
  const [sortAsc, setSortAsc] = useState(true);
  const [refunding, setRefunding] = useState<bigint | null>(null);
  const [solanaDeals, setSolanaDeals] = useState<any[]>([]);

  // Fetch Solana deals from database
  useEffect(() => {
    if (activeFamily === "solana" && solWallet.publicKey) {
      const walletAddr = solWallet.publicKey.toString().toLowerCase();
      console.log("[MyDeals] Fetching Solana deals for wallet:", walletAddr);
      
      fetch(`/api/deal-completion?wallet=${walletAddr}`)
        .then((res) => res.json())
        .then((data) => {
          console.log("[MyDeals] API response:", data);
          if (data.success && data.deals) {
            console.log(
              "[MyDeals] Loaded Solana deals from DB:",
              data.deals.length,
              data.deals
            );
            setSolanaDeals(data.deals);
          } else {
            console.log("[MyDeals] No deals returned or error:", data);
            setSolanaDeals([]);
          }
        })
        .catch((err) => {
          console.error("[MyDeals] Failed to load Solana deals:", err);
          setSolanaDeals([]);
        });
    } else if (activeFamily === "evm" && address) {
      fetch(`/api/deal-completion?wallet=${address}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.deals) {
            console.log(
              "[MyDeals] Loaded EVM deals from DB:",
              data.deals.length
            );
          }
        })
        .catch((err) => console.error(err));
    }
  }, [activeFamily, solWallet.publicKey, address]);

  const inProgress = useMemo(() => {
    // For Solana, ALWAYS use database (never query contracts)
    if (activeFamily === "solana") {
      console.log(
        "[MyDeals] Using Solana deals from database:",
        solanaDeals.length
      );
      
      if (solanaDeals.length === 0) {
        console.log("[MyDeals] No Solana deals found");
        return [];
      }
      
      // Transform database deals to match offer structure
      return solanaDeals.map((deal: any) => {
        const createdTs = deal.createdAt ? new Date(deal.createdAt).getTime() / 1000 : Date.now() / 1000;
        const lockupDays = 180; // 6 months default for Solana
        
        console.log("[MyDeals] Transforming deal:", {
          offerId: deal.offerId,
          tokenAmount: deal.tokenAmount,
          type: typeof deal.tokenAmount,
        });
        
        const tokenAmountRaw = deal.tokenAmount || "0";
        const tokenAmountBigInt = BigInt(tokenAmountRaw) * BigInt(1e18);
        console.log("[MyDeals] Token amount:", tokenAmountRaw, "→", tokenAmountBigInt.toString());
        
        return {
          id: BigInt(deal.offerId || "0"),
          beneficiary: deal.beneficiary || solWallet.publicKey?.toString() || "",
          // Use 18 decimals to match formatTokenAmount function (which divides by 1e18)
          tokenAmount: tokenAmountBigInt,
          discountBps: Number(deal.discountBps) || 1000,
          createdAt: BigInt(Math.floor(createdTs)),
          unlockTime: BigInt(Math.floor(createdTs + lockupDays * 86400)),
          priceUsdPerToken: BigInt(100_000_000), // $1.00
          ethUsdPrice: BigInt(10_000_000_000), // $100
          currency: deal.paymentCurrency === "SOL" || deal.paymentCurrency === "ETH" ? 0 : 1,
          approved: true,
          paid: true,
          fulfilled: false,
          cancelled: false,
          payer: deal.payer || solWallet.publicKey?.toString() || "",
          amountPaid: BigInt(deal.paymentAmount || "0"),
          quoteId: deal.quoteId, // Add quoteId for proper linking
        };
      });
    }

    const offers = myOffers ?? [];
    console.log("[MyDeals] Total offers from contract:", offers.length);
    console.log("[MyDeals] Raw offers data:", offers);

    const filtered = offers.filter((o) => {
      // In-progress means paid, not fulfilled, not cancelled
      const isPaid = Boolean(o?.paid);
      const isFulfilled = Boolean(o?.fulfilled);
      const isCancelled = Boolean(o?.cancelled);
      const hasValidId = o?.id !== undefined && o?.id !== null;
      const hasTokenAmount = o?.tokenAmount && o.tokenAmount > 0n;

      console.log(`[MyDeals] Offer ${o?.id}:`, {
        id: o?.id?.toString(),
        isPaid,
        isFulfilled,
        isCancelled,
        hasValidId,
        hasTokenAmount,
        beneficiary: o?.beneficiary,
        tokenAmount: o?.tokenAmount?.toString(),
        discountBps: o?.discountBps?.toString(),
        approved: o?.approved,
      });

      // Filter: must have valid data and be in paid-but-not-fulfilled state
      return (
        hasValidId && hasTokenAmount && isPaid && !isFulfilled && !isCancelled
      );
    });

    console.log("[MyDeals] Filtered in-progress offers:", filtered.length);
    return filtered;
  }, [myOffers, activeFamily, solanaDeals, solWallet.publicKey]);

  const sorted = useMemo(() => {
    const list = [...inProgress];
    list.sort((a, b) => Number(a.unlockTime) - Number(b.unlockTime));
    return sortAsc ? list : list.reverse();
  }, [inProgress, sortAsc]);

  const stats = useMemo(() => {
    if (inProgress.length === 0)
      return { totalUsd: 0, totalDeals: 0, avgDiscountPct: 0 };
    let totalUsd8 = 0n;
    let totalDiscountBps = 0;
    for (const o of inProgress) {
      totalUsd8 += computeUsd8(o);
      totalDiscountBps += Number(o.discountBps ?? 0n);
    }
    const totalUsd = Number(totalUsd8) / 1e8;
    const avgDiscountPct = totalDiscountBps / inProgress.length / 100;
    return { totalUsd, totalDeals: inProgress.length, avgDiscountPct };
  }, [inProgress]);

  // Resume pending share if coming back from OAuth 1.0a
  useMemo(() => {
    (async () => {
      const resumed = await resumeFreshAuth();
      return resumed;
    })();
  }, []);

  // Check if either EVM or Solana wallet is connected
  const hasWallet = isConnected || solWallet.connected;
  
  if (!hasWallet) {
    return (
      <main className="flex-1 min-h-[70vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-semibold">My Deals</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Connect your wallet to view your OTC deals.
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="flex-1 px-4 sm:px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">My Deals</h1>
          </div>

          {isLoading ? (
            <div className="text-zinc-600 dark:text-zinc-400">
              Loading deals…
            </div>
          ) : inProgress.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-zinc-600 dark:text-zinc-400">
              No active deals. Create one from the chat to get started.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800">
                  <div className="p-6">
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      Total Value
                    </div>
                    <div className="mt-2 text-3xl font-semibold flex items-baseline gap-2">
                      <span>{formatUsd(stats.totalUsd)}</span>
                      <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                        USD
                      </span>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      Total Deals
                    </div>
                    <div className="mt-2 text-3xl font-semibold">
                      {stats.totalDeals}
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      Average Discount
                    </div>
                    <div className="mt-2 text-3xl font-semibold">
                      {stats.avgDiscountPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden px-4 sm:px-6">
                <Table striped bleed>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Amount (elizaOS)</TableHeader>
                      <TableHeader>
                        <button
                          className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white"
                          onClick={() => setSortAsc((v) => !v)}
                        >
                          <span>Maturity Date</span>
                          <span className="text-xs">
                            {sortAsc ? "\u2193" : "\u2191"}
                          </span>
                        </button>
                      </TableHeader>
                      <TableHeader>Discount</TableHeader>
                      <TableHeader>Lockup Duration</TableHeader>
                      <TableHeader>Status</TableHeader>
                      <TableHeader className="text-right">Action</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sorted.map((o) => {
                      const now = Math.floor(Date.now() / 1000);
                      const matured = Number(o.unlockTime) <= now;
                      const discountPct = Number(o.discountBps ?? 0n) / 100;
                      const lockup = getLockupLabel(o.createdAt, o.unlockTime);
                      return (
                        <TableRow key={o.id.toString()}>
                          <TableCell>
                            {formatTokenAmount(o.tokenAmount)}
                          </TableCell>
                          <TableCell>{formatDate(o.unlockTime)}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center rounded-full bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium">
                              {discountPct.toFixed(0)}%
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center rounded-full bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 text-xs font-medium">
                              {lockup}
                            </span>
                          </TableCell>
                          <TableCell>
                            {matured ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium">
                                Ready to Claim
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-amber-600/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-medium">
                                Locked
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-2 justify-end">
                              <Button
                                color="zinc"
                                onClick={() => {
                                  // For Solana, use quoteId directly; for EVM, lookup by offerId
                                  const dealLink = (o as any).quoteId 
                                    ? `/deal/${(o as any).quoteId}`
                                    : `/api/quote/by-offer/${o.id}`;
                                  window.location.href = dealLink;
                                }}
                                className="!px-4 !py-2"
                              >
                                View Deal
                              </Button>
                              {matured && (
                                <Button
                                  color={
                                    (matured ? "emerald" : "zinc") as
                                      | "emerald"
                                      | "zinc"
                                  }
                                  disabled={!matured || isClaiming}
                                  onClick={async () => {
                                    await claim(o.id);
                                  }}
                                >
                                  {isClaiming ? "Withdrawing…" : "Withdraw"}
                                </Button>
                              )}
                              {/* Emergency refund button - show if enabled and deal is stuck */}
                              {emergencyRefundsEnabled && !matured && (
                                <Button
                                  color="red"
                                  disabled={refunding === o.id}
                                  onClick={async () => {
                                    const createdAt = Number(o.createdAt);
                                    const now = Math.floor(Date.now() / 1000);
                                    const daysSinceCreation =
                                      (now - createdAt) / (24 * 60 * 60);

                                    if (daysSinceCreation < 90) {
                                      alert(
                                        `Emergency refund available in ${Math.ceil(90 - daysSinceCreation)} days`
                                      );
                                      return;
                                    }

                                    if (
                                      confirm(
                                        "Request emergency refund? This will cancel the deal and return your payment."
                                      )
                                    ) {
                                      setRefunding(o.id);
                                      await emergencyRefund(o.id);
                                      alert("Refund successful!");
                                    }
                                  }}
                                  title="Request emergency refund (90+ days)"
                                >
                                  {refunding === o.id
                                    ? "Refunding..."
                                    : "Refund"}
                                </Button>
                              )}
                              <Button
                                color="zinc"
                                onClick={async () => {
                                  const discountPct =
                                    Number(o.discountBps ?? 0n) / 100;
                                  const months = Math.max(
                                    1,
                                    Math.round(
                                      (Number(o.unlockTime) -
                                        Number(o.createdAt)) /
                                        (30 * 24 * 60 * 60)
                                    )
                                  );
                                  const tokenAmount =
                                    Number(o.tokenAmount) / 1e18;
                                  const shareText = `I just completed an OTC deal for ${tokenAmount.toLocaleString()} elizaOS at ${discountPct.toFixed(0)}% with ${months}-month lockup. #elizaOS #OTC`;
                                  const { dataUrl } =
                                    await createDealShareImage({
                                      tokenAmount,
                                      discountBps: Number(o.discountBps ?? 0n),
                                      lockupMonths: months,
                                      paymentCurrency:
                                        Number(o.currency ?? 0) === 0
                                          ? "ETH"
                                          : "USDC",
                                    });
                                  const creds = getXCreds();
                                  if (
                                    !creds?.oauth1Token ||
                                    !creds?.oauth1TokenSecret
                                  ) {
                                    setPendingShare({
                                      text: shareText,
                                      dataUrl,
                                    });
                                    ensureXAuth({ text: shareText, dataUrl });
                                  } else {
                                    await shareOnX(shareText, dataUrl, creds);
                                  }
                                }}
                                className="!px-4 !py-2"
                              >
                                Share
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
