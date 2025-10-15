"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type {
  OTCConsignment,
  Token,
  TokenMarketData,
} from "@/services/database";

interface ConsignmentCardProps {
  consignment: OTCConsignment;
}

export function ConsignmentCard({ consignment }: ConsignmentCardProps) {
  const router = useRouter();
  const [token, setToken] = useState<Token | null>(null);
  const [marketData, setMarketData] = useState<TokenMarketData | null>(null);

  useEffect(() => {
    async function loadTokenData() {
      const response = await fetch(`/api/tokens/${consignment.tokenId}`);
      const data = await response.json();
      if (data.success) {
        setToken(data.token);
        setMarketData(data.marketData);
      }
    }
    loadTokenData();
  }, [consignment.tokenId]);

  if (!token) return null;

  const formatAmount = (amount: string) => {
    const num = Number(amount) / 1e18;
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toFixed(2);
  };

  const priceChange = marketData?.priceChange24h || 0;
  const priceChangeColor =
    priceChange >= 0 ? "text-emerald-600" : "text-red-600";

  return (
    <div
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 hover:shadow-lg transition-shadow cursor-pointer"
      onClick={() => router.push(`/token/${consignment.tokenId}`)}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {token.logoUrl && (
            <Image
              src={token.logoUrl}
              alt={token.symbol}
              width={48}
              height={48}
              className="w-12 h-12 rounded-full"
            />
          )}
          <div>
            <h3 className="text-lg font-semibold">{token.symbol}</h3>
            <p className="text-sm text-zinc-500">{token.name}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">
            ${marketData?.priceUsd.toFixed(4)}
          </div>
          <div className={`text-xs ${priceChangeColor}`}>
            {priceChange >= 0 ? "+" : ""}
            {priceChange.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Available:</span>
          <span className="font-medium">
            {formatAmount(consignment.remainingAmount)} {token.symbol}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Discount:</span>
          <span className="font-medium">
            {consignment.isNegotiable
              ? `${consignment.minDiscountBps / 100}% - ${consignment.maxDiscountBps / 100}%`
              : `${consignment.fixedDiscountBps / 100}%`}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Lockup:</span>
          <span className="font-medium">
            {consignment.isNegotiable
              ? `${consignment.minLockupDays}d - ${consignment.maxLockupDays}d`
              : `${consignment.fixedLockupDays}d`}
          </span>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <span className="inline-flex items-center rounded-full bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 px-2 py-1 text-xs font-medium">
          {consignment.chain.toUpperCase()}
        </span>
        {consignment.isNegotiable && (
          <span className="inline-flex items-center rounded-full bg-blue-600/15 text-blue-700 dark:text-blue-400 px-2 py-1 text-xs font-medium">
            Negotiable
          </span>
        )}
        {consignment.isFractionalized && (
          <span className="inline-flex items-center rounded-full bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 px-2 py-1 text-xs font-medium">
            Fractionalized
          </span>
        )}
      </div>
    </div>
  );
}
