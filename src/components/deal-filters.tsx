"use client";

import { ChainSelector } from "./chain-selector";

interface DealFiltersProps {
  filters: {
    chain: string;
    minMarketCap: number;
    maxMarketCap: number;
    isNegotiable: string;
    isFractionalized: string;
  };
  onFiltersChange: (filters: any) => void;
}

export function DealFilters({ filters, onFiltersChange }: DealFiltersProps) {
  return (
    <div className="flex gap-4 flex-wrap items-center p-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <ChainSelector
        value={filters.chain as any}
        onChange={(chain) => onFiltersChange({ ...filters, chain })}
      />

      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-600 dark:text-zinc-400">
          Type:
        </label>
        <select
          value={filters.isNegotiable}
          onChange={(e) =>
            onFiltersChange({ ...filters, isNegotiable: e.target.value })
          }
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="true">Negotiable</option>
          <option value="false">Fixed Price</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-600 dark:text-zinc-400">
          Deal Size:
        </label>
        <select
          value={filters.isFractionalized}
          onChange={(e) =>
            onFiltersChange({ ...filters, isFractionalized: e.target.value })
          }
          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="true">Fractionalized</option>
          <option value="false">Full Stack</option>
        </select>
      </div>

      <button
        onClick={() =>
          onFiltersChange({
            chain: "all",
            minMarketCap: 0,
            maxMarketCap: 0,
            isNegotiable: "all",
            isFractionalized: "all",
          })
        }
        className="ml-auto text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Clear Filters
      </button>
    </div>
  );
}



