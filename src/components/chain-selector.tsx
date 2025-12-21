"use client";

import { memo, useCallback } from "react";
import type { Chain } from "@/config/chains";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { useRenderTracker } from "@/utils/render-tracker";

interface ChainSelectorProps {
  selected: Chain[];
  onChange: (chains: Chain[]) => void;
}

// FAIL-FAST: Validate that all keys are valid Chain types
const allChains: Chain[] = (() => {
  const keys = Object.keys(SUPPORTED_CHAINS);
  const validChains: Chain[] = ["ethereum", "base", "bsc", "solana"];
  const chains = keys.filter((key): key is Chain =>
    validChains.includes(key as Chain),
  );
  if (chains.length !== validChains.length) {
    throw new Error(
      `Mismatch between SUPPORTED_CHAINS keys and Chain type: expected ${validChains.length}, got ${chains.length}`,
    );
  }
  return chains;
})();

export const ChainSelector = memo(function ChainSelector({
  selected,
  onChange,
}: ChainSelectorProps) {
  useRenderTracker("ChainSelector");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === "all") {
        onChange(allChains);
      } else {
        // FAIL-FAST: Validate chain is valid before using
        const validChains: Chain[] = ["ethereum", "base", "bsc", "solana"];
        if (!validChains.includes(value as Chain)) {
          throw new Error(`Invalid chain value: ${value}`);
        }
        onChange([value as Chain]);
      }
    },
    [onChange],
  );

  const currentValue =
    selected.length === allChains.length ? "all" : selected[0] || "all";

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
        Chain:
      </label>
      <div className="relative">
        <select
          value={currentValue}
          onChange={handleChange}
          className="appearance-none rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-3 pr-9 py-2 text-sm cursor-pointer"
        >
          <option value="all">All Chains</option>
          {allChains.map((chain) => (
            <option key={chain} value={chain}>
              {chain.charAt(0).toUpperCase() + chain.slice(1)}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
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
  );
});
