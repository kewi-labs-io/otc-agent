"use client";

import type { Chain } from "@/config/chains";
import { SUPPORTED_CHAINS } from "@/config/chains";

interface ChainSelectorProps {
  selected: Chain[];
  onChange: (chains: Chain[]) => void;
}

const allChains = Object.keys(SUPPORTED_CHAINS) as Chain[];

export function ChainSelector({ selected, onChange }: ChainSelectorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "all") {
      onChange(allChains);
    } else {
      onChange([value as Chain]);
    }
  };

  const currentValue =
    selected.length === allChains.length ? "all" : selected[0] || "all";

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
        Chain:
      </label>
      <select
        value={currentValue}
        onChange={handleChange}
        className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
      >
        <option value="all">All Chains</option>
        {allChains.map((chain) => (
          <option key={chain} value={chain}>
            {chain.charAt(0).toUpperCase() + chain.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}
