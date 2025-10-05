"use client";

import { useMultiWallet } from "@/components/multiwallet";
import { useChainId } from "wagmi";
import { base, baseSepolia, hardhat } from "wagmi/chains";

export function ChainIndicator() {
  const { activeFamily } = useMultiWallet();
  const chainId = useChainId();

  if (activeFamily === "solana") {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="10" />
        </svg>
        <span className="text-sm font-medium">Solana</span>
      </div>
    );
  }

  // EVM chains
  let chainName = "Unknown";
  let chainColor = "text-gray-400 border-gray-500/20 bg-gray-500/10";

  if (chainId === hardhat.id) {
    chainName = "Hardhat (Local)";
    chainColor = "text-yellow-400 border-yellow-500/20 bg-yellow-500/10";
  } else if (chainId === base.id) {
    chainName = "Base";
    chainColor = "text-blue-400 border-blue-500/20 bg-blue-500/10";
  } else if (chainId === baseSepolia.id) {
    chainName = "Base Sepolia";
    chainColor = "text-blue-400 border-blue-500/20 bg-blue-500/10";
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${chainColor}`}>
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <span className="text-sm font-medium">{chainName}</span>
    </div>
  );
}

