"use client";

import Image from "next/image";
import type { Token, TokenMarketData } from "@/services/database";

interface TokenHeaderProps {
  token: Token;
  marketData: TokenMarketData | null;
}

export function TokenHeader({ token, marketData }: TokenHeaderProps) {
  const priceChange = marketData?.priceChange24h || 0;
  const priceChangeColor =
    priceChange >= 0 ? "text-emerald-600" : "text-red-600";

  const formatMarketCap = (mc: number) => {
    if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
    if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
    if (mc >= 1e3) return `$${(mc / 1e3).toFixed(2)}K`;
    return `$${mc.toFixed(2)}`;
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-start justify-between">
        <div className="flex gap-4">
          {token.logoUrl && (
            <Image
              src={token.logoUrl}
              alt={token.symbol}
              width={64}
              height={64}
              className="w-16 h-16 rounded-full"
            />
          )}
          <div>
            <h1 className="text-3xl font-bold">{token.name}</h1>
            <p className="text-zinc-500 text-lg">${token.symbol}</p>
            {token.description && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2 max-w-2xl">
                {token.description}
              </p>
            )}
          </div>
        </div>

        <div className="text-right">
          <div className="text-3xl font-bold">
            ${marketData?.priceUsd.toFixed(4) || "—"}
          </div>
          {marketData && (
            <div className={`text-sm ${priceChangeColor}`}>
              {priceChange >= 0 ? "+" : ""}
              {priceChange.toFixed(2)}% (24h)
            </div>
          )}
        </div>
      </div>

      {marketData && (
        <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
          <div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Market Cap
            </div>
            <div className="text-lg font-semibold mt-1">
              {formatMarketCap(marketData.marketCap)}
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              24h Volume
            </div>
            <div className="text-lg font-semibold mt-1">
              {formatMarketCap(marketData.volume24h)}
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Chain
            </div>
            <div className="text-lg font-semibold mt-1 uppercase">
              {token.chain}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
