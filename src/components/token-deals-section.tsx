"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { usePrefetchToken } from "@/hooks";
import type { OTCConsignment, Token } from "@/services/database";
import { formatRawTokenAmount } from "@/utils/format";

interface TokenDealsSectionProps {
  token: Token;
  consignments: OTCConsignment[];
}

function getDealTerms(c: OTCConsignment): {
  discountBps: number;
  lockupDays: number;
} {
  // For negotiable deals, show the "starting at" terms (worst for buyer)
  // For fixed deals, show the fixed terms
  if (c.isNegotiable) {
    return {
      discountBps: c.minDiscountBps,
      lockupDays: c.maxLockupDays,
    };
  }
  if (c.fixedDiscountBps == null) throw new Error(`Consignment ${c.id}: missing fixedDiscountBps`);
  if (c.fixedLockupDays == null) throw new Error(`Consignment ${c.id}: missing fixedLockupDays`);
  return { discountBps: c.fixedDiscountBps, lockupDays: c.fixedLockupDays };
}

function getDealScore(c: OTCConsignment) {
  const { discountBps, lockupDays } = getDealTerms(c);
  return discountBps - lockupDays; // higher discount, shorter lockup = better
}

export function TokenDealsSection({ token, consignments }: TokenDealsSectionProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(true);
  const prefetchToken = usePrefetchToken();

  // Prefetch token data on hover for faster navigation
  const handleMouseEnter = useCallback(() => {
    prefetchToken(token.id);
  }, [prefetchToken, token.id]);

  // formatAmount uses centralized formatRawTokenAmount from @/utils/format
  const formatAmount = (amount: string) => formatRawTokenAmount(amount, token.decimals);

  // Filter to only active consignments with remaining balance
  const activeConsignments = useMemo(
    () => consignments.filter((c) => c.status === "active" && BigInt(c.remainingAmount) > 0n),
    [consignments],
  );

  const sortedConsignments = useMemo(
    () => [...activeConsignments].sort((a, b) => getDealScore(b) - getDealScore(a)),
    [activeConsignments],
  );

  const totalAvailable = activeConsignments.reduce((sum, c) => sum + BigInt(c.remainingAmount), 0n);

  // Don't render if no active consignments
  if (activeConsignments.length === 0) {
    return null;
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      <div
        className="bg-zinc-50 dark:bg-zinc-900/50 p-4 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {token.logoUrl ? (
              <Image
                src={token.logoUrl}
                alt={token.symbol}
                width={48}
                height={48}
                className="w-12 h-12 rounded-full flex-shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                {token.symbol.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold truncate">{token.symbol}</h3>
                <span className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                  {token.name}
                </span>
                {activeConsignments[0] && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      activeConsignments[0].chain === "base"
                        ? "bg-blue-600/15 text-blue-700 dark:text-blue-400"
                        : "bg-purple-600/15 text-purple-700 dark:text-purple-400"
                    }`}
                  >
                    {activeConsignments[0].chain.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm">
                <div>
                  <span className="font-medium">
                    {formatAmount(totalAvailable.toString())} {token.symbol}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400 ml-2">available</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <svg
              className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {sortedConsignments.map((consignment) => {
            const { discountBps, lockupDays } = getDealTerms(consignment);
            const discountPct = (discountBps / 100).toFixed(1);
            const isNegotiable = consignment.isNegotiable;

            return (
              <div
                key={consignment.id}
                className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors cursor-pointer group"
                onClick={() => router.push(`/token/${token.id}`)}
                onMouseEnter={handleMouseEnter}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium group-hover:text-brand-500 transition-colors">
                    {formatAmount(consignment.remainingAmount)} {token.symbol}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {isNegotiable ? (
                        <>
                          Starting at {discountPct}% off · {lockupDays}d
                        </>
                      ) : (
                        <>
                          {discountPct}% off · {lockupDays}d
                        </>
                      )}
                    </span>
                    {isNegotiable && (
                      <span className="inline-flex items-center rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-400 px-2 py-1 text-xs font-medium">
                        Negotiable
                      </span>
                    )}
                    <svg
                      className="w-5 h-5 text-zinc-400 group-hover:text-brand-500 transition-colors"
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
