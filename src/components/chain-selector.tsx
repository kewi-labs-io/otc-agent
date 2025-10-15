"use client";

import { SUPPORTED_CHAINS, type Chain } from "@/config/chains";

interface ChainSelectorProps {
  value: Chain | "all";
  onChange: (chain: Chain | "all") => void;
}

export function ChainSelector({ value, onChange }: ChainSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-zinc-600 dark:text-zinc-400">Chain:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Chain | "all")}
        className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
      >
        <option value="all">All Chains</option>
        {Object.entries(SUPPORTED_CHAINS).map(([key, config]) => (
          <option key={key} value={key}>
            {config.name}
          </option>
        ))}
      </select>
    </div>
  );
}



