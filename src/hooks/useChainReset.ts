"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount, useDisconnect, usePublicClient } from "wagmi";
import type { ChainResetState } from "@/types";
import { clearWalletCachesAndReload } from "@/utils/wallet-utils";

export function useChainReset() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { logout } = usePrivy();

  const [state, setState] = useState<ChainResetState>({
    resetDetected: false,
    lastBlockNumber: null,
    checksEnabled: false,
  });

  const hasShownToast = useRef(false);

  // Enable checks only for local network (not mainnet/testnet)
  useEffect(() => {
    if (mounted && typeof window !== "undefined") {
      // Only enable chain reset detection for local development with local validators
      const network = process.env.NEXT_PUBLIC_NETWORK;
      const isLocalNetwork = network === "local" || network === "localnet";
      const isDevWithoutNetwork = !network && process.env.NODE_ENV === "development";

      // Don't run chain reset checks when connected to real networks
      if (isLocalNetwork || isDevWithoutNetwork) {
        setState((prev) => ({ ...prev, checksEnabled: true }));
      }
    }
  }, [mounted]);

  const handleChainReset = useCallback(async () => {
    if (hasShownToast.current) return;
    hasShownToast.current = true;

    console.warn("[ChainReset] Local chain reset detected");

    toast.error("Chain Reset Detected", {
      description: "Local blockchain was reset. Click here to reset your wallet connection.",
      duration: 10000,
      action: {
        label: "Reset Wallet",
        onClick: async () => {
          // Disconnect EVM wallet
          if (address) {
            await disconnect();
          }

          // Logout from Privy (handles all wallet types)
          await logout();

          // Clear all wallet caches and reload
          clearWalletCachesAndReload();
        },
      },
    });

    setState((prev) => ({ ...prev, resetDetected: true }));
  }, [address, disconnect, logout]);

  useEffect(() => {
    if (!mounted || !state.checksEnabled || !publicClient) return;

    const checkInterval = setInterval(async () => {
      const currentBlock = await publicClient.getBlockNumber();

      if (state.lastBlockNumber !== null && currentBlock < state.lastBlockNumber) {
        await handleChainReset();
      }

      setState((prev) => ({ ...prev, lastBlockNumber: currentBlock }));
    }, 3000);

    return () => clearInterval(checkInterval);
  }, [mounted, state.checksEnabled, state.lastBlockNumber, publicClient, handleChainReset]);

  // Return nothing - this hook just monitors for chain resets
  // and shows a toast with reset action when detected
}
