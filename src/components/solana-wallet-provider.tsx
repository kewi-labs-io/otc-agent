"use client";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import { SUPPORTED_CHAINS } from "@/config/chains";

/**
 * Get Solana network from unified chain config
 */
function getSolanaNetwork(): WalletAdapterNetwork {
  const solanaConfig = SUPPORTED_CHAINS.solana;
  if (solanaConfig.id === "solana-mainnet") return WalletAdapterNetwork.Mainnet;
  if (solanaConfig.id === "solana-devnet") return WalletAdapterNetwork.Devnet;
  if (solanaConfig.id === "solana-localnet") return WalletAdapterNetwork.Devnet;
  return WalletAdapterNetwork.Mainnet;
}

/**
 * Get Solana RPC endpoint - supports proxy path or full URL
 */
function getSolanaEndpoint(): string {
  const configUrl = SUPPORTED_CHAINS.solana.rpcUrl;
  
  // If it's a relative path (proxy), construct full URL
  if (configUrl.startsWith("/")) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}${configUrl}`;
    }
    // SSR fallback - will be replaced on client
    return "https://api.mainnet-beta.solana.com";
  }
  
  return configUrl;
}

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const network = useMemo(() => getSolanaNetwork(), []);
  const endpoint = useMemo(() => getSolanaEndpoint(), []);

  // Debug: Log when provider mounts
  console.log("[SolanaConnectionProvider] Provider initialized with:", {
    network,
    endpoint,
    chainConfig: SUPPORTED_CHAINS.solana.id,
  });

  return (
    <ConnectionProvider endpoint={endpoint}>{children}</ConnectionProvider>
  );
}
