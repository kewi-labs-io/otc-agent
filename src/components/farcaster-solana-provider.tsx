"use client";

import { FarcasterSolanaProvider } from "@farcaster/mini-app-solana";
import { useEffect, useMemo, useRef } from "react";
import { SUPPORTED_CHAINS } from "@/config/chains";

/**
 * Get Solana RPC endpoint - supports proxy path or full URL
 * Similar pattern to SolanaWalletProvider
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

/**
 * FarcasterSolanaWrapper - Provides Farcaster Solana wallet access via Wallet Standard
 *
 * This component wraps the app with FarcasterSolanaProvider which:
 * 1. Detects if running in a Farcaster miniapp context
 * 2. Registers Farcaster's native Solana wallet via Wallet Standard
 * 3. Allows @solana/wallet-adapter-react hooks to detect the Farcaster wallet
 *
 * This is the Solana equivalent of @farcaster/miniapp-wagmi-connector for EVM.
 */
export function FarcasterSolanaWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const endpoint = useMemo(() => getSolanaEndpoint(), []);
  const hasLoggedInit = useRef(false);

  // Log only once on mount
  useEffect(() => {
    if (hasLoggedInit.current) return;
    hasLoggedInit.current = true;

    if (process.env.NODE_ENV === "development") {
      console.log(
        "[FarcasterSolanaWrapper] Initialized with endpoint:",
        endpoint,
      );
    }
  }, [endpoint]);

  return (
    <FarcasterSolanaProvider endpoint={endpoint}>
      {children}
    </FarcasterSolanaProvider>
  );
}
